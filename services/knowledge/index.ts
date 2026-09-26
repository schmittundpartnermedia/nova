import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createSource, upsertDurableMemory } from "@/services/memory";
import { relateMemory } from "@/services/memory/relations";
import { recordActivity } from "@/services/archive";
import { addJobStep, completeJobStep } from "@/services/jobs";
import { parseKnowledgeSource } from "@/lib/knowledge/parsers";
import { mediaCatalogDocument } from "@/lib/knowledge/parsers/media";
import { entitiesFromExtraction, extractKnowledgeItems, isDurableKnowledge } from "@/lib/knowledge/extract";
import {
  assertKnowledgePath,
  checksumBytes,
  detectSourceType,
  documentLooksLikeSecret,
  inspectUntrustedDocument,
  isLowValueBinary,
  isSecretPath,
  KNOWLEDGE_LIMITS,
  readAllowedFile,
  shouldIgnoreName,
  versionLabelFromName,
} from "@/lib/knowledge/security";
import { unzipSync } from "@/lib/knowledge/zip";
import { parseProjectSnapshot } from "@/lib/knowledge/parsers/special";
import { getEmbeddingProvider } from "@/providers/embedding";
import { upsertChunks } from "@/services/retrieval/embeddings";
import { retrieveV2 } from "@/services/retrieval/hybrid";
import {
  focusKnowledgeHits,
  formatImportSummary,
  formatKnowledgeAnswer,
  hybridScore,
  parseLocation,
  type RankedKnowledgeHit,
  type SearchableItem,
} from "@/lib/knowledge/ranking";
import type { KnowledgeItemType, KnowledgeParserSource, KnowledgeSourceType, ParsedDocument } from "@/types/knowledge";
import type { MemoryType, RelationType, SourceType } from "@/types";
import {
  createKnowledgeImport,
  knowledgeCancelRequested,
  requestKnowledgeCancel,
  updateKnowledgeImport,
} from "@/services/knowledge/jobs";

export { requestKnowledgeCancel, formatImportSummary };

export type KnowledgeImportResult = {
  ok: boolean;
  cancelled: boolean;
  importId: string;
  summary: string;
  reply: string;
  filesTotal: number;
  filesSuccess: number;
  filesSkipped: number;
  filesFailed: number;
  relevantFiles: number;
  itemsCreated: number;
  memoryUpdates: number;
  duplicates: number;
  contradictions: number;
  sourceIds: string[];
};

export type KnowledgeSearchInput = {
  organizationId: string;
  query: string;
  projectId?: string;
  companyId?: string;
  sourceTypes?: string[];
  dateRange?: { from?: Date; to?: Date };
  limit?: number;
};

function memoryTypeOf(type: KnowledgeItemType): MemoryType {
  if (type === "PERSON" || type === "CONTACT") return "person";
  if (type === "COMPANY") return "company";
  if (type === "PROJECT") return "project";
  if (type === "DECISION") return "decision";
  if (type === "PREFERENCE") return "preference";
  if (type === "TASK") return "task";
  return "fact";
}

function walkFiles(root: string, extraIgnore: string[] = []): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > KNOWLEDGE_LIMITS.maxFolderDepth || files.length >= KNOWLEDGE_LIMITS.maxImportFiles) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= KNOWLEDGE_LIMITS.maxImportFiles) return;
      if (shouldIgnoreName(entry.name, extraIgnore)) continue;
      const full = path.join(dir, entry.name);
      if (isSecretPath(full) || isLowValueBinary(full)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile()) files.push(full);
    }
  };
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  visit(root, 0);
  return files;
}

