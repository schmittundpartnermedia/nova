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

export async function listPendingApprovals(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.approvalRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}
