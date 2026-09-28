import { deliverApprovedDraft } from "@/services/mail/send";
import { authorizeExternalAction } from "@/services/approvals";
import { prisma } from "@/lib/prisma";

export async function mailSendWorkHandler(item: {
  id: string;
  organizationId: string;
  jobId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const communicationId = String(item.payload.communicationId ?? "");
  if (!communicationId) {
    return { ok: false, retry: false, note: "mail.send ohne communicationId." };
  }

  const draft = await prisma.communication.findFirst({
    where: { id: communicationId, organizationId: item.organizationId },
    include: { contact: true },
  });
  if (!draft) {
    return { ok: false, retry: false, note: "Entwurf nicht gefunden." };
  }

  const recipient = draft.contact?.email ?? undefined;
  const auth = await authorizeExternalAction({
    organizationId: item.organizationId,
    actionType: "mail.send",
    description: `Versand: ${draft.subject}`,
    jobId: item.jobId ?? undefined,
    payload: { communicationId },
    riskLevel: "external",
    requiresApproval: true,
    conditions: recipient?.includes("@") ? { recipientDomain: recipient.split("@").pop() } : undefined,
  });

  if (auth.decision === "need_approval") {
    return { ok: false, retry: false, note: `Freigabe nötig (${auth.approvalId}).` };
  }
  if (auth.decision === "deny_hard") {
    return { ok: false, retry: false, note: auth.reason };
  }

  const sent = await deliverApprovedDraft({
    organizationId: item.organizationId,
    communicationId,
    approved: true,
  });

  if (sent.status === "VERIFIED" && sent.executed) {
    return { ok: true, note: "Mail versendet und in Gesendet geprüft." };
  }
  if (sent.status === "WAITING_FOR_APPROVAL") {
    return { ok: false, retry: false, note: sent.reason ?? "Wartet auf Freigabe." };
  }
  return {
    ok: false,
    retry: sent.status === "FAILED" ? false : true,
    note: sent.reason ?? `Versandstatus ${sent.status}`,
  };
};
