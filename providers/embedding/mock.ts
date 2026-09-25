import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "@/providers/embedding/types";

const DIM = 32;

function vectorFor(text: string): number[] {
  const digest = createHash("sha256").update(text.toLowerCase()).digest();
  const vector = new Array<number>(DIM).fill(0);
  for (let i = 0; i < DIM; i += 1) {
    vector[i] = (digest[i % digest.length] - 128) / 128;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

/** Deterministischer Test-Provider. Keine produktive Semantik. */
export class MockEmbeddingProvider implements EmbeddingProvider {
  id = "mock";
  private readonly modelId: string;
  private readonly dims: number;

  constructor(model = "mock-embedding-v2", dimensions = DIM) {
    this.modelId = model;
    this.dims = dimensions;
  }

  model(): string {
    return this.modelId;
  }

  dimensions(): number {
    return this.dims;
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const base = vectorFor(text);
      if (base.length === this.dims) return base;
      const next = new Array<number>(this.dims).fill(0);
      for (let i = 0; i < this.dims; i += 1) next[i] = base[i % base.length];
      return next;
    });
  }
}
