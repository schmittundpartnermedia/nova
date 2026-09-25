import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { normalizeEntityName } from "@/lib/knowledge/entities";
import { chunkConversation, chunkStructuredText } from "@/lib/retrieval/chunking";
import { prepareEmbeddingText } from "@/lib/retrieval/text";
import type { ChunkInput } from "@/services/retrieval/embeddings";
import { upsertChunks } from "@/services/retrieval/embeddings";
import type { EmbeddingProvider } from "@/providers/embedding";

const LOW = /^(ok(ay)?|ja|nein|danke|hi|hallo)\.?$/i;

export async function discoverIndexChunks(organizationId: string): Promise<ChunkInput[]> {
  assertOrganizationId(organizationId);
  const [memories, items, documents, messages, projects, tasks, companies] = await Promise.all([
    prisma.memoryEntry.findMany({ where: { organizationId }, take: 2000 }),
    prisma.knowledgeItem.findMany({ where: { organizationId }, include: { source: true }, take: 2000 }),
    prisma.knowledgeParsedDocument.findMany({ where: { organizationId }, take: 400 }),
    prisma.conversationMessage.findMany({
      where: { organizationId },
      include: { conversation: true },
      orderBy: { createdAt: "asc" },
      take: 2000,
    }),
    prisma.project.findMany({ where: { organizationId }, take: 200 }),
    prisma.task.findMany({ where: { organizationId }, take: 400 }),
    prisma.company.findMany({ where: { organizationId, isMock: false }, take: 200 }),
  ]);

  const chunks: ChunkInput[] = [];
  for (const memory of memories) {
    if (memory.organizationId !== organizationId) continue;
    chunks.push({
      organizationId,
      objectType: memory.type === "decision" ? "decision" : "memory",
      objectId: memory.id,
      layer: "memory",
      title: memory.title,
      text: `${memory.title}\n${memory.content}`,
      sourceId: memory.sourceId,
      projectId: memory.projectId,
      sourceType: memory.sourceType,
      conversationId: memory.conversationMessageId ? undefined : undefined,
      occurredAt: memory.updatedAt,
    });
  }
  const superseded = new Set(items.map((item) => item.supersedesId).filter((id): id is string => Boolean(id)));
  for (const item of items) {
    if (item.organizationId !== organizationId) continue;
    const type = item.type === "DECISION" ? "decision" : item.type === "TASK" || item.type === "COMMITMENT" ? "task" : item.type === "COMPANY" || item.type === "PERSON" || item.type === "PROJECT" ? "entity" : "knowledge_item";
    chunks.push({
      organizationId,
      objectType: type,
      objectId: item.id,
      layer: "knowledge",
      title: item.title,
      text: `${item.title}\n${item.content}`,
      sourceId: item.sourceId,
      documentId: item.sourceId,
      projectId: item.projectId,
      sourceType: item.source.sourceType,
      epistemicStatus: item.epistemicStatus,
      superseded: superseded.has(item.id),
      locationJson: item.locationJson,
      occurredAt: item.extractedAt,
      conversationId: undefined,
    });
  }
  for (const doc of documents) {
    if (doc.organizationId !== organizationId) continue;
    let sections: Array<{ heading?: string; content?: string; page?: number }> = [];
    try {
      sections = JSON.parse(doc.sectionsJson) as Array<{ heading?: string; content?: string; page?: number }>;
    } catch {
      sections = [];
    }
    const text = sections.length ? sections.map((section) => `${section.heading ?? ""}\n${section.content ?? ""}`).join("\n\n") : doc.fulltext;
    for (const piece of chunkStructuredText({ text }).slice(0, 12)) {
      chunks.push({
        organizationId,
        objectType: "knowledge_section",
        objectId: `${doc.id}:${piece.ordinal}`,
        layer: "knowledge",
        title: piece.section || doc.title,
        text: piece.text,
        sourceId: doc.sourceId,
        documentId: doc.id,
        page: piece.page,
        section: piece.section,
        sourceType: doc.documentType,
        occurredAt: doc.createdAt,
      });
    }
  }
  const byConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    if (message.organizationId !== organizationId || LOW.test(message.content.trim())) continue;
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  for (const [conversationId, turns] of byConversation) {
    const pieces = chunkConversation(turns.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content, createdAt: turn.createdAt })));
    for (const piece of pieces) {
      chunks.push({
        organizationId,
        objectType: "conversation",
        objectId: `${conversationId}:${piece.ordinal}`,
        layer: "archive",
        title: turns[0]?.conversation.title || "Gespräch",
        text: piece.text,
        conversationId,
        messageIds: piece.messageIds,
        projectId: turns[0]?.conversation.projectId,
        sourceType: "chat",
        occurredAt: turns[0]?.createdAt,
      });
    }
  }
  for (const project of projects) {
    if (!project.description || project.organizationId !== organizationId) continue;
    chunks.push({
      organizationId,
      objectType: "project",
      objectId: project.id,
      layer: "knowledge",
      title: project.name,
      text: `${project.name}\n${project.description}`,
      projectId: project.id,
      sourceType: "project",
      occurredAt: project.updatedAt,
    });
  }
  for (const task of tasks) {
    const text = `${task.title}\n${task.description ?? ""}`;
    if (prepareEmbeddingText(text).skip) continue;
    chunks.push({
      organizationId,
      objectType: "task",
      objectId: task.id,
      layer: "memory",
      title: task.title,
      text,
      projectId: task.projectId,
      sourceType: "task",
      occurredAt: task.dueAt ?? task.updatedAt,
    });
  }
  for (const company of companies) {
    const text = `${company.name}\n${company.industry ?? ""}\n${company.notes ?? ""}`.trim();
    if (prepareEmbeddingText(text).skip) continue;
    chunks.push({
      organizationId,
      objectType: "entity",
      objectId: company.id,
      layer: "knowledge",
      title: company.name,
      text,
      projectId: company.projectId,
      sourceType: "company",
      occurredAt: company.updatedAt,
    });
  }
  return chunks.filter((chunk) => chunk.organizationId === organizationId && !prepareEmbeddingText(chunk.text).skip);
}

