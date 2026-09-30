import { prisma } from "@/lib/prisma";
import { fuelleVorlage } from "@/lib/mail/vorlagen";
import { aufSperrliste, leseSperrliste } from "@/lib/mail/sperrliste";
import { erstelleEntwurf } from "@/services/mail/entwuerfe";
import { hatGeantwortet } from "@/services/mail/antworten";
import { scheduleMailSend } from "@/services/mail/schedule";
import { enqueueWorkItem } from "@/services/worker/queue";
import { meldeNutzer } from "@/services/meldungen";
import { leseEinstellungen, lokalesDatum, zeitfenster } from "@/services/tagesbetrieb/einstellungen";

/**
 * Nachfass-Mail (Worker-Job „nachfass.tick“, alle 30 Minuten, solange es Kampagnen mit Nachfass gibt):
 * Wer auf eine Kampagnen-Mail nach N Tagen nicht geantwortet hat, bekommt genau eine kurze zweite Mail
 * aus der Vorlage „<vorlage>-nachfass“. Gesendet wird über den normalen Weg (mail.send → sendeEntwurf),
 * nur werktags im Zeitfenster des Tagesbetriebs, höchstens nachfassMaxProTag am Tag.
 * Nicht nachgefasst wird bei Antwort (auch von Kollegen), Rückläufer, Sperrliste oder abgebrochener Kampagne.
 * Die Freigabe der Kampagne deckt die Nachfass-Mail ab: Sie steht in ihrer Zusammenfassung.
 */

export const NACHFASS_INTERVALL_MS = 30 * 60_000;
/** Später als so viele Tage nach dem Fälligkeitstag wird nicht mehr nachgefasst (z. B. nach langer Pause). */
const SPAETESTENS_TAGE_NACH_FAELLIG = 5;
const MAX_JE_LAUF = 10;
const TAG_MS = 86_400_000;

export async function planeNachfass(organizationId: string, runAt: Date) {
  const slot = Math.floor(runAt.getTime() / NACHFASS_INTERVALL_MS);
  return enqueueWorkItem({
    organizationId,
    kind: "nachfass.tick",
    idempotencyKey: `nachfass.tick:${slot}`,
    payload: {},
    runAt,
    maxAttempts: 1,
  });
}

export async function nachfassTick(input: { organizationId: string; jetzt?: Date }): Promise<{ angelegt: number; weiter: boolean }> {
  const jetzt = input.jetzt ?? new Date();
  const kampagnen = await prisma.campaign.findMany({
    where: {
      organizationId: input.organizationId,
      nachfassTage: { not: null },
      nachfassVorlage: { not: null },
      approvalId: { not: null },
      status: { in: ["laeuft", "fertig"] },
    },
  });
  // Solange eine Kampagne noch Mails hat, die fällig werden können, bleibt der Takt geplant.
  const aktiv = kampagnen.filter((kampagne) => {
    const start = kampagne.startedAt ?? kampagne.createdAt;
    return jetzt.getTime() - start.getTime() < ((kampagne.nachfassTage ?? 0) + SPAETESTENS_TAGE_NACH_FAELLIG + 1) * TAG_MS;
  });
  if (!aktiv.length) return { angelegt: 0, weiter: false };

  try {
    const cfg = leseEinstellungen();
    if (!zeitfenster(cfg, jetzt).imFenster) return { angelegt: 0, weiter: true };

    const tagesbeginn = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    const heute = await prisma.communication.count({
      where: {
        organizationId: input.organizationId,
        nachfassZu: { not: null },
        OR: [{ sentAt: { gte: tagesbeginn } }, { status: "draft" }],
      },
    });
    const frei = Math.min(MAX_JE_LAUF, cfg.nachfassMaxProTag - heute);
    if (frei <= 0) return { angelegt: 0, weiter: true };

    const sperrliste = leseSperrliste();
    const angelegt: Array<{ firma: string; runAt: Date }> = [];
    for (const kampagne of aktiv) {
      if (angelegt.length >= frei) break;
      const tage = kampagne.nachfassTage!;
      const faellig = await prisma.communication.findMany({
        where: {
          campaignId: kampagne.id,
          direction: "outbound",
          status: "sent",
          nachfassZu: null,
          deliveryStatus: { not: "BOUNCED" },
          sentAt: {
            lte: new Date(jetzt.getTime() - tage * TAG_MS),
            gte: new Date(jetzt.getTime() - (tage + SPAETESTENS_TAGE_NACH_FAELLIG) * TAG_MS),
          },
        },
        orderBy: { sentAt: "asc" },
      });
      for (const erste of faellig) {
        if (angelegt.length >= frei) break;
        if (!erste.toAddress || !erste.vorlagenWerte) continue;
        if (aufSperrliste(erste.toAddress, sperrliste)) continue;
        if (await prisma.communication.count({ where: { nachfassZu: erste.id } })) continue;
        if (await hatGeantwortet(erste)) continue;

        const werte = JSON.parse(erste.vorlagenWerte) as Record<string, string>;
        const gefuellt = fuelleVorlage(kampagne.nachfassVorlage!, werte);
        if (gefuellt.fehlend.length) continue;
        const entwurf = await erstelleEntwurf({
          organizationId: input.organizationId,
          absender: erste.fromAddress ?? kampagne.absender,
          an: erste.toAddress,
          betreff: gefuellt.betreff,
          text: gefuellt.text,
          kampagneId: kampagne.id,
          empfaengerName: erste.recipientName ?? undefined,
          vorlagenWerte: werte,
          nachfassZu: erste.id,
        });
        const runAt = new Date(jetzt.getTime() + angelegt.length * kampagne.abstandMinuten * 60_000);
        await scheduleMailSend({ organizationId: input.organizationId, entwurfId: entwurf.id, runAt });
        angelegt.push({ firma: erste.recipientName || erste.toAddress, runAt });
      }
    }

    if (angelegt.length) {
      await meldeNutzer({
        organizationId: input.organizationId,
        anlass: `nachfass:${lokalesDatum(jetzt)}:${jetzt.getTime()}`,
        text:
          angelegt.length === 1
            ? `Ich fasse bei ${angelegt[0]!.firma} nach, dort kam noch keine Antwort.`
            : `Ich fasse bei ${angelegt.length} Betrieben nach, die noch nicht geantwortet haben: ${angelegt.map((item) => item.firma).join(", ")}.`,
      });
    }
    return { angelegt: angelegt.length, weiter: true };
  } finally {
    await planeNachfass(input.organizationId, new Date(jetzt.getTime() + NACHFASS_INTERVALL_MS));
  }
}
