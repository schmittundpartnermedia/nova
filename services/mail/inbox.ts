import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

const ATTENTION = new Set(["IMPORTANT", "ACTION_REQUIRED", "REPLY_REQUIRED"]);

function mailLine(item: { fromName: string | null; fromAddress: string; subject: string; receivedAt: Date | null }) {
  const who = item.fromName || item.fromAddress;
  const when = item.receivedAt ? item.receivedAt.toISOString().slice(0, 16).replace("T", " ") : "ohne Zeit";
  return `• ${when} ${who} – ${item.subject}`;
}

export async function summarizeInbox(organizationId: string, since = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  assertOrganizationId(organizationId);
  const newest = await prisma.mailMessage.findMany({
    where: { organizationId, direction: "inbound" },
    orderBy: { receivedAt: "desc" },
    take: 5,
  });
  if (!newest.length) return "Im lokalen Postfach liegen keine eingegangenen Mails.";
  const fresh = newest.filter((item) => item.receivedAt && item.receivedAt >= since);
  const attention = fresh.filter((item) => ATTENTION.has(item.classification) && item.priority !== "low");
  const lines = (fresh.length ? fresh : newest).slice(0, 5).map(mailLine);
  if (!fresh.length) {
    return `Seit gestern ist nichts Neues eingegangen. Die neuesten Mails sind:\n\n${lines.join("\n")}`;
  }
  const head = `Die neuesten Mails, ${fresh.length} seit gestern:`;
  const note = attention.length
    ? `\n\n${attention.length === 1 ? "Eine braucht" : `${attention.length} brauchen`} Aufmerksamkeit.`
    : "";
  return `${head}\n\n${lines.join("\n")}${note}`;
}
