import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { EMBEDDING_VERSION, cosineSimilarity, embeddingProviderAvailable, getEmbeddingProvider } from "@/providers/embedding";
import type { EmbeddingProvider } from "@/providers/embedding";
import { OpenAIEmbeddingProvider } from "@/providers/embedding/openai";
import { contentChecksum, prepareEmbeddingText } from "@/lib/retrieval/text";

export type ChunkInput = {
  organizationId: string;
  objectType: string;
  objectId: string;
  layer: "memory" | "knowledge" | "archive" | "mail";
  title: string;
  text: string;
  sourceId?: string | null;
  documentId?: string | null;
  conversationId?: string | null;
  messageIds?: string[];
  projectId?: string | null;
  page?: number | null;
  section?: string | null;
  locationJson?: string | null;
  sourceType?: string | null;
  epistemicStatus?: string | null;
  superseded?: boolean;
  occurredAt?: Date | null;
};

export type IndexStats = {
  processed: number;
  failed: number;
  skipped: number;
  cached: number;
  semantic: "available" | "unavailable";
};

const vectorCache = new Map<string, { at: number; vector: number[] }>();

export function clearQueryVectorCache(): void {
  vectorCache.clear();
}

export async function embedQuery(text: string, provider = getEmbeddingProvider()): Promise<{ vector: number[]; available: boolean }> {
  if (!embeddingProviderAvailable(provider)) return { vector: [], available: false };
  const key = `${provider.id}:${provider.model()}:${text}`;
  const cached = vectorCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return { vector: cached.vector, available: true };
  try {
    const vector = await provider.embedText(text);
    if (vector.length) vectorCache.set(key, { at: Date.now(), vector });
    return { vector, available: vector.length > 0 };
  } catch {
    return { vector: [], available: false };
  }
}

async function recordUsage(organizationId: string, provider: EmbeddingProvider, texts: number): Promise<void> {
  const usage = provider instanceof OpenAIEmbeddingProvider ? provider.lastUsage : null;
  if (!usage && texts <= 0) return;
  await prisma.embeddingUsage.create({
    data: {
      organizationId,
      provider: provider.id,
      model: provider.model(),
      calls: usage?.calls ?? 0,
      texts,
      tokens: usage?.tokens ?? 0,
      metadata: usage ? JSON.stringify({ version: EMBEDDING_VERSION, tokensFromProvider: usage.tokens > 0 }) : JSON.stringify({ version: EMBEDDING_VERSION, tokensFromProvider: false }),
    },
  });
}

