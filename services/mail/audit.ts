import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { redactSecrets } from "@/lib/mail/redaction";
import { recordActivity } from "@/services/archive";

export const MAIL_AUDIT_ACTIONS = [
  "SYNC",
  "READ",
  "DRAFT_CREATED",
  "DRAFT_UPDATED",
  "APPROVAL_REQUESTED",
  "SEND_ATTEMPTED",
  "SEND_VERIFIED",
  "SEND_FAILED",
  "FOLLOWUP_CREATED",
  "FOLLOWUP_COMPLETED",
] as const;

export type MailAuditAction = (typeof MAIL_AUDIT_ACTIONS)[number];

export async function auditMail(input: {
  organizationId: string;
  action: MailAuditAction;
  accountId?: string;
  messageId?: string;
  threadId?: string;
  status: string;
  detail?: string;
  jobId?: string;
}) {
  assertOrganizationId(input.organizationId);
  const detail = input.detail ? redactSecrets(input.detail).slice(0, 500) : undefined;
  if (detail && /password|smtp_pass|credential/i.test(detail)) {
    throw new Error("Mail-Audit darf keine Zugangsdaten enthalten.");
  }
  await prisma.mailAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      action: input.action,
      accountId: input.accountId,
      messageId: input.messageId,
      threadId: input.threadId,
      status: input.status,
      detail,
    },
  });
  await recordActivity({
    organizationId: input.organizationId,
    type: "mail",
    title: input.action,
    description: detail,
    status: input.status === "FAILED" ? "failed" : input.action === "SEND_VERIFIED" ? "executed" : "prepared",
    actuallyExecutedExternally: input.action === "SEND_VERIFIED",
    jobId: input.jobId,
    metadata: { action: input.action, accountId: input.accountId, messageId: input.messageId, threadId: input.threadId },
  });
}
