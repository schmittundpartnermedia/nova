import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { ApprovalStatus } from "@/types";

export async function createApprovalRequest(input: {
  organizationId: string;
  jobId?: string;
  actionType: string;
  description: string;
  payload: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.approvalRequest.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: input.actionType,
      description: input.description,
      payload: JSON.stringify(input.payload),
      status: "pending",
    },
  });
}

export async function decideApproval(input: {
  organizationId: string;
  approvalId: string;
  status: Exclude<ApprovalStatus, "pending">;
}) {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.approvalRequest.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId },
  });
  if (!existing) {
    throw new Error("Freigabe nicht gefunden.");
  }

  return prisma.approvalRequest.update({
    where: { id: input.approvalId },
    data: {
      status: input.status,
      approvedAt: input.status === "approved" ? new Date() : null,
    },
  });
}

export async function findMatchingPolicy(input: {
  organizationId: string;
  actionType: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.approvalPolicy.findFirst({
    where: {
      organizationId: input.organizationId,
      actionType: input.actionType,
      revokedAt: null,
    },
  });
}

export async function standingApprovalAllows(input: {
  organizationId: string;
  actionType: string;
}): Promise<{ allowed: boolean; policyId?: string; reason: string }> {
  const policy = await findMatchingPolicy(input);
  if (!policy) {
    return { allowed: false, reason: "Keine Dauerfreigabe." };
  }
  let maxPerDay = 0;
  try {
    const limits = JSON.parse(policy.limits || "{}") as { maxPerDay?: number };
    maxPerDay = Number(limits.maxPerDay ?? 0);
  } catch {
    maxPerDay = 0;
  }
  if (maxPerDay > 0) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const used = await prisma.approvalRequest.count({
      where: {
        organizationId: input.organizationId,
        actionType: input.actionType,
        status: "approved",
        approvedAt: { gte: start },
      },
    });
    if (used >= maxPerDay) {
      return { allowed: false, policyId: policy.id, reason: "Tageslimit der Dauerfreigabe ist erreicht." };
    }
  }
  return { allowed: true, policyId: policy.id, reason: `Dauerfreigabe „${policy.name}“.` };
}

export async function consumeStandingApproval(input: {
  organizationId: string;
  actionType: string;
  jobId?: string;
  description: string;
  payload?: Record<string, unknown>;
}): Promise<{ allowed: boolean; policyId?: string; reason: string }> {
  const standing = await standingApprovalAllows(input);
  if (!standing.allowed || !standing.policyId) return standing;
  await prisma.approvalRequest.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: input.actionType,
      description: input.description,
      payload: JSON.stringify(input.payload ?? { standing: true, policyId: standing.policyId }),
      status: "approved",
      approvedAt: new Date(),
    },
  });
  return standing;
}

export async function createStandingPolicy(input: {
  organizationId: string;
  name: string;
  actionType: string;
  scope?: string;
  conditions?: Record<string, unknown>;
  limits?: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.approvalPolicy.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      actionType: input.actionType,
      scope: input.scope ?? "organization",
      conditions: JSON.stringify(input.conditions ?? {}),
      limits: JSON.stringify(input.limits ?? {}),
    },
  });
}

export async function listPendingApprovals(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.approvalRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}
