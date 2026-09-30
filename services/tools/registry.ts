import { gedaechtnisLesenTool, gedaechtnisSchreibenTool } from "@/services/tools/gedaechtnis";
import { MAIL_TOOLS } from "@/services/tools/mail";
import { KAMPAGNE_TOOLS } from "@/services/tools/kampagne";
import { KONTAKT_TOOLS } from "@/services/tools/kontakte";
import { TAGESBETRIEB_TOOLS } from "@/services/tools/tagesbetrieb";
import { novaStatusTool } from "@/services/tools/status";
import { CLAUDE_TOOLS } from "@/services/tools/claude";
import type { NovaToolDefinition, NovaToolResult, ToolContext } from "@/services/tools/types";

const tools = new Map<string, NovaToolDefinition>();

function register(tool: NovaToolDefinition): void {
  tools.set(tool.name, tool);
}

let bootstrapped = false;

/** Gedächtnis (Phase 1), Mail und Vorlagen (Phase 2), Kampagnen (Phase 3), Kundensuche, Kontaktlisten und Kunden-Tagesbetrieb (Phase 4). */
export function bootstrapTools(): void {
  if (bootstrapped) return;
  register(gedaechtnisLesenTool);
  register(gedaechtnisSchreibenTool);
  for (const tool of MAIL_TOOLS) register(tool);
  for (const tool of KAMPAGNE_TOOLS) register(tool);
  for (const tool of KONTAKT_TOOLS) register(tool);
  for (const tool of TAGESBETRIEB_TOOLS) register(tool);
  for (const tool of CLAUDE_TOOLS) register(tool);
  register(novaStatusTool);
  bootstrapped = true;
}

export function listTools(): NovaToolDefinition[] {
  bootstrapTools();
  return [...tools.values()];
}

export function getTool(name: string): NovaToolDefinition | undefined {
  bootstrapTools();
  return tools.get(name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<NovaToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, executed: false, error: `Unbekanntes Werkzeug: ${name}` };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (error) {
    return { ok: false, executed: false, error: error instanceof Error ? error.message : "Werkzeug fehlgeschlagen." };
  }
}
