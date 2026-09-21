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
    `${name} ist vorbereitet, aber nicht konfiguriert. In V1 ist MockAIProvider aktiv. API-Keys gehören ausschließlich in Environment Variables.`,
  );
}

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAIProvider";

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
    const key = process.env.OPENAI_API_KEY;
    return {
      ok: false,
      provider: this.id,
      message: key
        ? "OpenAI-Key vorhanden, Provider-Implementierung in V1 noch nicht angebunden."
        : "Kein OPENAI_API_KEY gesetzt. Interface vorbereitet.",
    };
  }
}
