import { z } from "zod";
import type { RiskLevel } from "@/types";

export const agentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  requiredTools: z.array(z.string()),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "medium", "high"]),
  implemented: z.boolean(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema> & {
  riskLevel: RiskLevel;
};

export type AgentRunContext = {
  organizationId: string;
  jobId: string;
  userRequest: string;
  goal: string;
  projectId?: string;
  aiModel?: string;
};

export type AgentRunResult = {
  ok: boolean;
  summary: string;
  data: Record<string, unknown>;
  mock?: boolean;
};

export interface NovaAgent {
  definition: AgentDefinition;
  run(input: Record<string, unknown>, context: AgentRunContext): Promise<AgentRunResult>;
}
