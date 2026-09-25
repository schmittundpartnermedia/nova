import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { normalizeEntityName } from "@/lib/knowledge/entities";
import { bm25Score, reciprocalRankFusion } from "@/lib/retrieval/fusion";
import { understandQuery, type QueryUnderstanding } from "@/lib/retrieval/query";
import { buildStructuredContext, type BuiltContext } from "@/lib/retrieval/context";
import { detectOpenConflicts, rerankHits, type RankableHit } from "@/lib/retrieval/ranking";
import { embedQuery, semanticCandidates } from "@/services/retrieval/embeddings";
import type { EmbeddingProvider } from "@/providers/embedding";

export type RetrievalDebug = {
  query: string;
  parsed: QueryUnderstanding;
  semanticCandidates: string[];
  ftsCandidates: string[];
  entityCandidates: string[];
  relationCandidates: string[];
  semanticAvailable: boolean;
  timings: { candidatesMs: number; fusionMs: number; contextMs: number; totalMs: number };
  ranking: Array<{ id: string; fusion: number; temporal: number; source: string | null; superseded: boolean; score: number }>;
};

export type RetrievalResult = {
  hits: RankableHit[];
  context: BuiltContext;
  understanding: QueryUnderstanding;
  semantic: "available" | "unavailable";
  debug?: RetrievalDebug;
};

function logTiming(timing: RetrievalDebug["timings"]): void {
  if (process.env.NOVA_RETRIEVAL_DEBUG === "1") {
    console.info("[retrieval]", JSON.stringify(timing));
  }
}

export async function retrieveV2(input: {
  organizationId: string;
  query: string;
  projectId?: string;
  sourceId?: string;
  limit?: number;
  debug?: boolean;
  provider?: EmbeddingProvider;
}): Promise<RetrievalResult> {
  const started = Date.now();
  assertOrganizationId(input.organizationId);
  const limit = input.limit ?? 12;
  const names = await knownNames(input.organizationId);
  const understanding = understandQuery(input.query, names);
  const candidateStarted = Date.now();
  const embedded = await embedQuery(input.query, input.provider);
  const [semantic, lexical, entities] = await Promise.all([
    semanticCandidates({
      organizationId: input.organizationId,
      vector: embedded.vector,
      provider: input.provider,
      projectId: input.projectId,
      sourceId: input.sourceId,
      limit: 40,
    }),
    lexicalCandidates(input.organizationId, understanding, input.projectId, input.sourceId),
    entityCandidates(input.organizationId, understanding),
  ]);
  const relations = await relationCandidates(input.organizationId, entities.memoryIds);
  const candidatesMs = Date.now() - candidateStarted;
  const fusionStarted = Date.now();
  const fused = reciprocalRankFusion([
    semantic.map((item) => item.chunkId),
    lexical.map((item) => item.id),
    entities.chunkIds,
    relations.chunkIds,
  ]);
  const ids = [...fused.keys()];
  const chunks = ids.length
    ? await prisma.retrievalChunk.findMany({
        where: { organizationId: input.organizationId, id: { in: ids }, active: true },
      })
    : [];
  const semanticScore = new Map(semantic.map((item) => [item.chunkId, item.score]));
  const lexicalScore = new Map(lexical.map((item) => [item.id, item.score]));
  const hits = chunks
    .filter((chunk) => chunk.organizationId === input.organizationId)
    .filter((chunk) => !input.projectId || chunk.projectId === input.projectId || chunk.text.toLowerCase().includes((understanding.entities[0] ?? "").toLowerCase()))
    .map((chunk) => ({
      id: chunk.id,
      organizationId: chunk.organizationId,
      layer: chunk.layer,
      objectType: chunk.objectType,
      objectId: chunk.objectId,
      title: chunk.title,
      text: chunk.text,
      checksum: chunk.checksum,
      sourceId: chunk.sourceId,
      sourceType: chunk.sourceType,
      sourceLabel: chunk.title,
      epistemicStatus: chunk.epistemicStatus,
      projectId: chunk.projectId,
      occurredAt: chunk.occurredAt,
      superseded: chunk.superseded,
      locationJson: chunk.locationJson,
      conversationId: chunk.conversationId,
      messageIds: chunk.messageIds,
      page: chunk.page,
      section: chunk.section,
      fusion: fused.get(chunk.id) ?? 0,
      semantic: semanticScore.get(chunk.id) ?? 0,
      fulltext: lexicalScore.get(chunk.id) ?? 0,
      entity: entities.chunkIds.includes(chunk.id) ? 1 : 0,
      relation: relations.chunkIds.includes(chunk.id) ? (relations.hop.get(chunk.id) === 2 ? 0.6 : 1) : 0,
      temporal: 0,
      confidence: 0,
    }));
  const ranked = rerankHits(hits, understanding).slice(0, limit);
  const fusionMs = Date.now() - fusionStarted;
  const contextStarted = Date.now();
  const contradictions = await prisma.knowledgeContradiction.findMany({
    where: { organizationId: input.organizationId, status: "open" },
    take: 20,
  });
  const conflicts = detectOpenConflicts(
    ranked,
    contradictions.map((row) => ({
      topic: row.topic,
      values: parseValues(row.valuesJson),
    })),
  ).filter((conflict) => {
    const supersededValues = ranked.filter((hit) => hit.superseded).map((hit) => hit.text);
    return conflict.values.filter((value) => !supersededValues.some((text) => text.includes(value))).length > 1 || understanding.intent !== "current";
  });
  const context = buildStructuredContext({
    query: understanding,
    hits: ranked,
    conflicts: understanding.time.mode === "current" ? conflicts.filter((item) => item.values.length > 1) : conflicts,
    relations: relations.labels,
  });
  const contextMs = Date.now() - contextStarted;
  const timings = { candidatesMs, fusionMs, contextMs, totalMs: Date.now() - started };
  logTiming(timings);
  const debug: RetrievalDebug | undefined = input.debug
    ? {
        query: input.query,
        parsed: understanding,
        semanticCandidates: semantic.map((item) => item.chunkId),
        ftsCandidates: lexical.map((item) => item.id),
        entityCandidates: entities.chunkIds,
        relationCandidates: relations.chunkIds,
        semanticAvailable: embedded.available,
        timings,
        ranking: ranked.map((hit) => ({
          id: hit.id,
          fusion: hit.fusion,
          temporal: hit.temporal,
          source: hit.epistemicStatus ?? null,
          superseded: hit.superseded,
          score: hit.confidence,
        })),
      }
    : undefined;
  return {
    hits: ranked,
    context,
    understanding,
    semantic: embedded.available ? "available" : "unavailable",
    debug,
  };
}

