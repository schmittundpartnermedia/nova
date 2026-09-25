import { getMailProvider } from "@/connectors/registry";
import { mailMutationPolicy } from "@/lib/mail/apple";
import { assertOrganizationId } from "@/services/tenant";

export async function markMailRead(input: { organizationId: string; accountId: string; providerMessageId: string; approved?: boolean }) {
  assertOrganizationId(input.organizationId);
  const policy = mailMutationPolicy("mark-read");
  if (policy.approvalRequired && !input.approved) {
    return { ok: false, executed: false, reason: "WAITING_FOR_APPROVAL" };
  }
  const provider = await getMailProvider(input.organizationId);
  return provider.markRead(input.organizationId, input.accountId, input.providerMessageId);
}

export async function archiveMailMessage(input: {
  organizationId: string;
  accountId: string;
  providerMessageId: string;
  approved?: boolean;
}) {
  assertOrganizationId(input.organizationId);
  const policy = mailMutationPolicy("archive");
  if (policy.approvalRequired && !input.approved) {
    return { ok: false, executed: false, reason: "WAITING_FOR_APPROVAL" };
  }
  const provider = await getMailProvider(input.organizationId);
  return provider.archive(input.organizationId, input.accountId, input.providerMessageId);
}
