import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { deleteMailSecret } from "@/services/mail/credentials";
import { clearMailAutomationCache, openMailIfClosed, readMailAutomationState, runMailAppleScript } from "@/services/mail/apple-events";
import { startMailSync } from "@/services/mail/sync";
import { getMailProvider } from "@/connectors/registry";
import { accountEmail, accountListScript, parseRecords } from "@/lib/mail/apple";
import { publicAccount } from "@/services/mail/accounts";
import { requestMailConsentFromNovaApp } from "@/services/mail/nova-consent";

const CAPABILITIES = ["MAIL_READ", "MAIL_SEARCH", "MAIL_DRAFT", "MAIL_SEND"];

export async function promptMailAutomationAccess() {
  clearMailAutomationCache();
  const before = await readMailAutomationState();
  if (before === "granted" || before === "denied") return before;
  const prompted = await requestMailConsentFromNovaApp();
  clearMailAutomationCache();
  if (prompted) return prompted;
  return readMailAutomationState();
}

export async function connectAppleMail(organizationId: string) {
  assertOrganizationId(organizationId);
  clearMailAutomationCache();
  let state = await readMailAutomationState();
  if (state === "required" || state === "unavailable") {
    state = await promptMailAutomationAccess();
    if (state === "required") {
      return { ok: false as const, permission: "required" as const, accounts: [], reason: "AUTOMATION_PERMISSION_REQUIRED" };
    }
    if (state !== "granted" && state !== "denied") {
      return {
        ok: false as const,
        permission: state,
        accounts: [],
        reason: state === "unavailable" ? "PROVIDER_UNAVAILABLE" : "AUTOMATION_PERMISSION_REQUIRED",
      };
    }
  }
  if (state === "denied") {
    return { ok: false as const, permission: state, accounts: [], reason: "AUTOMATION_DENIED" };
  }
  if (state !== "granted") {
    return { ok: false as const, permission: state, accounts: [], reason: "PROVIDER_UNAVAILABLE" };
  }

  const listed = await runMailAppleScript(accountListScript(), 20_000);
  if (!listed.ok) {
    return {
      ok: false as const,
      permission: listed.permission ? ("required" as const) : state,
      accounts: [],
      reason: listed.permission ? "AUTOMATION_PERMISSION_REQUIRED" : listed.error,
    };
  }

  const rows = parseRecords(listed.output);
  const accounts = [];
  for (const row of rows) {
    const appleId = (row[0] ?? "").trim();
    if (!appleId) continue;
    const emailAddress = accountEmail(row[2] ?? "", appleId);
    const displayName = (row[1] ?? "").trim() || emailAddress;
    const enabled = row[3] === "1";
    const capabilities = JSON.stringify([...CAPABILITIES, `apple-ref:${appleId}`]);
    const existing = await prisma.mailAccount.findUnique({
      where: { organizationId_emailAddress: { organizationId, emailAddress } },
    });
    if (existing?.credentialRef && existing.provider !== "apple-mail") {
      await deleteMailSecret(organizationId, existing.credentialRef);
    }
    const saved = existing
      ? await prisma.mailAccount.update({
          where: { id: existing.id },
          data: {
            provider: "apple-mail",
            displayName,
            status: enabled ? "connected" : "disconnected",
            capabilities,
            credentialRef: null,
            lastError: null,
          },
        })
      : await prisma.mailAccount.create({
          data: {
            organizationId,
            provider: "apple-mail",
            emailAddress,
            displayName,
            status: enabled ? "connected" : "disconnected",
            capabilities,
            credentialRef: null,
          },
        });
    accounts.push(saved);
  }

  const provider = await getMailProvider(organizationId);
  let imported = 0;
  if (provider.id === "apple-mail") {
    for (const account of accounts.filter((item) => item.status === "connected")) {
      try {
        const synced = await startMailSync({ organizationId, accountId: account.id, provider });
        imported += synced.imported;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "SYNC_FAILED";
        await prisma.mailAccount.update({
          where: { id: account.id },
          data: { lastError: reason.slice(0, 180) },
        });
      }
    }
  }

  const fresh = await prisma.mailAccount.findMany({
    where: { organizationId, provider: "apple-mail" },
    orderBy: { createdAt: "asc" },
  });
  return {
    ok: true as const,
    permission: "granted" as const,
    imported,
    accounts: fresh.map(publicAccount),
  };
}

export async function ensureAppleMailFresh(organizationId: string) {
  assertOrganizationId(organizationId);
  await openMailIfClosed();
  const state = await readMailAutomationState();
  if (state !== "granted") return { refreshed: false };
  const account = await prisma.mailAccount.findFirst({
    where: { organizationId, provider: "apple-mail", status: "connected" },
    orderBy: { lastSyncAt: "asc" },
  });
  if (!account) return { refreshed: false };
  if (account.lastSyncAt && Date.now() - account.lastSyncAt.getTime() < 3 * 60 * 1000) return { refreshed: false };
  const provider = await getMailProvider(organizationId);
  if (provider.id !== "apple-mail") return { refreshed: false };
  await startMailSync({ organizationId, accountId: account.id, provider });
  return { refreshed: true };
}