async function persistParsed(input: {
  organizationId: string;
  sourceId: string;
  parsed: ParsedDocument;
}) {
  const payload = {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    title: input.parsed.title,
    documentType: input.parsed.documentType,
    language: input.parsed.language,
    metadata: JSON.stringify(input.parsed.metadata),
    sectionsJson: JSON.stringify(input.parsed.sections),
    tablesJson: JSON.stringify(input.parsed.tables),
    entitiesJson: JSON.stringify(input.parsed.entities),
    datesJson: JSON.stringify(input.parsed.dates),
    referencesJson: JSON.stringify(input.parsed.references),
    fulltext: input.parsed.fulltext,
  };
  const existing = await prisma.knowledgeParsedDocument.findUnique({ where: { sourceId: input.sourceId } });
  if (existing) {
    return prisma.knowledgeParsedDocument.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.knowledgeParsedDocument.create({ data: payload });
}

async function detectContradictions(organizationId: string) {
  const items = await prisma.knowledgeItem.findMany({
    where: {
      organizationId,
      normalizedKey: { not: null },
    },
    include: { source: true },
    orderBy: { extractedAt: "asc" },
  });
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.normalizedKey || item.normalizedValue == null) continue;
    const list = groups.get(item.normalizedKey) ?? [];
    list.push(item);
    groups.set(item.normalizedKey, list);
  }
  let count = 0;
  for (const [key, group] of groups) {
    const values = Array.from(new Set(group.map((item) => item.normalizedValue).filter(Boolean))) as string[];
    if (values.length < 2) continue;
    const ids = group.map((item) => item.id);
    await prisma.knowledgeItem.updateMany({
      where: { organizationId, id: { in: ids } },
      data: { contradictionGroupId: key },
    });
    const existing = await prisma.knowledgeContradiction.findFirst({
      where: { organizationId, topic: key },
    });
    const payload = {
      itemIds: JSON.stringify(ids),
      valuesJson: JSON.stringify(
        group.map((item) => ({
          itemId: item.id,
          value: item.normalizedValue,
          sourceId: item.sourceId,
          sourceName: item.source.name,
          extractedAt: item.extractedAt,
          version: item.source.versionLabel ?? item.source.versionNumber,
          confidence: item.confidence,
        })),
      ),
      status: "open",
    };
    if (existing) {
      await prisma.knowledgeContradiction.update({ where: { id: existing.id }, data: payload });
    } else {
      await prisma.knowledgeContradiction.create({
        data: { organizationId, topic: key, ...payload },
      });
    }
    count += 1;
  }
  return count;
}

async function promoteToMemory(input: {
  organizationId: string;
  projectId?: string;
  items: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
    sourceId: string;
    entityName?: string | null;
    conversationMessageId?: string | null;
    epistemicStatus?: string | null;
  }>;
  relations: Array<{ from: string; type: RelationType; to: string }>;
  originSourceId: string;
  sourceType?: SourceType;
}) {
  const memoryByName = new Map<string, string>();
  let updates = 0;
  for (const item of input.items) {
    if (!isDurableKnowledge(item.type as KnowledgeItemType)) continue;
    if (item.epistemicStatus === "ASSISTANT_SUGGESTED") continue;
    const provenance = await prisma.source.findFirst({
      where: { organizationId: input.organizationId, knowledgeSourceId: item.sourceId },
    });
    const memory = await upsertDurableMemory({
      organizationId: input.organizationId,
      type: memoryTypeOf(item.type as KnowledgeItemType),
      title: item.title,
      content: item.content,
      projectId: input.projectId,
      sourceId: provenance?.id ?? input.originSourceId,
      sourceType: input.sourceType ?? "document",
      sourceReference: item.id,
      conversationMessageId: item.conversationMessageId ?? undefined,
    });
    if (!memory) continue;
    await prisma.knowledgeItem.updateMany({
      where: { id: item.id, organizationId: input.organizationId },
      data: { memoryEntryId: memory.id },
    });
    memoryByName.set((item.entityName ?? item.title).toLowerCase(), memory.id);
    updates += 1;
  }
  for (const relation of input.relations) {
    const fromId = memoryByName.get(relation.from.toLowerCase());
    const toId = memoryByName.get(relation.to.toLowerCase());
    if (!fromId || !toId || fromId === toId) continue;
    const exists = await prisma.memoryRelation.findFirst({
      where: {
        organizationId: input.organizationId,
        fromId,
        toId,
        relationType: relation.type,
      },
    });
    if (exists) continue;
    await relateMemory({
      organizationId: input.organizationId,
      fromId,
      toId,
      relationType: relation.type,
    });
  }
  return updates;
}

async function indexItem(input: {
  organizationId: string;
  sourceId: string;
  itemId: string;
  text: string;
}) {
  await upsertChunks(
    [
      {
        organizationId: input.organizationId,
        objectType: "knowledge_item",
        objectId: input.itemId,
        layer: "knowledge",
        title: input.text.slice(0, 80),
        text: input.text.slice(0, KNOWLEDGE_LIMITS.maxEmbedChars),
        sourceId: input.sourceId,
        documentId: input.sourceId,
        sourceType: "document",
      },
    ],
    getEmbeddingProvider(),
  ).catch(() => undefined);
}

