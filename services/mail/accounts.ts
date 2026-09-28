import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { visibleCapabilities } from "@/lib/mail/apple";
import { deleteMailSecret, readMailSecret, storeMailSecret, type MailSecret } from "@/services/mail/credentials";
import { refreshMailAccessToken } from "@/services/mail/oauth";

export async function listMailAccounts(organizationId: string) {
  assertOrganizationId(organizationId);
  const { filterSteerableMailAccounts } = await import("@/lib/mail/steerable");
  const rows = await prisma.mailAccount.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  // Steuern (Entwurf/Versand): nur erlaubte Konten. Sync anderer Apple-Konten bleibt separat.
  return filterSteerableMailAccounts(rows).map(publicAccount);
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
    capabilities: visibleCapabilities(account.capabilities),
  };
}

export async function loadAccountSecret(organizationId: string, accountId: string) {
  assertOrganizationId(organizationId);
  const account = await prisma.mailAccount.findFirst({ where: { id: accountId, organizationId } });
  if (!account?.credentialRef) return null;
  const secret = await readMailSecret(organizationId, account.credentialRef);
  if (!secret) return null;
  const fresh = await currentSecret(organizationId, account.credentialRef, secret);
  if (!fresh) return null;
  return { account, secret: fresh };
}

async function currentSecret(organizationId: string, credentialRef: string, secret: MailSecret): Promise<MailSecret | null> {
  if (new Date(secret.expiresAt).getTime() > Date.now() + 60_000) return secret;
  const refreshed = await refreshMailAccessToken(secret);
  if (!refreshed) return null;
  await deleteMailSecret(organizationId, credentialRef);
  const nextRef = await storeMailSecret(organizationId, refreshed);
  await prisma.mailAccount.updateMany({
    where: { organizationId, credentialRef },
    data: { credentialRef: nextRef },
  });
  return refreshed;
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
