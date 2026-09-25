import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { deleteMailSecret, readMailSecret, storeMailSecret, type MailSecret } from "@/services/mail/credentials";
import { isConsumerDomain } from "@/lib/mail/classify";

export function inferMailbox(email: string, host?: string): Pick<MailSecret, "imapHost" | "imapPort" | "imapSecure" | "smtpHost" | "smtpPort" | "smtpSecure"> | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const explicit = host?.trim();
  if (explicit) {
    return { imapHost: explicit, imapPort: 993, imapSecure: true, smtpHost: explicit.replace(/^imap\./, "smtp."), smtpPort: 465, smtpSecure: true };
  }
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true };
  }
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com" || domain.endsWith(".onmicrosoft.com")) {
    return { imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false };
  }
  if (!domain || isConsumerDomain(domain)) return null;
  return null;
}

export async function connectMailAccount(input: {
  organizationId: string;
  emailAddress: string;
  displayName?: string;
  password: string;
  host?: string;
  probe: (secret: MailSecret) => Promise<{ ok: boolean; reason: string }>;
}) {
  assertOrganizationId(input.organizationId);
  const mailbox = inferMailbox(input.emailAddress, input.host);
  if (!mailbox) {
    return { ok: false as const, reason: "Für diese Adresse brauche ich den Mailserver. Host einmal angeben." };
  }
  const secret: MailSecret = {
    username: input.emailAddress.trim(),
    password: input.password,
    ...mailbox,
  };
  const probed = await input.probe(secret);
  if (!probed.ok) return { ok: false as const, reason: probed.reason };
  const credentialRef = await storeMailSecret(input.organizationId, secret);
  const account = await prisma.mailAccount.upsert({
    where: { organizationId_emailAddress: { organizationId: input.organizationId, emailAddress: input.emailAddress.trim().toLowerCase() } },
    create: {
      organizationId: input.organizationId,
      provider: "imap",
      emailAddress: input.emailAddress.trim().toLowerCase(),
      displayName: input.displayName,
      status: "connected",
      capabilities: JSON.stringify(["MAIL_READ", "MAIL_SEARCH", "MAIL_DRAFT", "MAIL_SEND"]),
      credentialRef,
    },
    update: {
      status: "connected",
      displayName: input.displayName,
      credentialRef,
      lastError: null,
      capabilities: JSON.stringify(["MAIL_READ", "MAIL_SEARCH", "MAIL_DRAFT", "MAIL_SEND"]),
    },
  });
  return { ok: true as const, account: publicAccount(account) };
}

export async function listMailAccounts(organizationId: string) {
  assertOrganizationId(organizationId);
  const rows = await prisma.mailAccount.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(publicAccount);
}

export function publicAccount(account: {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  status: string;
  lastSyncAt: Date | null;
  capabilities: string;
}) {
  return {
    id: account.id,
    provider: account.provider,
    emailAddress: account.emailAddress,
    displayName: account.displayName,
    status: account.status,
    lastSyncAt: account.lastSyncAt,
    capabilities: safeJson(account.capabilities),
  };
}

function safeJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function loadAccountSecret(organizationId: string, accountId: string) {
  assertOrganizationId(organizationId);
  const account = await prisma.mailAccount.findFirst({ where: { id: accountId, organizationId } });
  if (!account?.credentialRef) return null;
  const secret = await readMailSecret(organizationId, account.credentialRef);
  if (!secret) return null;
  return { account, secret };
}

export async function disconnectMailAccount(organizationId: string, accountId: string) {
  assertOrganizationId(organizationId);
  const account = await prisma.mailAccount.findFirst({ where: { id: accountId, organizationId } });
  if (!account) return;
  if (account.credentialRef) await deleteMailSecret(organizationId, account.credentialRef);
  await prisma.mailAccount.update({
    where: { id: account.id },
    data: { status: "disconnected", credentialRef: null },
  });
}
