import { hasOpenAIApiKey } from "@/lib/secrets";
import { MockEmbeddingProvider } from "@/providers/embedding/mock";
import { OpenAIEmbeddingProvider } from "@/providers/embedding/openai";
import type { EmbeddingProvider } from "@/providers/embedding/types";

export type { EmbeddingProvider, EmbeddingUsageRecord } from "@/providers/embedding/types";
export { EMBEDDING_VERSION } from "@/providers/embedding/types";
export { MockEmbeddingProvider } from "@/providers/embedding/mock";
export { OpenAIEmbeddingProvider } from "@/providers/embedding/openai";
export { LocalHashEmbeddingProvider } from "@/providers/embedding/legacy-hash";
export { SDK_DEFAULT_EMBEDDING_MODEL, SDK_EMBEDDING_MODELS, resolveOpenAIEmbeddingModel } from "@/providers/embedding/models";

class UnavailableEmbeddingProvider implements EmbeddingProvider {
  id = "unavailable";

  model(): string {
    return "none";
  }

  dimensions(): number {
    return 0;
  }

  async embedText(): Promise<number[]> {
    throw new Error("Embedding-Provider nicht verfügbar.");
  }

  async embedBatch(): Promise<number[][]> {
    throw new Error("Embedding-Provider nicht verfügbar.");
  }
}

let override: EmbeddingProvider | null = null;
let openaiSingleton: OpenAIEmbeddingProvider | null = null;

export function embeddingProviderAvailable(provider: EmbeddingProvider = getEmbeddingProvider()): boolean {
  return provider.id !== "unavailable" && provider.dimensions() > 0;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (override) return override;
  if (hasOpenAIApiKey()) {
    openaiSingleton ??= new OpenAIEmbeddingProvider();
    return openaiSingleton;
  }
  return new UnavailableEmbeddingProvider();
}

export function setEmbeddingProviderForTests(provider: EmbeddingProvider | null): void {
  override = provider;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function createTestEmbeddingProvider(): EmbeddingProvider {
  return new MockEmbeddingProvider();
}
