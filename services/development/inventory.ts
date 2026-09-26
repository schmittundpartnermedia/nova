import { bootstrapAgents, listAgents } from "@/agents/bootstrap";

export function describeExistingCapabilities(): string {
  bootstrapAgents();
  const agents = listAgents()
    .filter((agent) => agent.definition.implemented)
    .map((agent) => agent.definition.name);
  return [
    ...agents,
    "Cursor Agent CLI über den Coding Agent",
    "persistente Jobs, WorkItems und Worker",
    "Approval- und Review-Prüfung",
    "Workspace, Artefakte, Knowledge und Memory",
  ].join(", ");
}
