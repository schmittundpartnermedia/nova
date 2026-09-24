import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { ApprovalStatus } from "@/types";

export const STANDING_ACTION_TYPES = ["mail.send.batch", "macos.ui.click"] as const;

export type StandingActionType = (typeof STANDING_ACTION_TYPES)[number];

export function isStandingActionType(value: string): value is StandingActionType {
  return (STANDING_ACTION_TYPES as readonly string[]).includes(value);
}

export function standingActionLabel(actionType: string): string {
  if (actionType === "mail.send.batch") return "Mails versenden";
  if (actionType === "macos.ui.click") return "UI-Klicks auf dem Mac";
  return actionType;
}

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
  if (!isStandingActionType(input.actionType)) {
    throw new Error("Für diese Aktion gibt es keine Dauerfreigabe.");
  }
  const existing = await findMatchingPolicy({
    organizationId: input.organizationId,
    actionType: input.actionType,
  });
  const data = {
    name: input.name,
    scope: input.scope ?? "organization",
    conditions: JSON.stringify(input.conditions ?? {}),
    limits: JSON.stringify(input.limits ?? {}),
    revokedAt: null,
  };
  if (existing) {
    return prisma.approvalPolicy.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.approvalPolicy.create({
    data: {
      organizationId: input.organizationId,
      actionType: input.actionType,
      ...data,
    },
  });
}

export async function listStandingPolicies(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.approvalPolicy.findMany({
    where: { organizationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeStandingPolicy(input: { organizationId: string; policyId: string }) {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.approvalPolicy.findFirst({
    where: { id: input.policyId, organizationId: input.organizationId, revokedAt: null },
  });
  if (!existing) {
    throw new Error("Dauerfreigabe nicht gefunden.");
  }
  return prisma.approvalPolicy.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
}

export async function listPendingApprovals(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.approvalRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}
