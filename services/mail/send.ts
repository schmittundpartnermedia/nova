import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { getMailProvider } from "@/connectors/registry";
import { auditMail } from "@/services/mail/audit";
import { createMailFollowUp } from "@/services/mail/followup";
import type { MailProvider, MailSendResult } from "@/types/connectors";

export async function deliverApprovedDraft(input: {
  organizationId: string;
  communicationId: string;
  approved: boolean;
  provider?: MailProvider;
}): Promise<MailSendResult> {
  assertOrganizationId(input.organizationId);
  const draft = await prisma.communication.findFirst({
    where: { id: input.communicationId, organizationId: input.organizationId },
    include: { contact: true },
  });
  if (!draft) {
    return { ok: false, executed: false, mock: false, status: "FAILED", reason: "Entwurf nicht gefunden." };
  }
  if (!input.approved) {
    return { ok: false, executed: false, mock: false, status: "WAITING_FOR_APPROVAL", reason: "Versand wartet auf Freigabe." };
  }
  const to = draft.contact?.email?.trim();
  const headerTo = to || recipientFromBody(draft);
  if (!headerTo) {
    await prisma.communication.update({ where: { id: draft.id }, data: { deliveryStatus: "FAILED", status: "failed" } });
    await auditMail({
      organizationId: input.organizationId,
      action: "SEND_FAILED",
      status: "FAILED",
      detail: "Kein Empfänger",
    });
    return { ok: false, executed: false, mock: false, status: "FAILED", reason: "Kein Empfänger." };
  }

  await prisma.communication.update({ where: { id: draft.id }, data: { deliveryStatus: "SENDING", status: "sending" } });
  await auditMail({
    organizationId: input.organizationId,
    action: "SEND_ATTEMPTED",
    threadId: draft.mailThreadId ?? undefined,
    status: "SENDING",
    detail: draft.subject,
  });

  const provider = input.provider ?? (await getMailProvider(input.organizationId));
  const original = draft.inReplyTo
    ? await prisma.mailMessage.findFirst({
        where: { organizationId: input.organizationId, internetMessageId: draft.inReplyTo },
      })
    : draft.mailThreadId
      ? await prisma.mailMessage.findFirst({
          where: { organizationId: input.organizationId, threadId: draft.mailThreadId },
          orderBy: { receivedAt: "desc" },
        })
      : null;

  const payload = {
    organizationId: input.organizationId,
    accountId: draft.mailAccountId ?? undefined,
    to: headerTo,
    subject: draft.subject,
    body: stripDraftFooter(draft.body),
    threadId: original?.providerThreadId ?? draft.mailThreadId ?? undefined,
    inReplyTo: draft.inReplyTo ?? original?.internetMessageId ?? undefined,
    references: draft.referencesHeader ? draft.referencesHeader.split(/\s+/) : undefined,
  };
  const result = original
    ? await provider.reply({ ...payload, providerMessageId: original.providerMessageId })
    : await provider.send(payload);

  if (result.status !== "VERIFIED") {
    await prisma.communication.update({ where: { id: draft.id }, data: { deliveryStatus: "FAILED", status: "failed" } });
    await auditMail({
      organizationId: input.organizationId,
      action: "SEND_FAILED",
      status: "FAILED",
      detail: result.reason,
    });
    return { ...result, status: "FAILED", ok: false };
  }

  await prisma.communication.update({
    where: { id: draft.id },
    data: {
      deliveryStatus: "VERIFIED",
      status: "sent",
      sentAt: new Date(),
      isMock: false,
      externalReference: result.messageId,
    },
  });
  await auditMail({
    organizationId: input.organizationId,
    action: "SEND_VERIFIED",
    threadId: draft.mailThreadId ?? undefined,
    status: "VERIFIED",
    detail: result.reason,
  });
  if (draft.mailThreadId && /\?/.test(payload.body)) {
    await createMailFollowUp({
      organizationId: input.organizationId,
      threadId: draft.mailThreadId,
      expectedFrom: headerTo,
      dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      reason: "Antwort erwartet",
    }).catch(() => undefined);
  }
  return result;
}

function stripDraftFooter(body: string): string {
  return body.replace(/\n---\n[\s\S]*$/m, "").trim();
}

function recipientFromBody(draft: { body: string }): string | null {
  const match = draft.body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] ?? null;
}