async function ingestBuffer(input: {
  organizationId: string;
  importId: string;
  jobId?: string;
  projectId?: string;
  name: string;
  originalPath?: string;
  bytes: Buffer;
  mimeType?: string;
  sourceType?: string;
  checksum?: string;
  size?: number;
  parentSourceId?: string;
  modifiedAt?: Date;
  catalogOnly?: boolean;
}): Promise<{ sourceId: string; items: number; duplicate: boolean; skipped?: string; relevant: boolean }> {
  assertOrganizationId(input.organizationId);
  if (isSecretPath(input.originalPath ?? input.name) || (!input.catalogOnly && documentLooksLikeSecret(input.bytes.toString("utf8").slice(0, 2000)))) {
    return { sourceId: "", items: 0, duplicate: false, skipped: "secret", relevant: false };
  }
  if (!input.catalogOnly && input.bytes.length > KNOWLEDGE_LIMITS.maxFileBytes) {
    return { sourceId: "", items: 0, duplicate: false, skipped: "too-large", relevant: false };
  }
  const checksum = input.checksum ?? checksumBytes(input.bytes);
  const size = input.size ?? input.bytes.length;
  const existing = await prisma.knowledgeSource.findFirst({
    where: { organizationId: input.organizationId, checksum },
    orderBy: { createdAt: "asc" },
  });
  const version = versionLabelFromName(input.name);
  const relatedVersion = await prisma.knowledgeSource.findFirst({
    where: {
      organizationId: input.organizationId,
      versionGroupId: version.group,
      checksum: { not: checksum },
    },
    orderBy: { versionNumber: "desc" },
  });
  if (existing && existing.status === "INDEXED") {
    await prisma.knowledgeSource.create({
      data: {
        organizationId: input.organizationId,
        sourceType: detectSourceType(input.originalPath ?? input.name, input.mimeType),
        name: input.name,
        originalPath: input.originalPath,
        mimeType: input.mimeType,
        checksum,
        size,
        status: "ARCHIVED",
        duplicateOfId: existing.id,
        importId: input.importId,
        jobId: input.jobId,
        projectId: input.projectId,
        parentSourceId: input.parentSourceId,
        versionGroupId: existing.versionGroupId ?? version.group,
        versionLabel: existing.versionLabel,
        versionNumber: existing.versionNumber,
        skippedReason: "duplicate-checksum",
        importedAt: new Date(),
      },
    });
    return { sourceId: existing.id, items: 0, duplicate: true, relevant: false };
  }

  const sourceType = (input.sourceType ?? detectSourceType(input.originalPath ?? input.name, input.mimeType)) as KnowledgeSourceType;
  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: input.organizationId,
      sourceType,
      name: input.name,
      originalPath: input.originalPath,
      mimeType: input.mimeType,
      checksum,
      size,
      status: "IMPORTING",
      importId: input.importId,
      jobId: input.jobId,
      projectId: input.projectId,
      parentSourceId: input.parentSourceId,
      versionGroupId: version.group,
      versionLabel: version.label ?? (relatedVersion ? `v${relatedVersion.versionNumber + 1}` : "v1"),
      versionNumber: relatedVersion ? relatedVersion.versionNumber + 1 : version.number,
      modifiedAt: input.modifiedAt,
    },
  });

  const parserSource: KnowledgeParserSource = {
    name: input.name,
    originalPath: input.originalPath,
    bytes: input.bytes,
    mimeType: input.mimeType,
    sourceType,
  };
  let parsed: ParsedDocument;
  try {
    parsed = input.catalogOnly
      ? mediaCatalogDocument({
          name: input.name,
          sourceType,
          mimeType: input.mimeType,
          size,
          originalPath: input.originalPath,
        })
      : await parseKnowledgeSource(parserSource);
  } catch (error) {
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Parse fehlgeschlagen",
      },
    });
    return { sourceId: source.id, items: 0, duplicate: false, skipped: "parse-failed", relevant: false };
  }

  parsed.entities = [];
  const extracted = extractKnowledgeItems(parsed);
  parsed.entities = entitiesFromExtraction(extracted);
  const untrusted = inspectUntrustedDocument(input.originalPath ?? input.name, parsed.fulltext);
  await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: {
      status: "PARSED",
      language: parsed.language,
      ocrRequired: Boolean(parsed.ocrRequired),
      injectionSuspected: untrusted.injectionSuspected || Boolean(parsed.injectionSuspected),
      importedAt: new Date(),
      metadata: JSON.stringify({ parser: parsed.metadata.parser, ocrRequired: parsed.ocrRequired }),
    },
  });
  await persistParsed({ organizationId: input.organizationId, sourceId: source.id, parsed });

  const provenance = await createSource({
    organizationId: input.organizationId,
    type: "document",
    label: input.name,
    reference: source.id,
    title: parsed.title,
    excerpt: parsed.fulltext.slice(0, 280),
    jobId: input.jobId,
    metadata: { knowledgeSourceId: source.id, path: input.originalPath },
  });
  await prisma.source.update({
    where: { id: provenance.id },
    data: { knowledgeSourceId: source.id },
  });

  await prisma.knowledgeSource.update({ where: { id: source.id }, data: { status: "PROCESSING" } });
  const created = [];
  const relationDrafts: Array<{ from: string; type: RelationType; to: string }> = [];
  for (const item of extracted) {
    const row = await prisma.knowledgeItem.create({
      data: {
        organizationId: input.organizationId,
        sourceId: source.id,
        type: item.type,
        title: item.title,
        content: item.content,
        normalizedKey: item.normalizedKey,
        normalizedValue: item.normalizedValue,
        entityName: item.entityName,
        projectId: input.projectId,
        locationJson: JSON.stringify(item.location),
        excerpt: item.excerpt,
        extractedAt: new Date(),
        confidence: item.confidence,
        extractor: "knowledge-heuristic-v1",
        verified: false,
        fulltext: `${item.title} ${item.content}`.toLowerCase(),
      },
    });
    created.push(row);
    relationDrafts.push(...item.relations);
    await indexItem({
      organizationId: input.organizationId,
      sourceId: source.id,
      itemId: row.id,
      text: `${item.title}\n${item.content}`,
    });
  }

  const memoryUpdates = await promoteToMemory({
    organizationId: input.organizationId,
    projectId: input.projectId,
    items: created,
    relations: relationDrafts,
    originSourceId: provenance.id,
  });
  await detectContradictions(input.organizationId);
  await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: { status: "INDEXED", metadata: JSON.stringify({ parser: parsed.metadata.parser, memoryUpdates }) },
  });

  if (sourceType === "zip") {
    const entries = unzipSync(input.bytes);
    for (const entry of entries) {
      if (entry.directory || shouldIgnoreName(path.basename(entry.name)) || isSecretPath(entry.name)) continue;
      await ingestBuffer({
        ...input,
        name: path.basename(entry.name),
        originalPath: `${input.originalPath ?? input.name}:${entry.name}`,
        bytes: entry.data,
        parentSourceId: source.id,
      });
    }
  }

  return {
    sourceId: source.id,
    items: created.length,
    duplicate: false,
    relevant: created.length > 0 || parsed.fulltext.length > 40,
  };
}

