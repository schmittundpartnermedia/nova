import OpenAI from "openai";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { EMBEDDING_VERSION } from "@/providers/embedding/types";
import type { EmbeddingProvider, EmbeddingUsageRecord } from "@/providers/embedding/types";
import { nativeDimensionsFor, resolveOpenAIEmbeddingModel } from "@/providers/embedding/models";

const MAX_BATCH = 16;
const MAX_CHARS = 8000;
const MAX_ATTEMPTS = 3;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  id = "openai";
  readonly version = EMBEDDING_VERSION;
  private client: OpenAI | null = null;
  private readonly modelId: string;
  lastUsage: EmbeddingUsageRecord | null = null;

  constructor(model?: string) {
    this.modelId = resolveOpenAIEmbeddingModel(model);
  }

  model(): string {
    return this.modelId;
  }

  dimensions(): number {
    return nativeDimensionsFor(this.modelId);
  }

  async embedText(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const inputs = texts.map((text) => text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS));
    const out: number[][] = new Array(inputs.length);
    let calls = 0;
    let tokens = 0;
    for (let offset = 0; offset < inputs.length; offset += MAX_BATCH) {
      const slice = inputs.slice(offset, offset + MAX_BATCH);
      const response = await this.createWithRetry(slice);
      calls += 1;
      tokens += response.usage?.total_tokens ?? response.usage?.prompt_tokens ?? 0;
      for (const item of response.data ?? []) {
        out[offset + item.index] = item.embedding;
      }
    }
    this.lastUsage = {
      calls,
      texts: inputs.length,
      tokens,
      model: this.modelId,
      provider: this.id,
    };
    return out.map((vector) => vector ?? []);
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    if (!hasOpenAIApiKey()) throw new Error("OPENAI_API_KEY fehlt für Embeddings.");
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return this.client;
  }

  private async createWithRetry(input: string[]) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.getClient().embeddings.create({
          model: this.modelId,
          input,
          encoding_format: "float",
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        const retryable = /429|500|502|503|timeout|rate|overloaded|ECONNRESET|fetch/i.test(message);
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("OpenAI Embeddings nicht erreichbar.");
  }
}
