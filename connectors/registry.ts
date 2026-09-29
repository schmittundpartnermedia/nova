import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { AppleMailProvider } from "@/connectors/mail/apple";
import { BlockedMailProvider } from "@/connectors/mail/blocked";
import { ImapSmtpMailProvider } from "@/connectors/mail/imap";
import { passwordSmtpEnabled } from "@/connectors/mail/smtp";
import { readMailAutomationState } from "@/services/mail/apple-events";
import type { MailProvider } from "@/types/connectors";

const mailBlocked = new BlockedMailProvider();
const mailImap = new ImapSmtpMailProvider();
const mailApple = new AppleMailProvider();

export async function getMailProvider(organizationId: string): Promise<MailProvider> {
  assertOrganizationId(organizationId);
  const apple = await prisma.mailAccount.findFirst({
    where: { organizationId, status: "connected", provider: "apple-mail" },
  });
  if (apple) {
    const automation = await readMailAutomationState();
    if (automation === "granted") return mailApple;
    return mailBlocked;
  }
  const account = await prisma.mailAccount.findFirst({
    where: {
      organizationId,
      status: "connected",
      provider: { in: ["google", "microsoft"] },
      NOT: { credentialRef: null },
    },
  });
  if (account && !passwordSmtpEnabled()) return mailImap;
  return mailBlocked;
}
