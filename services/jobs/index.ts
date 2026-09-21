import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { JobStatus, JobStepStatus } from "@/types";

export async function createJob(input: {
  organizationId: string;
  userRequest: string;
  goal: string;
  projectId?: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.job.create({
    data: {
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      goal: input.goal,
      projectId: input.projectId,
      status: "pending",
    },
  });
}

export async function updateJobStatus(
  organizationId: string,
  jobId: string,
  status: JobStatus,
  extra?: { startedAt?: Date; completedAt?: Date },
) {
  assertOrganizationId(organizationId);
  return prisma.job.updateMany({
    where: { id: jobId, organizationId },
    data: {
      status,
      ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
    },
  });
}

export async function addJobStep(input: {
  organizationId: string;
  jobId: string;
  agent: string;
  action: string;
  input: unknown;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.jobStep.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      agent: input.agent,
      action: input.action,
      status: "pending",
      input: JSON.stringify(input.input),
    },
  });
}

export async function completeJobStep(input: {
  organizationId: string;
  stepId: string;
  status: JobStepStatus;
  output?: unknown;
  error?: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.jobStep.updateMany({
    where: { id: input.stepId, organizationId: input.organizationId },
    data: {
      status: input.status,
      output: input.output ? JSON.stringify(input.output) : undefined,
      error: input.error,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
}

export async function getJob(organizationId: string, jobId: string) {
  assertOrganizationId(organizationId);
  return prisma.job.findFirst({
    where: { id: jobId, organizationId },
    include: {
      steps: { orderBy: { id: "asc" } },
      approvalRequests: true,
      activities: { orderBy: { timestamp: "asc" } },
    },
  });
}

export async function listJobs(organizationId: string, limit = 20) {
  assertOrganizationId(organizationId);
  return prisma.job.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { steps: true, approvalRequests: true },
  });
}