export async function ingestKnowledgeBuffer(input: Parameters<typeof ingestBuffer>[0]) {
  return ingestBuffer(input);
}

export async function ingestParsedKnowledge(input: {
  organizationId: string;
  importId: string;
  jobId?: string;
  projectId?: string;
  companyId?: string;
  name: string;
  originalPath?: string;
  sourceType: string;
  checksum: string;
  size: number;
  parsed: ParsedDocument;
  items: Array<{
    type: string;
    title: string;
    content: string;
    normalizedKey?: string;
    normalizedValue?: string;
    entityName?: string;
    excerpt: string;
    confidence: number;
    location: Record<string, unknown>;
    relations: Array<{ from: string; type: RelationType; to: string }>;
    epistemicStatus?: string;
    conversationMessageId?: string;
    occurredAt?: Date;
  }>;
  conversationId?: string;
  sourceTypeMemory?: SourceType;
}): Promise<{ sourceId: string; itemIds: string[]; items: number; memoryUpdates: number; duplicate: boolean }> {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.knowledgeSource.findFirst({
    where: { organizationId: input.organizationId, checksum: input.checksum },
    orderBy: { createdAt: "asc" },
  });
  if (existing && existing.status === "INDEXED") {
    return { sourceId: existing.id, itemIds: [], items: 0, memoryUpdates: 0, duplicate: true };
  }

  const source = existing
    ? await prisma.knowledgeSource.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSING",
          importId: input.importId,
          jobId: input.jobId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          name: input.name,
        },
      })
    : await prisma.knowledgeSource.create({
        data: {
          organizationId: input.organizationId,
          sourceType: input.sourceType,
          name: input.name,
          originalPath: input.originalPath,
          checksum: input.checksum,
          size: input.size,
          status: "PROCESSING",
          importId: input.importId,
          jobId: input.jobId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          importedAt: new Date(),
          injectionSuspected: Boolean(input.parsed.injectionSuspected),
          language: input.parsed.language,
        },
      });

  await persistParsed({ organizationId: input.organizationId, sourceId: source.id, parsed: input.parsed });
  const provenance = await prisma.source.findFirst({
    where: { organizationId: input.organizationId, knowledgeSourceId: source.id },
  });
  const origin =
    provenance ??
    (await createSource({
      organizationId: input.organizationId,
      type: input.sourceTypeMemory ?? "chatgpt",
      label: input.name,
      reference: source.id,
      title: input.parsed.title,
      excerpt: input.parsed.fulltext.slice(0, 280),
      jobId: input.jobId,
      metadata: { knowledgeSourceId: source.id, conversationId: input.conversationId },
    }));
  if (!provenance) {
    await prisma.source.update({
      where: { id: origin.id },
      data: { knowledgeSourceId: source.id },
    });
  }

  const created = [];
  const relationDrafts: Array<{ from: string; type: RelationType; to: string }> = [];
  for (const item of input.items) {
    const duplicateItem = await prisma.knowledgeItem.findFirst({
      where: {
        organizationId: input.organizationId,
        type: item.type,
        content: item.content,
        ...(item.normalizedKey ? { normalizedKey: item.normalizedKey } : { title: item.title }),
      },
    });
    if (duplicateItem) continue;
    const previous = item.normalizedKey
      ? await prisma.knowledgeItem.findFirst({
          where: {
            organizationId: input.organizationId,
            normalizedKey: item.normalizedKey,
            normalizedValue: { not: item.normalizedValue ?? "" },
          },
          orderBy: { extractedAt: "desc" },
        })
      : null;
    const row = await prisma.knowledgeItem.create({
      data: {
        organizationId: input.organizationId,
        sourceId: source.id,
        type: item.type,
        title: item.title,
        content: item.content,
        normalizedKey: item.normalizedKey,
        normalizedValue: item.normalizedValue,
        entityName: item.entityName,
        projectId: input.projectId,
        companyId: input.companyId,
        locationJson: JSON.stringify(item.location),
        excerpt: item.excerpt,
        extractedAt: item.occurredAt ?? new Date(),
        confidence: item.confidence,
        extractor: "chatgpt-knowledge-v1",
        verified: false,
        fulltext: `${item.title} ${item.content}`.toLowerCase(),
        conversationMessageId: item.conversationMessageId,
        epistemicStatus: item.epistemicStatus,
        supersedesId: previous && item.normalizedValue && previous.normalizedValue !== item.normalizedValue ? previous.id : null,
      },
    });
    created.push(row);
    relationDrafts.push(...item.relations);
    await indexItem({
      organizationId: input.organizationId,
      sourceId: source.id,
      itemId: row.id,
      text: `${item.title}\n${item.content}`,
    });
  }

  const memoryUpdates = await promoteToMemory({
    organizationId: input.organizationId,
    projectId: input.projectId,
    items: created,
    relations: relationDrafts,
    originSourceId: origin.id,
    sourceType: input.sourceTypeMemory ?? "chatgpt",
  });
  await detectContradictions(input.organizationId);
  await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: { status: "INDEXED", metadata: JSON.stringify({ parser: input.parsed.metadata.parser, memoryUpdates }) },
  });
  return {
    sourceId: source.id,
    itemIds: created.map((item) => item.id),
    items: created.length,
    memoryUpdates,
    duplicate: false,
  };
}

