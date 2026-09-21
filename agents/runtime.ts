import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { addJobStep, completeJobStep, updateJobStatus } from "@/services/jobs";
import type { AgentRunContext, NovaAgent } from "@/types/agents";

export async function runAgentStep(input: {
  agent: NovaAgent;
  action: string;
  payload: Record<string, unknown>;
  context: AgentRunContext;
}) {
  assertOrganizationId(input.context.organizationId);
  const step = await addJobStep({
    organizationId: input.context.organizationId,
    jobId: input.context.jobId,
    agent: input.agent.definition.id,
    action: input.action,
    input: input.payload,
  });

  try {
    const result = await input.agent.run(input.payload, input.context);
    await completeJobStep({
      organizationId: input.context.organizationId,
      stepId: step.id,
      status: result.ok ? "completed" : "failed",
      output: result,
      error: result.ok ? undefined : result.summary,
    });
    return { stepId: step.id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Agent-Fehler";
    await completeJobStep({
      organizationId: input.context.organizationId,
      stepId: step.id,
      status: "failed",
      error: message,
    });
    await updateJobStatus(input.context.organizationId, input.context.jobId, "failed");
    throw error;
  }
}

export async function getDefaultProject(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.project.findFirst({
    where: { organizationId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
}
