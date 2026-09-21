import { registerAgent, getAgent, listAgents } from "@/agents/registry";
import { researchAgent } from "@/agents/research";
import { communicationAgent } from "@/agents/communication";
import { taskAgent } from "@/agents/tasks";
import { projectAgent } from "@/agents/projects";
import {
  calendarAgent,
  documentAgent,
  meetingAgent,
  watchAgent,
  contactAgent,
  browserAgent,
  qualityAgent,
} from "@/agents/stubs";

let bootstrapped = false;

export function bootstrapAgents(): void {
  if (bootstrapped) return;
  registerAgent(researchAgent);
  registerAgent(communicationAgent);
  registerAgent(taskAgent);
  registerAgent(projectAgent);
  registerAgent(calendarAgent);
  registerAgent(documentAgent);
  registerAgent(meetingAgent);
  registerAgent(watchAgent);
  registerAgent(contactAgent);
  registerAgent(browserAgent);
  registerAgent(qualityAgent);
  bootstrapped = true;
}

export { getAgent, listAgents };