export async function upsertChunks(chunks: ChunkInput[], provider = getEmbeddingProvider()): Promise<IndexStats> {
  const stats: IndexStats = { processed: 0, failed: 0, skipped: 0, cached: 0, semantic: embeddingProviderAvailable(provider) ? "available" : "unavailable" };
  const pending: Array<{ chunkId: string; organizationId: string; text: string; checksum: string }> = [];

  for (const chunk of chunks) {
    assertOrganizationId(chunk.organizationId);
    const prepared = prepareEmbeddingText(chunk.text);
    if (prepared.skip || !prepared.text) {
      stats.skipped += 1;
      continue;
    }
    const checksum = contentChecksum(prepared.text);
    try {
      const saved = await prisma.retrievalChunk.upsert({
        where: {
          organizationId_objectType_objectId_checksum: {
            organizationId: chunk.organizationId,
            objectType: chunk.objectType,
            objectId: chunk.objectId,
            checksum,
          },
        },
        create: {
          organizationId: chunk.organizationId,
          objectType: chunk.objectType,
          objectId: chunk.objectId,
          layer: chunk.layer,
          title: chunk.title.slice(0, 240),
          text: prepared.text,
          checksum,
          sourceId: chunk.sourceId ?? undefined,
          documentId: chunk.documentId ?? undefined,
          conversationId: chunk.conversationId ?? undefined,
          messageIds: chunk.messageIds ? JSON.stringify(chunk.messageIds) : undefined,
          projectId: chunk.projectId ?? undefined,
          page: chunk.page ?? undefined,
          section: chunk.section ?? undefined,
          locationJson: chunk.locationJson ?? undefined,
          sourceType: chunk.sourceType ?? undefined,
          epistemicStatus: chunk.epistemicStatus ?? undefined,
          superseded: chunk.superseded ?? false,
          active: true,
          occurredAt: chunk.occurredAt ?? undefined,
        },
        update: {
          title: chunk.title.slice(0, 240),
          text: prepared.text,
          active: true,
          superseded: chunk.superseded ?? false,
          epistemicStatus: chunk.epistemicStatus ?? undefined,
          projectId: chunk.projectId ?? undefined,
          occurredAt: chunk.occurredAt ?? undefined,
          sourceType: chunk.sourceType ?? undefined,
          locationJson: chunk.locationJson ?? undefined,
        },
      });
      await prisma.retrievalChunk.updateMany({
        where: {
          organizationId: chunk.organizationId,
          objectType: chunk.objectType,
          objectId: chunk.objectId,
          NOT: { id: saved.id },
        },
        data: { active: false },
      });
      if (!embeddingProviderAvailable(provider)) {
        stats.processed += 1;
        continue;
      }
      const existing = await prisma.retrievalEmbedding.findFirst({
        where: {
          organizationId: chunk.organizationId,
          checksum,
          provider: provider.id,
          model: provider.model(),
          version: EMBEDDING_VERSION,
          status: "active",
        },
      });
      if (existing && existing.chunkId === saved.id) {
        stats.cached += 1;
        stats.processed += 1;
        continue;
      }
      if (existing) {
        await prisma.retrievalEmbedding.upsert({
          where: {
            organizationId_chunkId_provider_model_version: {
              organizationId: chunk.organizationId,
              chunkId: saved.id,
              provider: provider.id,
              model: provider.model(),
              version: EMBEDDING_VERSION,
            },
          },
          create: {
            organizationId: chunk.organizationId,
            chunkId: saved.id,
            provider: provider.id,
            model: provider.model(),
            dimensions: existing.dimensions,
            version: EMBEDDING_VERSION,
            checksum,
            vector: existing.vector,
            status: "active",
          },
          update: { vector: existing.vector, checksum, dimensions: existing.dimensions, status: "active" },
        });
        stats.cached += 1;
        stats.processed += 1;
        continue;
      }
      pending.push({ chunkId: saved.id, organizationId: chunk.organizationId, text: prepared.text, checksum });
    } catch {
      stats.failed += 1;
    }
  }

  for (let offset = 0; offset < pending.length; offset += 16) {
    const batch = pending.slice(offset, offset + 16);
    let vectors: number[][] = [];
    try {
      vectors = await provider.embedBatch(batch.map((item) => item.text));
      await recordUsage(batch[0].organizationId, provider, batch.length).catch(() => undefined);
    } catch {
      stats.failed += batch.length;
      continue;
    }
    for (let i = 0; i < batch.length; i += 1) {
      const vector = vectors[i] ?? [];
      if (!vector.length) {
        stats.failed += 1;
        continue;
      }
      try {
        await prisma.retrievalEmbedding.upsert({
          where: {
            organizationId_chunkId_provider_model_version: {
              organizationId: batch[i].organizationId,
              chunkId: batch[i].chunkId,
              provider: provider.id,
              model: provider.model(),
              version: EMBEDDING_VERSION,
            },
          },
          create: {
            organizationId: batch[i].organizationId,
            chunkId: batch[i].chunkId,
            provider: provider.id,
            model: provider.model(),
            dimensions: vector.length,
            version: EMBEDDING_VERSION,
            checksum: batch[i].checksum,
            vector: JSON.stringify(vector),
            status: "active",
          },
          update: {
            vector: JSON.stringify(vector),
            checksum: batch[i].checksum,
            dimensions: vector.length,
            status: "active",
          },
        });
        stats.processed += 1;
      } catch {
        stats.failed += 1;
      }
    }
  }
  return stats;
}

export async function deactivateObject(organizationId: string, objectType: string, objectId: string): Promise<void> {
  assertOrganizationId(organizationId);
  await prisma.retrievalChunk.updateMany({
    where: { organizationId, objectType, objectId },
    data: { active: false },
  });
}

export async function semanticCandidates(input: {
  organizationId: string;
  vector: number[];
  provider?: EmbeddingProvider;
  projectId?: string;
  sourceId?: string;
  objectTypes?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<Array<{ chunkId: string; score: number }>> {
  if (!input.vector.length) return [];
  const provider = input.provider ?? getEmbeddingProvider();
  assertOrganizationId(input.organizationId);
  const rows = await prisma.retrievalEmbedding.findMany({
    where: {
      organizationId: input.organizationId,
      provider: provider.id,
      model: provider.model(),
      version: EMBEDDING_VERSION,
      status: "active",
      dimensions: input.vector.length,
      chunk: {
        organizationId: input.organizationId,
        active: true,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(input.objectTypes?.length ? { objectType: { in: input.objectTypes } } : {}),
        ...(input.from || input.to
          ? {
              occurredAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {}),
      },
    },
    select: { chunkId: true, vector: true, organizationId: true },
    take: 2000,
  });
  return rows
    .filter((row) => row.organizationId === input.organizationId)
    .map((row) => {
      try {
        return { chunkId: row.chunkId, score: cosineSimilarity(input.vector, JSON.parse(row.vector) as number[]) };
      } catch {
        return { chunkId: row.chunkId, score: 0 };
      }
    })
    .filter((row) => row.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 40);
}