async function knownNames(organizationId: string): Promise<string[]> {
  const [projects, companies, contacts, items] = await Promise.all([
    prisma.project.findMany({ where: { organizationId }, select: { name: true }, take: 100 }),
    prisma.company.findMany({ where: { organizationId, isMock: false }, select: { name: true }, take: 100 }),
    prisma.contact.findMany({ where: { organizationId, isMock: false }, select: { firstName: true, lastName: true }, take: 100 }),
    prisma.knowledgeItem.findMany({
      where: { organizationId, entityName: { not: null } },
      select: { entityName: true },
      take: 200,
    }),
  ]);
  return [
    ...projects.map((item) => item.name),
    ...companies.map((item) => item.name),
    ...contacts.map((item) => `${item.firstName} ${item.lastName}`.trim()),
    ...items.map((item) => item.entityName ?? ""),
  ].filter(Boolean);
}

async function lexicalCandidates(organizationId: string, query: QueryUnderstanding, projectId?: string, sourceId?: string) {
  const tokens = query.keywords.slice(0, 6);
  if (!tokens.length && !query.raw) return [];
  const or = [
    ...(query.raw.length > 2 ? [{ text: { contains: query.raw } }, { title: { contains: query.raw } }] : []),
    ...tokens.flatMap((token) => [{ text: { contains: token } }, { title: { contains: token } }]),
  ];
  const rows = await prisma.retrievalChunk.findMany({
    where: {
      organizationId,
      active: true,
      ...(projectId ? { projectId } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(or.length ? { OR: or } : {}),
    },
    take: 80,
  });
  return rows
    .filter((row) => row.organizationId === organizationId)
    .map((row) => ({ id: row.id, score: bm25Score(tokens, `${row.title} ${row.text}`) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function entityCandidates(organizationId: string, query: QueryUnderstanding) {
  if (!query.entities.length) return { chunkIds: [] as string[], memoryIds: [] as string[] };
  const keys = new Set(query.entities.map((name) => normalizeEntityName(name)));
  const chunks = await prisma.retrievalChunk.findMany({
    where: { organizationId, active: true, objectType: { in: ["entity", "memory", "knowledge_item", "decision", "project"] } },
    take: 300,
  });
  const matched = chunks.filter((chunk) => chunk.organizationId === organizationId && keys.has(normalizeEntityName(chunk.title)));
  const memories = await prisma.memoryEntry.findMany({
    where: { organizationId, OR: query.entities.flatMap((name) => [{ title: { contains: name } }, { fulltext: { contains: name.toLowerCase() } }]) },
    take: 20,
  });
  return {
    chunkIds: matched.map((chunk) => chunk.id),
    memoryIds: memories.filter((item) => item.organizationId === organizationId).map((item) => item.id),
  };
}

async function relationCandidates(organizationId: string, memoryIds: string[]) {
  if (!memoryIds.length) return { chunkIds: [] as string[], labels: [] as string[], hop: new Map<string, number>() };
  const first = await prisma.memoryRelation.findMany({
    where: { organizationId, OR: [{ fromId: { in: memoryIds } }, { toId: { in: memoryIds } }] },
    include: { from: true, to: true },
    take: 24,
  });
  const labels: string[] = [];
  const relatedIds = new Set<string>();
  for (const rel of first) {
    if (rel.organizationId !== organizationId) continue;
    labels.push(`${rel.from.title} ${rel.relationType} ${rel.to.title}`);
    relatedIds.add(rel.fromId);
    relatedIds.add(rel.toId);
  }
  const secondLabels: string[] = [];
  if (relatedIds.size > 0 && relatedIds.size <= 12) {
    const second = await prisma.memoryRelation.findMany({
      where: { organizationId, OR: [{ fromId: { in: [...relatedIds] } }, { toId: { in: [...relatedIds] } }] },
      include: { from: true, to: true },
      take: 16,
    });
    for (const rel of second) {
      if (rel.from.organizationId !== organizationId || rel.to.organizationId !== organizationId) continue;
      secondLabels.push(`${rel.from.title} ${rel.relationType} ${rel.to.title}`);
      relatedIds.add(rel.fromId);
      relatedIds.add(rel.toId);
    }
  }
  const chunks = await prisma.retrievalChunk.findMany({
    where: { organizationId, active: true, objectId: { in: [...relatedIds] } },
    take: 40,
  });
  const hop = new Map<string, number>();
  for (const chunk of chunks) hop.set(chunk.id, memoryIds.includes(chunk.objectId) ? 1 : 2);
  return {
    chunkIds: chunks.filter((chunk) => chunk.organizationId === organizationId).map((chunk) => chunk.id),
    labels: [...labels, ...secondLabels].slice(0, 8),
    hop,
  };
}

function parseValues(json: string): string[] {
  try {
    return (JSON.parse(json) as Array<{ value?: string }>).map((item) => String(item.value ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}
