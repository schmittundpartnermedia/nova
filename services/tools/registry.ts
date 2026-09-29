import { gedaechtnisLesenTool, gedaechtnisSchreibenTool } from "@/services/tools/gedaechtnis";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

const tools = new Map<string, NovaToolDefinition>();

function register(tool: NovaToolDefinition): void {
  tools.set(tool.name, tool);
}

let bootstrapped = false;

/** Phase 1: nur Gedächtnis. Spätere Phasen melden weitere Werkzeuge hier an. */
export function bootstrapTools(): void {
  if (bootstrapped) return;
  register(gedaechtnisLesenTool);
  register(gedaechtnisSchreibenTool);
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
): Promise<NovaToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, executed: false, error: `Unbekanntes Werkzeug: ${name}` };
  }
  return (await tool.execute(args)) as NovaToolResult;
}
