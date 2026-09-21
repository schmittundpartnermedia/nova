import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { redactUnknown } from "@/lib/computer/redaction";
import type { ActionResult, ComputerJobStatus } from "@/lib/computer/types";

export async function createComputerJob(input: {
  organizationId: string;
  jobId?: string;
  goal: string;
  userRequest: string;
  status?: ComputerJobStatus;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.computerJob.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      goal: input.goal,
      userRequest: input.userRequest,
      status: input.status ?? "PLANNED",
    },
  });
}

export async function updateComputerJob(input: {
  organizationId: string;
  id: string;
  status: ComputerJobStatus;
  plan?: unknown;
  result?: unknown;
  error?: string;
  cancelRequested?: boolean;
  finished?: boolean;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.computerJob.updateMany({
    where: { id: input.id, organizationId: input.organizationId },
    data: {
      status: input.status,
      plan: input.plan ? JSON.stringify(redactUnknown(input.plan)) : undefined,
      result: input.result ? JSON.stringify(redactUnknown(input.result)) : undefined,
      error: input.error,
      cancelRequested: input.cancelRequested,
      finishedAt: input.finished ? new Date() : undefined,
    },
  });
}

export async function recordComputerAction(input: {
  organizationId: string;
  jobId?: string;
  stepId?: string;
  computerJobId?: string;
  action: ActionResult;
  approvalId?: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.computerAction.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      stepId: input.stepId,
      tool: input.action.tool,
      action: input.action.action,
      target: input.action.target,
      riskLevel: input.action.riskLevel,
      approvalId: input.approvalId,
      status: input.action.success
        ? input.action.verification?.verified
          ? "VERIFIED"
          : "EXECUTED"
        : input.action.error?.code === "approval_required"
          ? "WAITING_FOR_APPROVAL"
          : "FAILED",
      startedAt: new Date(input.action.startedAt),
      finishedAt: new Date(input.action.finishedAt),
      verification: input.action.verification ? JSON.stringify(input.action.verification) : null,
      error: input.action.error?.message,
      metadata: input.action.metadata ? JSON.stringify(redactUnknown(input.action.metadata)) : null,
    },
  });
}

export async function requestComputerCancel(organizationId: string): Promise<number> {
  assertOrganizationId(organizationId);
  const running = await prisma.computerJob.updateMany({
    where: {
      organizationId,
      status: { in: ["PLANNED", "PREPARED", "EXECUTING"] },
    },
    data: {
      cancelRequested: true,
      status: "CANCELLED_BY_USER",
      finishedAt: new Date(),
    },
  });
  return running.count;
}

export async function hasCancelRequest(organizationId: string, computerJobId: string): Promise<boolean> {
  const job = await prisma.computerJob.findFirst({
    where: { id: computerJobId, organizationId },
    select: { cancelRequested: true, status: true },
  });
  return Boolean(job?.cancelRequested || job?.status === "CANCELLED_BY_USER");
}

export async function listTodayComputerActions(organizationId: string) {
  assertOrganizationId(organizationId);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.computerAction.findMany({
    where: { organizationId, startedAt: { gte: start } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
}