export async function importKnowledgePaths(input: {
  organizationId: string;
  userRequest: string;
  paths: string[];
  jobId?: string;
  projectId?: string;
  extraIgnore?: string[];
}): Promise<KnowledgeImportResult> {
  assertOrganizationId(input.organizationId);
  const resolvedRoots = input.paths.map((item) => assertKnowledgePath(item).resolved);
  const knowledgeImport = await createKnowledgeImport({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    jobId: input.jobId,
    rootPath: resolvedRoots[0],
    metadata: { paths: resolvedRoots },
  });
  const step = input.jobId
    ? await addJobStep({
        organizationId: input.organizationId,
        jobId: input.jobId,
        agent: "knowledge",
        action: "import",
        input: { paths: resolvedRoots },
      })
    : null;

  const files: string[] = [];
  for (const root of resolvedRoots) {
    files.push(...walkFiles(root, input.extraIgnore));
  }
  const uniqueFiles = Array.from(new Set(files)).slice(0, KNOWLEDGE_LIMITS.maxImportFiles);
  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status: "PARSING",
    filesTotal: uniqueFiles.length,
    progress: { inventory: uniqueFiles.map((file) => path.relative(resolvedRoots[0], file) || path.basename(file)) },
  });

  let filesSuccess = 0;
  let filesSkipped = 0;
  let filesFailed = 0;
  let itemsCreated = 0;
  let relevantFiles = 0;
  let duplicates = 0;
  let memoryUpdates = 0;
  const sourceIds: string[] = [];
  let cancelled = false;

  const isProjectFolder = resolvedRoots.some((root) => fs.existsSync(path.join(root, "package.json")) || fs.existsSync(path.join(root, "README.md")));
  if (isProjectFolder && resolvedRoots.length === 1 && fs.statSync(resolvedRoots[0]).isDirectory()) {
    const snapshotFiles = uniqueFiles
      .filter((file) => !isSecretPath(file))
      .slice(0, 80)
      .map((file) => ({
        path: path.relative(resolvedRoots[0], file),
        content: fs.existsSync(file) ? fs.readFileSync(file, "utf8").slice(0, 8000) : "",
      }));
    const snapshot = parseProjectSnapshot({ name: path.basename(resolvedRoots[0]), files: snapshotFiles });
    const fake = await ingestBuffer({
      organizationId: input.organizationId,
      importId: knowledgeImport.id,
      jobId: input.jobId,
      projectId: input.projectId,
      name: `${path.basename(resolvedRoots[0])}-project.json`,
      originalPath: resolvedRoots[0],
      bytes: Buffer.from(
        JSON.stringify(
          {
            name: snapshot.title,
            framework: snapshot.metadata.framework,
            project: snapshot.title,
            summary: snapshot.sections.map((section) => section.content).join("\n").slice(0, 4000),
          },
          null,
          2,
        ),
        "utf8",
      ),
    });
    if (fake.sourceId) sourceIds.push(fake.sourceId);
    itemsCreated += fake.items;
    if (fake.relevant) relevantFiles += 1;
  }

  for (let index = 0; index < uniqueFiles.length; index += 1) {
    if (await knowledgeCancelRequested(input.organizationId, knowledgeImport.id)) {
      cancelled = true;
      break;
    }
    const filePath = uniqueFiles[index];
    if (isSecretPath(filePath) || isLowValueBinary(filePath)) {
      filesSkipped += 1;
      continue;
    }
    try {
      const file = readAllowedFile(filePath);
      const stage = index % 3 === 0 ? "EXTRACTING" : index % 3 === 1 ? "STRUCTURING" : "INDEXING";
      await updateKnowledgeImport({
        organizationId: input.organizationId,
        id: knowledgeImport.id,
        status: stage,
        progress: { current: filePath, index, total: uniqueFiles.length },
      });
      const result = await ingestBuffer({
        organizationId: input.organizationId,
        importId: knowledgeImport.id,
        jobId: input.jobId,
        projectId: input.projectId,
        name: path.basename(filePath),
        originalPath: file.path,
        bytes: file.bytes,
        modifiedAt: file.mtime,
      });
      if (result.skipped === "secret" || result.skipped === "too-large") filesSkipped += 1;
      else if (result.skipped === "parse-failed") filesFailed += 1;
      else {
        filesSuccess += 1;
        if (result.duplicate) {
          duplicates += 1;
          filesSkipped += 1;
        }
        if (result.relevant) relevantFiles += 1;
        itemsCreated += result.items;
        if (result.sourceId) sourceIds.push(result.sourceId);
      }
    } catch {
      filesFailed += 1;
    }
  }

  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status: "MEMORY_PROCESSING",
  });
  memoryUpdates = await prisma.knowledgeItem.count({
    where: { organizationId: input.organizationId, sourceId: { in: sourceIds }, memoryEntryId: { not: null } },
  });
  const contradictions = await prisma.knowledgeContradiction.count({
    where: { organizationId: input.organizationId },
  });
  const status = cancelled ? "CANCELLED" : filesFailed > 0 && filesSuccess > 0 ? "PARTIAL" : filesFailed > 0 && filesSuccess === 0 ? "FAILED" : "COMPLETED";
  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status,
    filesTotal: uniqueFiles.length,
    filesSuccess,
    filesSkipped,
    filesFailed,
    itemsCreated,
    memoryUpdates,
    relevantFiles,
    finished: true,
  });
  if (step) {
    await completeJobStep({
      organizationId: input.organizationId,
      stepId: step.id,
      status: cancelled ? "skipped" : filesFailed > 0 && filesSuccess === 0 ? "failed" : "completed",
      output: { importId: knowledgeImport.id, itemsCreated, filesSuccess, filesFailed },
    });
  }
  await recordActivity({
    organizationId: input.organizationId,
    type: "knowledge",
    title: "Knowledge Import",
    description: formatImportSummary({
      filesTotal: uniqueFiles.length,
      relevantFiles,
      itemsCreated,
      filesFailed,
      filesSkipped,
      duplicates,
    }),
    status: "prepared",
    jobId: input.jobId,
    projectId: input.projectId,
    metadata: {
      importId: knowledgeImport.id,
      filesTotal: uniqueFiles.length,
      filesSuccess,
      filesSkipped,
      filesFailed,
      itemsCreated,
      memoryUpdates,
      sourceIds,
    },
  });
  const reply = formatImportSummary({
    filesTotal: uniqueFiles.length,
    relevantFiles,
    itemsCreated,
    filesFailed,
    filesSkipped,
    duplicates,
  });
  return {
    ok: !cancelled && (filesSuccess > 0 || itemsCreated > 0),
    cancelled,
    importId: knowledgeImport.id,
    summary: reply,
    reply,
    filesTotal: uniqueFiles.length,
    filesSuccess,
    filesSkipped,
    filesFailed,
    relevantFiles,
    itemsCreated,
    memoryUpdates,
    duplicates,
    contradictions,
    sourceIds,
  };
}

