import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { redactUnknown } from "@/lib/computer/redaction";
import { parseComputerPlan, RESUMABLE_COMPUTER_STATUSES, serializeComputerPlan, type ComputerPlan } from "@/lib/computer/plan";
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

export async function interruptStaleComputerJobs(organizationId?: string) {
  const staleBefore = new Date(Date.now() - 90_000);
  return prisma.computerJob.updateMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      status: "EXECUTING",
      cancelRequested: false,
      startedAt: { lt: staleBefore },
      finishedAt: null,
    },
    data: {
      status: "INTERRUPTED",
      error: "Der Prozess wurde unterbrochen. Sag „mach weiter“, dann setze ich am letzten Schritt an.",
    },
  });
}

export async function findResumableComputerJob(
  organizationId: string,
  options?: { jobId?: string; waitingApproval?: boolean },
) {
  assertOrganizationId(organizationId);
  if (!options?.waitingApproval) await interruptStaleComputerJobs(organizationId);
  const job = await prisma.computerJob.findFirst({
    where: {
      organizationId,
      cancelRequested: false,
      status: { in: options?.waitingApproval ? ["WAITING_FOR_APPROVAL"] : [...RESUMABLE_COMPUTER_STATUSES] },
      ...(options?.jobId ? { jobId: options.jobId } : {}),
    },
    orderBy: { startedAt: "desc" },
  });
  if (!job) return null;
  const plan = parseComputerPlan(job.plan) ?? { steps: [], cursor: 0 };
  // WAITING_FOR_HUMAN / INTERRUPTED / FAILED müssen auch ohne offene Plan-Schritte fortsetzbar sein.
  if (
    plan.steps.length > 0 &&
    plan.cursor >= plan.steps.length &&
    job.status !== "WAITING_FOR_HUMAN" &&
    job.status !== "INTERRUPTED" &&
    job.status !== "FAILED"
  ) {
    return null;
  }
  return { job, plan };
}

export async function saveComputerPlan(input: {
  organizationId: string;
  id: string;
  status: ComputerJobStatus;
  plan: ComputerPlan;
  error?: string;
  finished?: boolean;
}) {
  return updateComputerJob({
    organizationId: input.organizationId,
    id: input.id,
    status: input.status,
    plan: serializeComputerPlan(input.plan),
    error: input.error,
    finished: input.finished,
  });
}
