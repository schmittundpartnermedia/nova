import { prisma } from "@/lib/prisma";
import { parseMailAddress } from "@/lib/mail/apple";
import { runHeadLoop } from "@/agents/master/head";
import { decodeMailRef, type Postfach } from "@/services/mail/postfach";
import { meldeNutzer } from "@/services/meldungen";
import { planePostfachWache, WACHE_INTERVALL_MS } from "@/services/kampagnen";
import type { HeadProvider } from "@/types/ai";

/**
 * Postfach-Wache (Worker-Job „postfach.wache“, alle 5 Minuten, solange es Kampagnen-Mails der letzten 14 Tage gibt):
 * Eine neue Mail von einem Kampagnen-Empfänger gilt als Antwort. Der Kopf liest sie, legt einen Antwortentwurf an
 * (ohne zu senden) und spricht den Nutzer an. Gesendet wird erst auf sein „senden“.
 */

const BEOBACHTUNG_TAGE = 14;

export async function postfachWache(input: {
  organizationId: string;
  postfach: Postfach;
  kopf: { provider: HeadProvider; model: string };
  jetzt?: Date;
}): Promise<{ neueAntworten: number; weiter: boolean }> {
  const jetzt = input.jetzt ?? new Date();
  const gesendet = await prisma.communication.findMany({
    where: {
      organizationId: input.organizationId,
      campaignId: { not: null },
      direction: "outbound",
      status: "sent",
      sentAt: { gte: new Date(jetzt.getTime() - BEOBACHTUNG_TAGE * 86_400_000) },
    },
  });
  if (!gesendet.length) return { neueAntworten: 0, weiter: false };

  const nachEmpfaenger = new Map(gesendet.map((row) => [String(row.toAddress).toLowerCase(), row]));
  const mails = await input.postfach.neueste({ anzahl: 15, nurUngelesen: false });
  let neueAntworten = 0;

  for (const mail of mails) {
    const von = parseMailAddress(mail.von).email.toLowerCase();
    const original = nachEmpfaenger.get(von);
    if (!original?.sentAt) continue;
    const eingang = new Date(mail.eingang);
    if (Number.isNaN(eingang.getTime()) || eingang <= original.sentAt) continue;
    const kennung = decodeMailRef(mail.ref)?.messageId || mail.ref;
    const bekannt = await prisma.communication.findFirst({
      where: { organizationId: input.organizationId, direction: "inbound", externalReference: kennung },
    });
    if (bekannt) continue;

    await prisma.communication.create({
      data: {
        organizationId: input.organizationId,
        channel: "email",
        direction: "inbound",
        subject: mail.betreff,
        body: mail.textanfang,
        status: "received",
        deliveryStatus: "VERIFIED",
        fromAddress: von,
        toAddress: mail.konto,
        replyRef: mail.ref,
        externalReference: kennung,
        campaignId: original.campaignId,
        recipientName: original.recipientName,
      },
    });
    neueAntworten += 1;

    const firma = original.recipientName || von;
    const kopf = await runHeadLoop({
      provider: input.kopf.provider,
      model: input.kopf.model,
      history: [],
      userRequest: [
        `[Postfach-Wache] ${firma} (${von}) hat auf unsere Kampagnen-Mail „${original.subject}“ geantwortet.`,
        `ref der Antwort: ${mail.ref}`,
        "Lies die Antwort mit mail_lesen (modus nachricht) und lege mit mail_antworten einen passenden Antwortentwurf von " +
          `${original.fromAddress} an. Nicht senden.`,
        `Sag Joachim dann in zwei, drei gesprochenen Sätzen: dass ${firma} geantwortet hat, worum es geht, was du kurz vorschlägst – und frag, ob du so senden oder etwas ergänzen sollst. Den Entwurf nicht wörtlich wiedergeben; er erscheint als Karte im Chat.`,
      ].join("\n"),
      context: { organizationId: input.organizationId, postfach: input.postfach },
    });
    await meldeNutzer({
      organizationId: input.organizationId,
      anlass: `kampagne-antwort:${kennung}`,
      text: kopf.reply,
      werkzeugNotiz: kopf.werkzeugNotiz,
    });
  }

  await planePostfachWache(input.organizationId, new Date(jetzt.getTime() + WACHE_INTERVALL_MS));
  return { neueAntworten, weiter: true };
}
