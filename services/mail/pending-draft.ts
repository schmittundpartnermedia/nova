import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { MailDraftSpec } from "@/lib/mail/draft-spec";

export type PendingMailDraft = {
  userRequest: string;
  to: string | null;
  subject: string | null;
  bodyHint: string | null;
  suggestedFrom: string | null;
  createdAt: string;
};

const MARKER = "NOVA_PENDING_MAIL_DRAFT_V1\n";

export async function savePendingMailDraft(input: {
  organizationId: string;
  userRequest: string;
  spec: MailDraftSpec;
  suggestedFrom?: string | null;
}) {
  assertOrganizationId(input.organizationId);
  await clearPendingMailDraft(input.organizationId);
  const payload: PendingMailDraft = {
    userRequest: input.userRequest,
    to: input.spec.to,
    subject: input.spec.subject,
    bodyHint: input.spec.bodyHint,
    suggestedFrom: input.suggestedFrom ?? input.spec.from,
    createdAt: new Date().toISOString(),
  };
  return prisma.communication.create({
    data: {
      organizationId: input.organizationId,
      channel: "email",
      direction: "outbound",
      subject: input.spec.subject || "(wartet auf Absender)",
      body: `${MARKER}${JSON.stringify(payload)}`,
      status: "awaiting_sender",
      deliveryStatus: "AWAITING_SENDER",
      isMock: false,
    },
  });
}

export async function loadPendingMailDraft(organizationId: string): Promise<PendingMailDraft | null> {
  assertOrganizationId(organizationId);
  const row = await prisma.communication.findFirst({
    where: {
      organizationId,
      channel: "email",
      direction: "outbound",
      deliveryStatus: "AWAITING_SENDER",
      status: "awaiting_sender",
      sentAt: null,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!row?.body.startsWith(MARKER)) return null;
  try {
    const parsed = JSON.parse(row.body.slice(MARKER.length)) as PendingMailDraft;
    if (!parsed?.userRequest) return null;
    return {
      ...parsed,
      suggestedFrom: parsed.suggestedFrom ?? null,
    };
  } catch {
    return null;
  }
}

export async function updatePendingMailDraft(
  organizationId: string,
  patch: Partial<Pick<PendingMailDraft, "userRequest" | "to" | "subject" | "bodyHint" | "suggestedFrom">>,
) {
  assertOrganizationId(organizationId);
  const current = await loadPendingMailDraft(organizationId);
  if (!current) return null;
  const next: PendingMailDraft = {
    ...current,
    ...patch,
    createdAt: current.createdAt,
  };
  await clearPendingMailDraft(organizationId);
  return prisma.communication.create({
    data: {
      organizationId,
      channel: "email",
      direction: "outbound",
      subject: next.subject || "(wartet auf Absender)",
      body: `${MARKER}${JSON.stringify(next)}`,
      status: "awaiting_sender",
      deliveryStatus: "AWAITING_SENDER",
      isMock: false,
    },
  });
}

export async function clearPendingMailDraft(organizationId: string) {
  assertOrganizationId(organizationId);
  await prisma.communication.deleteMany({
    where: {
      organizationId,
      channel: "email",
      deliveryStatus: "AWAITING_SENDER",
      status: "awaiting_sender",
      sentAt: null,
    },
  });
}

export async function hasPendingMailDraft(organizationId: string): Promise<boolean> {
  return Boolean(await loadPendingMailDraft(organizationId));
}

export async function preferredMailAccount(organizationId: string) {
  assertOrganizationId(organizationId);
  const { isSteerableMailAddress } = await import("@/lib/mail/steerable");
  const recent = await prisma.communication.findFirst({
    where: {
      organizationId,
      channel: "email",
      direction: "outbound",
      mailAccountId: { not: null },
      deliveryStatus: { in: ["VERIFIED", "WAITING_FOR_APPROVAL", "SENDING", "PREPARED"] },
      status: { notIn: ["awaiting_sender"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (recent?.mailAccountId) {
    const account = await prisma.mailAccount.findFirst({
      where: { id: recent.mailAccountId, organizationId, status: "connected" },
    });
    if (account && isSteerableMailAddress(account.emailAddress)) return account;
  }
  return prisma.mailAccount.findFirst({
    where: {
      organizationId,
      status: "connected",
      emailAddress: { in: (await import("@/lib/mail/steerable")).steerableMailAddresses() },
    },
    orderBy: { updatedAt: "desc" },
  });
}