export async function searchKnowledge(input: KnowledgeSearchInput): Promise<RankedKnowledgeHit[]> {
  assertOrganizationId(input.organizationId);
  const limit = input.limit ?? 12;
  const items = await prisma.knowledgeItem.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.sourceTypes?.length ? { source: { sourceType: { in: input.sourceTypes } } } : {}),
      ...(input.dateRange?.from || input.dateRange?.to
        ? {
            extractedAt: {
              ...(input.dateRange.from ? { gte: input.dateRange.from } : {}),
              ...(input.dateRange.to ? { lte: input.dateRange.to } : {}),
            },
          }
        : {}),
    },
    include: { source: true },
    take: 400,
    orderBy: { extractedAt: "desc" },
  });
  const isolated = items.filter((item) => item.organizationId === input.organizationId);
  const retrieved = input.query.trim()
    ? await retrieveV2({
        organizationId: input.organizationId,
        query: input.query,
        projectId: input.projectId,
        limit: Math.max(limit, 12),
      })
    : null;
  const semanticByObject = new Map((retrieved?.hits ?? []).map((hit) => [hit.objectId, hit.semantic]));
  const relatedNames = new Set<string>();
  if (input.query.trim()) {
    const memories = await prisma.memoryEntry.findMany({
      where: {
        organizationId: input.organizationId,
        fulltext: { contains: input.query.toLowerCase() },
      },
      take: 8,
    });
    const memoryIds = memories.map((item) => item.id);
    if (memoryIds.length) {
      const relations = await prisma.memoryRelation.findMany({
        where: { organizationId: input.organizationId, OR: [{ fromId: { in: memoryIds } }, { toId: { in: memoryIds } }] },
        include: { from: true, to: true },
        take: 20,
      });
      for (const rel of relations) {
        relatedNames.add(rel.from.title.toLowerCase());
        relatedNames.add(rel.to.title.toLowerCase());
      }
    }
  }

  const ranked: RankedKnowledgeHit[] = isolated.map((item) => {
    const searchable: SearchableItem = {
      id: item.id,
      organizationId: item.organizationId,
      type: item.type,
      title: item.title,
      content: item.content,
      fulltext: item.fulltext,
      entityName: item.entityName,
      normalizedKey: item.normalizedKey,
      normalizedValue: item.normalizedValue,
      locationJson: item.locationJson,
      excerpt: item.excerpt,
      confidence: item.confidence,
      sourceId: item.sourceId,
      sourceName: item.source.name,
      sourceType: item.source.sourceType,
      extractedAt: item.extractedAt,
      createdAt: item.createdAt,
    };
    const semantic = semanticByObject.get(item.id) ?? 0;
    const relation =
      item.entityName && relatedNames.has(item.entityName.toLowerCase())
        ? 1
        : relatedNames.has(item.title.toLowerCase())
          ? 0.7
          : 0;
    const scored = hybridScore({ query: input.query, item: searchable, semantic, relation });
    return {
      ...searchable,
      score: scored.score,
      reasons: scored.reasons,
      location: parseLocation(item.locationJson),
    };
  });
  return ranked
    .filter((item) => item.organizationId === input.organizationId)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function buildKnowledgeContext(input: KnowledgeSearchInput): Promise<{
  promptBlock: string;
  hits: RankedKnowledgeHit[];
  contradictions: Array<{ topic: string; values: string[] }>;
  answer: string;
}> {
  const hits = focusKnowledgeHits(input.query, await searchKnowledge(input));
  const retrieved = await retrieveV2({
    organizationId: input.organizationId,
    query: input.query,
    projectId: input.projectId,
    limit: input.limit ?? 12,
  });
  const contradictions = await prisma.knowledgeContradiction.findMany({
    where: { organizationId: input.organizationId, status: "open" },
    take: 20,
  });
  const relevant = contradictions
    .map((row) => ({
      topic: row.topic,
      values: (() => {
        try {
          return (JSON.parse(row.valuesJson) as Array<{ value?: string }>).map((item) => String(item.value ?? ""));
        } catch {
          return [];
        }
      })(),
    }))
    .filter((row) => hits.some((hit) => row.values.some((value) => value && (hit.normalizedValue === value || hit.content.includes(value)))));
  const lines = hits.slice(0, 8).map((hit) => {
    const loc = [hit.sourceName, hit.location.page ? `S.${hit.location.page}` : "", hit.location.cell ?? ""]
      .filter(Boolean)
      .join(" ");
    return `- [${hit.type}] ${hit.content} (${loc})`;
  });
  if (relevant.length) {
    for (const row of relevant) {
      lines.push(`- [CONTRADICTION] ${row.topic}: ${row.values.join(" vs. ")}`);
    }
  }
  const promptBlock = retrieved.semantic === "unavailable"
    ? `${retrieved.context.promptBlock || (lines.length ? `Knowledge (kompakt, mit Quellen):\n${lines.join("\n")}` : "Knowledge: keine Treffer.")}\nSemantic Retrieval: unavailable`
    : retrieved.context.promptBlock || (lines.length ? `Knowledge (kompakt, mit Quellen):\n${lines.join("\n")}` : "Knowledge: keine Treffer.");
  return {
    promptBlock: promptBlock.slice(0, KNOWLEDGE_LIMITS.maxContextChars),
    hits,
    contradictions: relevant,
    answer: formatKnowledgeAnswer({ query: input.query, hits, contradictions: relevant }),
  };
}

export async function preparedChatGPTKnowledgeImport(): Promise<{ prepared: boolean; implemented: boolean; note: string }> {
  return {
    prepared: true,
    implemented: true,
    note: "ChatGPT-Export wird über Conversation Archive → Knowledge Agent → Memory importiert. Nachrichten sind untrusted historical content.",
  };
}
