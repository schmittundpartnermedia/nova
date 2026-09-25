export const EMBEDDING_VERSION = 1;

export interface EmbeddingProvider {
  id: string;
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
  model(): string;
}

export type EmbeddingUsageRecord = {
  calls: number;
  texts: number;
  tokens: number;
  model: string;
  provider: string;
};
