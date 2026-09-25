import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { auditMail } from "@/services/mail/audit";
import { getMailProvider } from "@/connectors/registry";
import { importMailMessages } from "@/services/mail/sync";

function sinceFromQuery(query: string): Date | null {
  const now = Date.now();
  if (/gestern/i.test(query)) return new Date(now - 24 * 60 * 60 * 1000);
  if (/letzte woche|letzten 7 tage/i.test(query)) return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (/letzten monat|letzter monat/i.test(query)) return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

export async function searchMail(input: { organizationId: string; query: string; limit?: number }) {
  assertOrganizationId(input.organizationId);
  const q = input.query.trim();
  const since = sinceFromQuery(q);
  const tokens = q
    .replace(/\b(mails?|von|über|ueber|letzte[nrs]? woche|gestern|such\w*|zeig\w*|mir|die|hat|geschrieben)\b/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 6);
  const rows = await prisma.mailMessage.findMany({
    where: {
      organizationId: input.organizationId,
      ...(since ? { receivedAt: { gte: since } } : {}),
      ...(tokens.length
        ? {
            OR: tokens.flatMap((token) => [
              { fromAddress: { contains: token.toLowerCase() } },
              { fromName: { contains: token } },
              { subject: { contains: token } },
              { normalizedText: { contains: token } },
            ]),
          }
        : {}),
    },
    include: { thread: true, attachments: true },
    orderBy: { receivedAt: "desc" },
    take: input.limit ?? 12,
  });
  let isolated = rows.filter((row) => row.organizationId === input.organizationId);
  if (!isolated.length && tokens.length) {
    const provider = await getMailProvider(input.organizationId);
    if (provider.id === "apple-mail") {
      const remote = await provider.search(input.organizationId, tokens[0] ?? q).catch(() => []);
      const accounts = await prisma.mailAccount.findMany({
        where: { organizationId: input.organizationId, provider: "apple-mail", status: "connected" },
      });
      const grouped = new Map<string, typeof remote>();
      for (const message of remote) {
        const owner = message.headers["x-nova-account"];
        const account = accounts.find((item) => item.emailAddress === owner);
        if (!account) continue;
        grouped.set(account.id, [...(grouped.get(account.id) ?? []), message]);
      }
      for (const [accountId, messages] of grouped) {
        await importMailMessages({ organizationId: input.organizationId, accountId, provider, messages }).catch(() => 0);
      }
      if (remote.length) {
        const again = await prisma.mailMessage.findMany({
          where: {
            organizationId: input.organizationId,
            OR: tokens.flatMap((token) => [
              { fromAddress: { contains: token.toLowerCase() } },
              { fromName: { contains: token } },
              { subject: { contains: token } },
              { normalizedText: { contains: token } },
            ]),
          },
          include: { thread: true, attachments: true },
          orderBy: { receivedAt: "desc" },
          take: input.limit ?? 12,
        });
        isolated = again.filter((row) => row.organizationId === input.organizationId);
      }
    }
  }
  if (isolated[0]) {
    await auditMail({
      organizationId: input.organizationId,
      action: "READ",
      messageId: isolated[0].id,
      threadId: isolated[0].threadId,
      status: "prepared",
      detail: `Suche: ${q.slice(0, 120)}`,
    });
  }
  return isolated;
}

export async function getMailThread(organizationId: string, threadId: string) {
  assertOrganizationId(organizationId);
  const thread = await prisma.mailThread.findFirst({
    where: { id: threadId, organizationId },
    include: { messages: { orderBy: { receivedAt: "asc" }, include: { attachments: true } }, followUps: true },
  });
  if (!thread) return null;
  await auditMail({
    organizationId,
    action: "READ",
    threadId: thread.id,
    status: "prepared",
    detail: thread.subject,
  });
  return thread;
}
