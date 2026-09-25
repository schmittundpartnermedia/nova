import type { EmbeddingProvider } from "@/providers/embedding/types";

const DIM = 64;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deprecated. Nur für den Legacy-vs-V2-Benchmark.
 * Nicht im produktiven Retrieval verwenden.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  id = "local-hash";
  private readonly modelId = "ngram-hash-64";

  model(): string {
    return this.modelId;
  }

  dimensions(): number {
    return DIM;
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(DIM).fill(0);
      const tokens = text
        .toLowerCase()
        .split(/[^a-z0-9äöüß]+/i)
        .filter((token) => token.length > 1);
      for (const token of tokens) {
        vector[hashToken(token) % DIM] += 1;
        if (token.length > 3) {
          for (let i = 0; i < token.length - 2; i += 1) {
            vector[hashToken(token.slice(i, i + 3)) % DIM] += 0.3;
          }
        }
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    });
  }
}
