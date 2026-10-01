import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { ApprovalStatus } from "@/types";

/** Aktionen, für die der Nutzer eine Dauerfreigabe erteilen kann. */
export const STANDING_ACTION_TYPES = ["mail.send", "scanner.start"] as const;

export type StandingActionType = (typeof STANDING_ACTION_TYPES)[number];

export function isStandingActionType(value: string): value is StandingActionType {
  return (STANDING_ACTION_TYPES as readonly string[]).includes(value);
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

/** Offene Freigaben gelten so lange; danach fragt NOVA neu (sonst sammeln sich vergessene Rückfragen an). */
export const FREIGABE_GUELTIG_STUNDEN = 48;

/** Setzt offene Freigaben, die älter als FREIGABE_GUELTIG_STUNDEN sind, auf „expired“. Erteilte bleiben unberührt. */
export async function schliesseAbgelaufeneFreigaben(organizationId: string, jetzt = new Date()): Promise<number> {
  assertOrganizationId(organizationId);
  const ergebnis = await prisma.approvalRequest.updateMany({
    where: { organizationId, status: "pending", createdAt: { lt: new Date(jetzt.getTime() - FREIGABE_GUELTIG_STUNDEN * 3_600_000) } },
    data: { status: "expired" },
  });
  return ergebnis.count;
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

export async function findMatchingPolicy(input: { organizationId: string; actionType: string }) {
  assertOrganizationId(input.organizationId);
  return prisma.approvalPolicy.findFirst({
    where: {
      organizationId: input.organizationId,
      actionType: input.actionType,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

function startOfToday(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Heute tatsächlich versendete Mails (im Ordner Gesendet bestätigt). */
export async function mailsSentToday(organizationId: string): Promise<number> {
  assertOrganizationId(organizationId);
  return prisma.communication.count({
    where: { organizationId, channel: "email", status: "sent", sentAt: { gte: startOfToday() } },
  });
}

/** Heute gestartete Läufe des Lead-Scanners. */
export async function scannerRunsToday(organizationId: string): Promise<number> {
  assertOrganizationId(organizationId);
  return prisma.workItem.count({
    where: { organizationId, kind: "scanner.lauf", status: { not: "cancelled" }, createdAt: { gte: startOfToday() } },
  });
}

export function policyMaxPerDay(policy: { limits: string }): number {
  try {
    const limits = JSON.parse(policy.limits || "{}") as { maxPerDay?: number };
    return Math.max(0, Number(limits.maxPerDay ?? 0) || 0);
  } catch {
    return 0;
  }
}

export async function createStandingPolicy(input: {
  organizationId: string;
  name: string;
  actionType: string;
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
    scope: "organization",
    conditions: JSON.stringify(input.conditions ?? {}),
    limits: JSON.stringify(input.limits ?? {}),
    revokedAt: null,
  };
  if (existing) {
    return prisma.approvalPolicy.update({ where: { id: existing.id }, data });
  }
  return prisma.approvalPolicy.create({
    data: { organizationId: input.organizationId, actionType: input.actionType, ...data },
  });
}

export async function revokeStandingPolicy(input: { organizationId: string; actionType: StandingActionType }) {
  assertOrganizationId(input.organizationId);
  const result = await prisma.approvalPolicy.updateMany({
    where: { organizationId: input.organizationId, actionType: input.actionType, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export {
  authorizeExternalAction,
  isIrreversibleAction,
  type AuthorizeExternalInput,
  type AuthorizeExternalResult,
  type ExternalRiskLevel,
} from "@/services/approvals/authorize";
