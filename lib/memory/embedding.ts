import { prisma } from "@/lib/prisma";
import {
  cosineSimilarity,
  getEmbeddingProvider,
  type EmbeddingProvider,
} from "@/providers/embedding";

export type StoredEmbedding = {
  provider: string;
  model: string;
  vector: number[];
};

export function serializeEmbedding(input: StoredEmbedding): string {
  return JSON.stringify({
    provider: input.provider,
    model: input.model,
    vector: input.vector,
    dim: input.vector.length,
  });
}

export function parseEmbedding(raw: string | null | undefined): StoredEmbedding | null {
  if (!raw?.trim() || raw[0] !== "{") return null;
  try {
    const parsed = JSON.parse(raw) as { provider?: string; model?: string; vector?: number[] };
    if (!Array.isArray(parsed.vector) || parsed.vector.length < 8) return null;
    if (parsed.vector.some((value) => typeof value !== "number" || Number.isNaN(value))) return null;
    return {
      provider: parsed.provider ?? "unknown",
      model: parsed.model ?? "unknown",
      vector: parsed.vector,
    };
  } catch {
    return null;
  }
}

export function embeddingSimilarity(query: number[], stored: StoredEmbedding | null): number {
  if (!stored || stored.vector.length !== query.length) return 0;
  return cosineSimilarity(query, stored.vector);
}

export function lexicalMemoryScore(query: string, title: string, content: string, fulltext: string): number {
  const hay = `${title} ${content} ${fulltext}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9äöüß-]/gi, ""))
    .filter((token) => token.length > 2);
  if (!tokens.length) return hay.includes(query.toLowerCase()) ? 0.3 : 0;
  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

export async function embedText(text: string, provider?: EmbeddingProvider): Promise<StoredEmbedding> {
  const active = provider ?? getEmbeddingProvider();
  const [vector] = await active.embed([text.slice(0, 8000)]);
  return { provider: active.id, model: active.model, vector };
}

export async function indexMemoryEmbedding(input: {
  organizationId: string;
  memoryId: string;
  title: string;
  content: string;
}): Promise<void> {
  const embedded = await embedText(`${input.title}\n${input.content}`);
  await prisma.memoryEntry.updateMany({
    where: { id: input.memoryId, organizationId: input.organizationId },
    data: { embeddingRef: serializeEmbedding(embedded) },
  });
}
