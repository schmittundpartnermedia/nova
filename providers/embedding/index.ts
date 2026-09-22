export interface EmbeddingProvider {
  id: string;
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DIM = 64;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  id = "local-hash";
  model = "ngram-hash-64";

  async embed(texts: string[]): Promise<number[][]> {
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

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  id = "openai";
  model = "text-embedding-3-small";

  async embed(texts: string[]): Promise<number[][]> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error("OPENAI_API_KEY fehlt für Embeddings.");
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, input: texts.slice(0, 32) }),
    });
    if (!response.ok) throw new Error("OpenAI Embeddings nicht erreichbar.");
    const body = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return (body.data ?? []).map((item) => item.embedding);
  }
}

let override: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (override) return override;
  return new LocalHashEmbeddingProvider();
}

export function setEmbeddingProviderForTests(provider: EmbeddingProvider | null): void {
  override = provider;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}
