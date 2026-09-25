import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { readMailAutomationState } from "@/services/mail/apple-events";

export type MailCapabilityName = "MAIL_CONNECTION" | "MAIL_READ" | "MAIL_SEARCH" | "MAIL_DRAFT" | "MAIL_SEND";
export type MailCapabilityState = "AVAILABLE" | "BLOCKED" | "OFFLINE";

const blocked = (reason: string) => ({
  MAIL_CONNECTION: { state: "BLOCKED" as const, reason },
  MAIL_READ: { state: "BLOCKED" as const, reason },
  MAIL_SEARCH: { state: "BLOCKED" as const, reason },
  MAIL_DRAFT: { state: "BLOCKED" as const, reason },
  MAIL_SEND: { state: "BLOCKED" as const, reason },
});

export async function getMailCapabilityMap(organizationId: string): Promise<Record<MailCapabilityName, { state: MailCapabilityState; reason?: string }>> {
  assertOrganizationId(organizationId);
  const [apple, oauth] = await Promise.all([
    prisma.mailAccount.findFirst({
      where: { organizationId, provider: "apple-mail", status: "connected" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.mailAccount.findFirst({
      where: { organizationId, status: "connected", provider: { in: ["google", "microsoft"] }, NOT: { credentialRef: null } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (apple) {
    const automation = await readMailAutomationState();
    if (automation !== "granted") {
      return blocked(automation === "unavailable" ? "PROVIDER_UNAVAILABLE" : "AUTOMATION_PERMISSION_REQUIRED");
    }
    const offline = apple.lastError?.includes("PROVIDER_UNAVAILABLE");
    return {
      MAIL_CONNECTION: { state: "AVAILABLE" },
      MAIL_READ: { state: "AVAILABLE" },
      MAIL_SEARCH: { state: "AVAILABLE" },
      MAIL_DRAFT: { state: "AVAILABLE" },
      MAIL_SEND: offline ? { state: "OFFLINE", reason: "PROVIDER_UNAVAILABLE" } : { state: "AVAILABLE" },
    };
  }
  if (!oauth) {
    const automation = await readMailAutomationState();
    if (automation === "denied" || automation === "required") return blocked("AUTOMATION_PERMISSION_REQUIRED");
    if (automation === "unavailable") return blocked("PROVIDER_UNAVAILABLE");
    return blocked("ACCOUNT_NOT_CONNECTED");
  }
  const offline = oauth.lastError?.includes("PROVIDER_UNAVAILABLE");
  return {
    MAIL_CONNECTION: { state: "AVAILABLE" },
    MAIL_READ: { state: "AVAILABLE" },
    MAIL_SEARCH: { state: "AVAILABLE" },
    MAIL_DRAFT: { state: "AVAILABLE" },
    MAIL_SEND: offline ? { state: "OFFLINE", reason: "PROVIDER_UNAVAILABLE" } : { state: "AVAILABLE" },
  };
}
