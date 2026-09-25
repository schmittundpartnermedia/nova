import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export type MailCapabilityName = "MAIL_READ" | "MAIL_SEARCH" | "MAIL_DRAFT" | "MAIL_SEND";
export type MailCapabilityState = "AVAILABLE" | "BLOCKED" | "OFFLINE";

export async function getMailCapabilityMap(organizationId: string): Promise<Record<MailCapabilityName, { state: MailCapabilityState; reason?: string }>> {
  assertOrganizationId(organizationId);
  const account = await prisma.mailAccount.findFirst({
    where: { organizationId, status: "connected" },
    orderBy: { updatedAt: "desc" },
  });
  if (!account) {
    const blocked = { state: "BLOCKED" as const, reason: "ACCOUNT_NOT_CONNECTED" };
    return { MAIL_READ: blocked, MAIL_SEARCH: blocked, MAIL_DRAFT: blocked, MAIL_SEND: blocked };
  }
  const offline = account.lastError?.includes("PROVIDER_UNAVAILABLE");
  return {
    MAIL_READ: { state: "AVAILABLE" },
    MAIL_SEARCH: { state: "AVAILABLE" },
    MAIL_DRAFT: { state: "AVAILABLE" },
    MAIL_SEND: offline ? { state: "OFFLINE", reason: "PROVIDER_UNAVAILABLE" } : { state: "AVAILABLE" },
  };
}
