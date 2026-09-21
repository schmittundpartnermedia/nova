export type GenerateInput = {
  system?: string;
  prompt: string;
  temperature?: number;
  model?: string;
};

export type GenerateOutput = {
  text: string;
  provider: string;
  model: string;
};

export type ReasonInput = {
  goal: string;
  context: string;
  constraints?: string[];
  model?: string;
};

export type ReasonOutput = {
  reasoning: string;
  plan: string[];
  provider: string;
};

export type StructuredInput = {
  prompt: string;
  schemaName: string;
  schemaDescription: string;
  model?: string;
};

export type ToolCallInput = {
  prompt: string;
  tools: Array<{ name: string; description: string }>;
  model?: string;
};

export type ToolCallOutput = {
  tool?: string;
  arguments?: Record<string, unknown>;
  text?: string;
};

export type StreamChunk = {
  delta: string;
  done: boolean;
};

export type HealthCheckResult = {
  ok: boolean;
  provider: string;
  message: string;
};

export interface AIProvider {
  id: string;
  name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  reason(input: ReasonInput): Promise<ReasonOutput>;
  structuredOutput<T>(input: StructuredInput): Promise<T>;
  toolCall(input: ToolCallInput): Promise<ToolCallOutput>;
  stream(input: GenerateInput): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<HealthCheckResult>;
}

export type AIRole = "master" | "simple" | "sensitive" | "fallback";

export type ProviderMode = "openai" | "mock" | "fallback" | "error";

export type AIRoutingDecision = {
  role: AIRole;
  providerId: string;
  requestedProviderId: string;
  model: string;
  fallback: boolean;
  reason: string;
};
