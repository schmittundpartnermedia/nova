import fs from "node:fs";
import path from "node:path";
import type { Communication } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istRuecklaeufer, normalisiereMessageId, parseMailAddress } from "@/lib/mail/apple";
import { sperre } from "@/lib/mail/sperrliste";
import { steerableMailAddresses } from "@/lib/mail/steerable";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { runHeadLoop } from "@/agents/master/head";
import { decodeMailRef, type EingangsMail, type Postfach } from "@/services/mail/postfach";
import { meldeNutzer } from "@/services/meldungen";
import { planePostfachWache, WACHE_INTERVALL_MS } from "@/services/kampagnen";
import type { HeadProvider } from "@/types/ai";

/**
 * Postfach-Wache (Worker-Job „postfach.wache“, alle 5 Minuten, solange es Kampagnen-Mails der letzten 14 Tage gibt):
 * Sie sieht jede Mail durch, die seit ihrem letzten Lauf in Posteingang oder Werbung/Junk eingegangen ist.
 * Eine Mail gilt als Antwort, wenn sie im Verlauf auf eine unserer Kampagnen-Mails verweist (In-Reply-To/References,
 * auch wenn ein Kollege von einer anderen Adresse antwortet) oder vom angeschriebenen Empfänger kommt.
 * Der Kopf liest sie: Absage oder „keine Mails mehr“ → Sperrliste, kein Entwurf; sonst Antwortentwurf (ohne zu senden)
 * und Meldung. Abwesenheitsnotizen werden nur festgehalten. Rückläufer (Unzustellbar-Meldungen) sperren die Adresse.
 */

const BEOBACHTUNG_TAGE = 14;
/** Überlappung zum letzten Lauf, damit nichts zwischen zwei Läufen verloren geht (Doppelte fängt externalReference ab). */
const UEBERLAPPUNG_MS = 10 * 60_000;
const MAX_MAILS_PRO_LAUF = 300;

function standDatei(): string {
  return path.join(novaHomeDir(), "zustand", "postfach-wache.json");
}

function letzterLauf(organizationId: string): Date | null {
  try {
    const stand = JSON.parse(fs.readFileSync(standDatei(), "utf8")) as Record<string, string>;
    const datum = stand[organizationId] ? new Date(stand[organizationId]!) : null;
    return datum && !Number.isNaN(datum.getTime()) ? datum : null;
  } catch {
    return null;
  }
}

function merkeLauf(organizationId: string, zeit: Date): void {
  let stand: Record<string, string> = {};
  try {
    stand = JSON.parse(fs.readFileSync(standDatei(), "utf8")) as Record<string, string>;
  } catch {
    stand = {};
  }
  stand[organizationId] = zeit.toISOString();
  fs.mkdirSync(path.dirname(standDatei()), { recursive: true });
  fs.writeFileSync(standDatei(), `${JSON.stringify(stand, null, 2)}\n`, "utf8");
}

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

  try {
    const neueAntworten = await pruefeEingang(input, gesendet, jetzt);
    return { neueAntworten, weiter: true };
  } finally {
    // Auch wenn Apple Mail gerade nicht antwortet: Die Wache bleibt geplant.
    await planePostfachWache(input.organizationId, new Date(jetzt.getTime() + WACHE_INTERVALL_MS));
  }
}

