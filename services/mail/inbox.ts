import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

const ATTENTION = new Set(["IMPORTANT", "ACTION_REQUIRED", "REPLY_REQUIRED"]);

export async function summarizeInbox(organizationId: string, since = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  assertOrganizationId(organizationId);
  const messages = await prisma.mailMessage.findMany({
    where: { organizationId, direction: "inbound", receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    take: 40,
  });
  const attention = messages.filter((item) => ATTENTION.has(item.classification) && item.priority !== "low");
  const lines = attention.slice(0, 2).map((item) => {
    const who = item.fromName || item.fromAddress;
    return `• ${who} – ${item.subject}`;
  });
  if (!messages.length) {
    return "Seit gestern sind keine neuen Mails im lokalen Postfach.";
  }
  const head = `Seit gestern sind ${messages.length} neue Mails eingegangen.`;
  if (!lines.length) return `${head} Keine davon braucht gerade deine Aufmerksamkeit.`;
  return `${head} ${attention.length === 1 ? "Eine braucht" : `${Math.min(attention.length, 2)} brauchen`} deine Aufmerksamkeit:\n\n${lines.join("\n")}`;
}
