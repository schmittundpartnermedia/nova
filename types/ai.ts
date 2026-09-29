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

export type HealthCheckResult = {
  ok: boolean;
  provider: string;
  message: string;
};

/** Das Modell hinter dem Kopf: ein Schritt mit Werkzeugen, plus Erreichbarkeitsprüfung. */
export interface HeadProvider {
  id: string;
  headTurn(input: HeadTurnInput): Promise<HeadTurnOutput>;
  healthCheck(): Promise<HealthCheckResult>;
}

/** Was die Oberfläche über den Anbieter erfährt: echte API oder Fehler. */
export type ProviderMode = "openai" | "error";
