import { gedaechtnisLesenTool, gedaechtnisSchreibenTool } from "@/services/tools/gedaechtnis";
import { MAIL_TOOLS } from "@/services/tools/mail";
import type { NovaToolDefinition, NovaToolResult, ToolContext } from "@/services/tools/types";

const tools = new Map<string, NovaToolDefinition>();

function register(tool: NovaToolDefinition): void {
  tools.set(tool.name, tool);
}

let bootstrapped = false;

/** Phase 2: Gedächtnis + Mail/Vorlagen/Dauerfreigabe. */
export function bootstrapTools(): void {
  if (bootstrapped) return;
  register(gedaechtnisLesenTool);
  register(gedaechtnisSchreibenTool);
  for (const tool of MAIL_TOOLS) register(tool);
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
  return (await tool.execute(args, ctx)) as NovaToolResult;
}
