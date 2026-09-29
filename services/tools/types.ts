export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export type ToolContext = {
  organizationId: string;
  jobId?: string;
};

export type NovaToolDefinition = {
  /** API-Name (OpenAI: nur [a-zA-Z0-9_-]). Konzeptuell: mail.lesen → mail_lesen */
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> | unknown;
};

export type NovaToolResult = {
  ok: boolean;
  /** true nur bei tatsächlicher externer Aktion (z. B. Mail gesendet). */
  executed: boolean;
  data?: unknown;
  error?: string;
};
