export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export type NovaToolDefinition = {
  /** API-Name (OpenAI: nur [a-zA-Z0-9_-]). Konzeptuell: gedaechtnis.lesen → gedaechtnis_lesen */
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type NovaToolResult = {
  ok: boolean;
  executed: boolean;
  data?: unknown;
  error?: string;
};
