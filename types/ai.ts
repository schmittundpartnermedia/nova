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

/** Ein Werkzeug für den Kopf (OpenAI Responses / Function Tools). */
export type HeadToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

export type HeadInputMessage =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call_output"; call_id: string; output: string };

export type HeadToolCall = {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type HeadTurnInput = {
  instructions: string;
  input: HeadInputMessage[];
  tools: HeadToolSpec[];
  model?: string;
  /** Innerhalb einer Tool-Schleife: vorherige Response-ID. */
  previousResponseId?: string;
};

export type HeadTurnOutput = {
  responseId: string;
  text: string;
  toolCalls: HeadToolCall[];
  model: string;
  provider: string;
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

/** Screenshot / Bild → strukturierte Wahrnehmung (nicht dauerhaft speichern). */
export type AnalyzeImageInput = {
  /** PNG/JPEG als data-URL oder Roh-Base64 */
  imageBase64: string;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  question: string;
  model?: string;
};

export type ScreenPerception = {
  summary: string;
  windows: Array<{ title: string; app?: string; focused?: boolean }>;
  elements: Array<{ label: string; role?: string; value?: string }>;
  state: string;
  provider: string;
  model: string;
};

export interface AIProvider {
  id: string;
  name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  reason(input: ReasonInput): Promise<ReasonOutput>;
  structuredOutput<T>(input: StructuredInput): Promise<T>;
  toolCall(input: ToolCallInput): Promise<ToolCallOutput>;
  /**
   * Ein Kopf-Schritt (Responses API bei OpenAI). Unterstützt Function Tools.
   * Chat Completions mit tools ist für gpt-6-* nicht nutzbar.
   */
  headTurn?(input: HeadTurnInput): Promise<HeadTurnOutput>;
  stream(input: GenerateInput): AsyncIterable<StreamChunk>;
  healthCheck(): Promise<HealthCheckResult>;
  /** Optional: Vision. Stub-Provider werfen oder melden „später“. */
  analyzeImage?(input: AnalyzeImageInput): Promise<ScreenPerception>;
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
