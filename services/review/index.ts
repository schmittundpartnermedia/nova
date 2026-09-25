import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { recordActivity } from "@/services/archive";
import { dismissOwnedReviewWindow, openForReview, type WindowOwnership } from "@/services/review/windows";
import { ACTIVE_REVIEW_STATUSES, type ReviewStatus, type ReviewType } from "@/types/workspace";

export async function createReviewSession(input: {
  organizationId: string;
  jobId: string;
  artifactId?: string;
  approvalRequestId?: string;
  type: ReviewType;
  target: string;
  application?: string;
  resumeStep?: string;
}) {
  assertOrganizationId(input.organizationId);
  const session = await prisma.reviewSession.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      artifactId: input.artifactId,
      approvalRequestId: input.approvalRequestId,
      type: input.type,
      target: input.target,
      application: input.application,
      status: "OPENING",
      resumeStep: input.resumeStep,
    },
  });
  const opened = await openForReview({
    organizationId: input.organizationId,
    jobId: input.jobId,
    type: input.type,
    target: input.target,
  });
  const status: ReviewStatus = opened.ok ? "AWAITING_REVIEW" : "FAILED";
  const updated = await prisma.reviewSession.update({
    where: { id: session.id },
    data: {
      status,
      application: opened.application ?? input.application,
      openedAt: opened.ok ? new Date() : null,
      ownership: JSON.stringify(opened.ownership),
    },
  });
  await recordActivity({
    organizationId: input.organizationId,
    type: "review",
    title: opened.ok ? "Zur Prüfung geöffnet" : "Prüfung vorbereitet, Fenster fehlgeschlagen",
    description: opened.message,
    status: "prepared",
    jobId: input.jobId,
    externalReference: updated.id,
    metadata: {
      reviewSessionId: updated.id,
      artifactId: input.artifactId ?? null,
      target: input.target,
      application: updated.application,
      windowOpened: opened.ok,
    },
  });
  return updated;
}

export async function findActiveReview(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.reviewSession.findFirst({
    where: { organizationId, status: { in: ACTIVE_REVIEW_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

export function parseOwnership(raw: string | null): WindowOwnership | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WindowOwnership;
    if (!value || typeof value !== "object" || typeof value.openedTarget !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

export async function closeReviewWindow(input: {
  organizationId: string;
  jobId: string;
  sessionId: string;
  ownership: string | null;
}) {
  return dismissOwnedReviewWindow({
    organizationId: input.organizationId,
    jobId: input.jobId,
    sessionId: input.sessionId,
    ownership: parseOwnership(input.ownership),
  });
}

/**
 * Anschluss für das bestehende Mail-System.
 * Wird vom Mail-Versand nicht aufgerufen, damit der funktionierende Apple-Mail-Pfad unverändert bleibt.
 * Ein späterer Mail-Workflow kann damit einen Draft als ReviewSession registrieren und an eine ApprovalRequest koppeln.
 */
export async function registerMailDraftReview(input: {
  organizationId: string;
  jobId: string;
  approvalRequestId?: string;
  target: string;
  artifactId?: string;
}) {
  return createReviewSession({
    ...input,
    type: "MAIL_DRAFT",
    application: "Mail",
    resumeStep: "mail.send",
  });
}
