import type { NovaAgent } from "@/types/agents";
import { detectCodingIntent } from "@/agents/coding/intent";
import { runCodingWorkflow, type CodingAgentResult } from "@/agents/coding/workflow";
import { cancelCodingSessions, consumeCodingCancel } from "@/services/coding/sessions";
import { cancelDesktopJobs } from "@/agents/computer/client";

export type { CodingAgentResult };

export const codingAgent: NovaAgent = {
  definition: {
    id: "coding",
    name: "Coding Agent",
    description: "Softwareentwicklung über Cursor Agent CLI. Plant, delegiert, prüft und iteriert. Nicht der Master.",
    capabilities: ["coding", "cursor", "implementation", "verification", "website"],
    requiredTools: ["nova-desktop-service", "cursor-agent-cli"],
    inputSchema: { userRequest: "string", projectId: "string?" },
    outputSchema: { status: "string", verified: "boolean" },
    riskLevel: "high",
    implemented: true,
  },
  async run(input, context) {
    const userRequest = String(input.userRequest ?? context.userRequest);
    const result = await runCodingAgent({
      organizationId: context.organizationId,
      jobId: context.jobId,
      userRequest,
    });
    return {
      ok: result.ok,
      summary: result.summary,
      data: {
        codingStatus: result.status,
        verified: result.verified,
        reply: result.reply,
        sessionId: result.sessionId ?? null,
        projectPath: result.projectPath ?? null,
        checks: result.checks,
      },
    };
  },
};

export async function runCodingAgent(input: {
  organizationId: string;
  jobId?: string;
  userRequest: string;
  onStatus?: (message: string) => void;
}): Promise<CodingAgentResult> {
  const intent = detectCodingIntent(input.userRequest);
  return runCodingWorkflow({
    organizationId: input.organizationId,
    jobId: input.jobId,
    userRequest: input.userRequest,
    intent: intent.kind === "none" ? { ...intent, kind: "implement", userCommissioned: true, statusMessage: "Cursor setzt den Auftrag um." } : intent,
    onStatus: input.onStatus,
  });
}

export async function cancelCodingWork(organizationId: string): Promise<{ count: number }> {
  consumeCodingCancel(organizationId);
  const count = await cancelCodingSessions(organizationId);
  await cancelDesktopJobs();
  return { count };
}