export async function reindexExistingKnowledge(input: {
  organizationId: string;
  provider?: EmbeddingProvider;
  shouldCancel?: () => Promise<boolean>;
  onPhase?: (phase: string, stats: { processed: number; failed: number; skipped: number; cached: number }) => Promise<void>;
}): Promise<{ processed: number; failed: number; skipped: number; cached: number; cancelled: boolean }> {
  assertOrganizationId(input.organizationId);
  await input.onPhase?.("DISCOVERING", { processed: 0, failed: 0, skipped: 0, cached: 0 });
  const chunks = await discoverIndexChunks(input.organizationId);
  if (await input.shouldCancel?.()) return { processed: 0, failed: 0, skipped: chunks.length, cached: 0, cancelled: true };
  await input.onPhase?.("PREPARING", { processed: 0, failed: 0, skipped: 0, cached: 0 });
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let cached = 0;
  const batchSize = 24;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    if (await input.shouldCancel?.()) {
      return { processed, failed, skipped, cached, cancelled: true };
    }
    await input.onPhase?.("EMBEDDING", { processed, failed, skipped, cached });
    const stats = await upsertChunks(chunks.slice(offset, offset + batchSize), input.provider);
    processed += stats.processed;
    failed += stats.failed;
    skipped += stats.skipped;
    cached += stats.cached;
    await input.onPhase?.("INDEXING", { processed, failed, skipped, cached });
  }
  await input.onPhase?.("VERIFYING", { processed, failed, skipped, cached });
  const active = await prisma.retrievalChunk.count({ where: { organizationId: input.organizationId, active: true } });
  if (active < 0) throw new Error("Indexprüfung fehlgeschlagen");
  await input.onPhase?.("COMPLETED", { processed, failed, skipped, cached });
  return { processed, failed, skipped, cached, cancelled: false };
}

export function aliasKey(name: string): string {
  return normalizeEntityName(name);
}
