import type { EmbeddingModel } from "openai/resources/embeddings";

/** Modelle aus der installierten OpenAI-SDK-Typdefinition, nicht aus Erinnerung. */
export const SDK_EMBEDDING_MODELS: readonly EmbeddingModel[] = [
  "text-embedding-ada-002",
  "text-embedding-3-small",
  "text-embedding-3-large",
];

/** SDK-Beispiel für semantische Embeddings: text-embedding-3-small. */
export const SDK_DEFAULT_EMBEDDING_MODEL: EmbeddingModel = "text-embedding-3-small";

const NATIVE_DIMENSIONS: Record<EmbeddingModel, number> = {
  "text-embedding-ada-002": 1536,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

export function resolveOpenAIEmbeddingModel(configured?: string | null): string {
  const value = (configured ?? process.env.OPENAI_EMBEDDING_MODEL ?? "").trim();
  if (value && (SDK_EMBEDDING_MODELS as readonly string[]).includes(value)) return value;
  if (value) return value;
  return SDK_DEFAULT_EMBEDDING_MODEL;
}

export function nativeDimensionsFor(model: string): number {
  if ((SDK_EMBEDDING_MODELS as readonly string[]).includes(model)) {
    return NATIVE_DIMENSIONS[model as EmbeddingModel];
  }
  return NATIVE_DIMENSIONS[SDK_DEFAULT_EMBEDDING_MODEL];
}
