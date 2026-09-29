import type { Postfach } from "@/services/mail/postfach";

export type ToolJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

/** Was ein Werkzeug über die laufende Anfrage weiß. */
export type ToolContext = {
  organizationId: string;
  jobId?: string;
  postfach: Postfach;
};

export type NovaToolDefinition = {
  /** API-Name (OpenAI: nur [a-zA-Z0-9_-]). Konzeptuell: gedaechtnis.lesen → gedaechtnis_lesen */
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<NovaToolResult> | NovaToolResult;
};

export type NovaToolResult = {
  ok: boolean;
  /**
   * true nur, wenn die verlangte Wirkung real eingetreten ist (Datei geschrieben, Entwurf gespeichert,
   * Freigabe gespeichert, Mail im Ordner Gesendet bestätigt). Lesen ist nie executed.
   */
  executed: boolean;
  data?: unknown;
  error?: string;
};
