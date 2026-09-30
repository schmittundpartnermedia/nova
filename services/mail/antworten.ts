import type { Communication } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Hat der Empfänger (oder jemand aus seiner Firma im selben Verlauf) auf diese Kampagne geantwortet? */
export async function hatGeantwortet(mail: Pick<Communication, "organizationId" | "campaignId" | "toAddress" | "recipientName">): Promise<boolean> {
  if (!mail.campaignId) return false;
  const oder: Array<Record<string, unknown>> = [];
  if (mail.toAddress) oder.push({ fromAddress: mail.toAddress.toLowerCase() });
  if (mail.recipientName) oder.push({ recipientName: mail.recipientName });
  if (!oder.length) return false;
  const antwort = await prisma.communication.count({
    where: { organizationId: mail.organizationId, campaignId: mail.campaignId, direction: "inbound", status: "received", OR: oder },
  });
  return antwort > 0;
}
