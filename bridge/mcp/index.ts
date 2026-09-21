import { bridgeToolNames } from "@/bridge/api/tools";

/**
 * MCP-Server-Grundstruktur.
 * Kein laufender MCP-Prozess in V1 – nur das Vertragsgerüst für spätere Anbindung.
 */
export function getMcpToolCatalog() {
  return bridgeToolNames.map((name) => ({
    name,
    description: `NOVA Bridge Tool ${name}. Immer organization-scoped.`,
  }));
}

export const mcpManifest = {
  name: "nova-bridge",
  version: "0.1.0",
  status: "prepared",
  note: "MCP ist architektonisch vorgesehen. V1 stellt REST-Endpunkte unter /api/bridge bereit.",
};
