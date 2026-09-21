import type {
  AIProvider,
  GenerateInput,
  GenerateOutput,
  HealthCheckResult,
  ReasonInput,
  ReasonOutput,
  StreamChunk,
  StructuredInput,
  ToolCallInput,
  ToolCallOutput,
} from "@/types/ai";

function notConfigured(name: string): Error {
  return new Error(
    `${name} ist vorbereitet (Ollama / LM Studio), aber in V1 nicht angebunden.`,
  );
}

export class LocalAIProvider implements AIProvider {
  id = "local";
  name = "LocalAIProvider";

  async generate(_input: GenerateInput): Promise<GenerateOutput> {
    throw notConfigured(this.name);
  }
  async reason(_input: ReasonInput): Promise<ReasonOutput> {
    throw notConfigured(this.name);
  }
  async structuredOutput<T>(_input: StructuredInput): Promise<T> {
    throw notConfigured(this.name);
  }
  async toolCall(_input: ToolCallInput): Promise<ToolCallOutput> {
    throw notConfigured(this.name);
  }
  async *stream(_input: GenerateInput): AsyncIterable<StreamChunk> {
    throw notConfigured(this.name);
  }
  async healthCheck(): Promise<HealthCheckResult> {
    const base = process.env.LOCAL_AI_BASE_URL;
    return {
      ok: false,
      provider: this.id,
      message: base
        ? `LOCAL_AI_BASE_URL=${base} gesetzt, LocalAIProvider in V1 noch nicht angebunden.`
        : "Kein LOCAL_AI_BASE_URL gesetzt. Interface für Ollama/LM Studio vorbereitet.",
    };
  }
}
