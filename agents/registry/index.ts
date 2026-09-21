import type { NovaAgent } from "@/types/agents";

const registry = new Map<string, NovaAgent>();

export function registerAgent(agent: NovaAgent): void {
  registry.set(agent.definition.id, agent);
}

export function getAgent(id: string): NovaAgent | undefined {
  return registry.get(id);
}

export function listAgents(): NovaAgent[] {
  return Array.from(registry.values());
}

export function findAgentsByCapability(capability: string): NovaAgent[] {
  return listAgents().filter((agent) =>
    agent.definition.capabilities.some((item) => item.toLowerCase().includes(capability.toLowerCase())),
  );
}