async function pruefeEingang(
  input: { organizationId: string; postfach: Postfach; kopf: { provider: HeadProvider; model: string } },
  gesendet: Communication[],
  jetzt: Date,
): Promise<number> {
  const nachMessageId = new Map(
    gesendet
      .filter((row) => row.externalReference && row.externalReference !== "sent-confirmed")
      .map((row) => [normalisiereMessageId(String(row.externalReference)), row]),
  );
  const nachEmpfaenger = new Map(gesendet.map((row) => [String(row.toAddress).toLowerCase(), row]));
  const eigene = new Set(steerableMailAddresses().map((adresse) => adresse.toLowerCase()));
  const fruehester = new Date(Math.min(...gesendet.map((row) => (row.sentAt ?? jetzt).getTime())));
  const zuletzt = letzterLauf(input.organizationId);
  const seit = new Date(Math.max(fruehester.getTime(), (zuletzt?.getTime() ?? 0) - UEBERLAPPUNG_MS));

  const mails = await input.postfach.eingang({ seit, max: MAX_MAILS_PRO_LAUF });
  let neueAntworten = 0;

  const ruecklaeufer: Array<{ firma: string; email: string }> = [];

  for (const mail of mails) {
    const von = parseMailAddress(mail.von).email.toLowerCase();
    if (eigene.has(von)) continue;
    const kennung = mail.messageId || decodeMailRef(mail.ref)?.messageId || mail.ref;
    const bekannt = await prisma.communication.findFirst({
      where: { organizationId: input.organizationId, direction: "inbound", externalReference: kennung },
    });
    if (bekannt) continue;

    if (istRuecklaeufer(mail.von)) {
      ruecklaeufer.push(...(await verarbeiteRuecklaeufer(input, mail, kennung, gesendet)));
      continue;
    }

    const original = mail.bezuege.map((id) => nachMessageId.get(id)).find(Boolean) ?? nachEmpfaenger.get(von);
    if (!original?.sentAt) continue;
    const eingang = new Date(mail.eingang);
    if (Number.isNaN(eingang.getTime()) || eingang <= original.sentAt) continue;

    await prisma.communication.create({
      data: {
        organizationId: input.organizationId,
        channel: "email",
        direction: "inbound",
        subject: mail.betreff,
        body: mail.textanfang,
        // Abwesenheitsnotizen werden festgehalten, aber niemandem vorgelegt.
        status: mail.automatisch ? "autoreply" : "received",
        deliveryStatus: "VERIFIED",
        fromAddress: von,
        toAddress: mail.konto,
        replyRef: mail.ref,
        externalReference: kennung,
        campaignId: original.campaignId,
        recipientName: original.recipientName,
      },
    });
    if (mail.automatisch) continue;
    neueAntworten += 1;

    const firma = original.recipientName || von;
    const kopf = await runHeadLoop({
      provider: input.kopf.provider,
      model: input.kopf.model,
      history: [],
      userRequest: [
        `[Postfach-Wache] ${firma} hat auf unsere Kampagnen-Mail „${original.subject}“ (an ${original.toAddress}) geantwortet, Absender der Antwort: ${von}.`,
        `ref der Antwort: ${mail.ref}`,
        "Lies die Antwort mit mail_lesen (modus nachricht).",
        `Ist sie eine Absage (kein Interesse) oder die Bitte, keine Mails mehr zu schicken: setze ${original.toAddress}` +
          (von !== String(original.toAddress).toLowerCase() ? ` und ${von}` : "") +
          " mit sperrliste_hinzufuegen auf die Sperrliste (Grund: Absage bzw. keine Mails erwünscht), lege keinen Entwurf an " +
          `und sag Joachim in einem gesprochenen Satz, dass ${firma} abgesagt hat und nicht mehr angeschrieben wird.`,
        `Sonst: lege mit mail_antworten einen passenden Antwortentwurf von ${original.fromAddress} an, nicht senden. ` +
          `Sag Joachim dann in zwei, drei gesprochenen Sätzen, dass ${firma} geantwortet hat, worum es geht und was du kurz vorschlägst, und frag, ob du so senden oder etwas ergänzen sollst. Den Entwurf nicht wörtlich wiedergeben; er erscheint als Karte im Chat.`,
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

  if (ruecklaeufer.length) {
    const namen = ruecklaeufer.map((item) => (item.firma ? `${item.firma} (${item.email})` : item.email)).join(", ");
    await meldeNutzer({
      organizationId: input.organizationId,
      anlass: `ruecklaeufer:${jetzt.toISOString()}`,
      text:
        ruecklaeufer.length === 1
          ? `Eine Mail kam als unzustellbar zurück: ${namen}. Die Adresse habe ich gesperrt.`
          : `${ruecklaeufer.length} Mails kamen als unzustellbar zurück: ${namen}. Die Adressen habe ich gesperrt.`,
    });
  }

  merkeLauf(input.organizationId, jetzt);
  return neueAntworten;
}

/**
 * Rückläufer: Die Unzustellbar-Meldung nennt die Empfängeradresse im Text. Jede unserer Kampagnen-Mails,
 * deren Adresse darin vorkommt, gilt als unzustellbar; die Adresse kommt auf die Sperrliste.
 */
async function verarbeiteRuecklaeufer(
  input: { organizationId: string; postfach: Postfach },
  mail: EingangsMail,
  kennung: string,
  gesendet: Communication[],
): Promise<Array<{ firma: string; email: string }>> {
  const voll = await input.postfach.lesen(mail.ref);
  const text = `${mail.betreff}\n${voll?.text ?? mail.textanfang}`.toLowerCase();
  const betroffen = gesendet.filter((row) => row.toAddress && row.deliveryStatus !== "BOUNCED" && text.includes(row.toAddress.toLowerCase()));
  await prisma.communication.create({
    data: {
      organizationId: input.organizationId,
      channel: "email",
      direction: "inbound",
      subject: mail.betreff,
      body: mail.textanfang,
      status: "bounce",
      deliveryStatus: "VERIFIED",
      fromAddress: parseMailAddress(mail.von).email.toLowerCase(),
      toAddress: mail.konto,
      replyRef: mail.ref,
      externalReference: kennung,
      campaignId: betroffen[0]?.campaignId ?? null,
      recipientName: betroffen[0]?.recipientName ?? null,
    },
  });
  const ergebnis: Array<{ firma: string; email: string }> = [];
  for (const row of betroffen) {
    await prisma.communication.update({ where: { id: row.id }, data: { deliveryStatus: "BOUNCED" } });
    sperre(String(row.toAddress), `unzustellbar (Rückläufer ${new Date(mail.eingang).toLocaleDateString("de-DE")})`);
    ergebnis.push({ firma: row.recipientName ?? "", email: String(row.toAddress) });
  }
  return ergebnis;
}
