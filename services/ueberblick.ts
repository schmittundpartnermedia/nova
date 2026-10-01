import { prisma } from "@/lib/prisma";
import { parseMailAddress } from "@/lib/mail/apple";
import { alleAuftraege } from "@/services/claude";
import { termineAnzeigen } from "@/services/termine";
import { kampagnenStand } from "@/services/kampagnen";
import { leseEinstellungen } from "@/services/tagesbetrieb/einstellungen";
import { wirkung } from "@/services/wirkung";
import type { Postfach } from "@/services/mail/postfach";
import { schliesseAbgelaufeneFreigaben } from "@/services/approvals";
import type { CheckQuelle } from "@/lib/rankpilot/checks";

/**
 * Tagesüberblick („Was liegt heute an?“): was auf Joachim wartet (Antworten, Freigaben, Entwürfe, Claude-Ergebnisse, Termine),
 * was läuft (Kampagnen, Nachfass, Tagesbetrieb, Claude) und die Zahlen seit gestern. Alles aus dem echten Zustand.
 */
export async function tagesueberblick(input: { organizationId: string; postfach: Postfach; jetzt?: Date; checkQuelle?: CheckQuelle }) {
  const jetzt = input.jetzt ?? new Date();
  const gestern = new Date(jetzt.getTime() - 86_400_000);
  const org = input.organizationId;

  let postfach: { ungelesen: number; neueste: Array<{ von: string; betreff: string }> } | { fehler: string };
  try {
    const mails = await input.postfach.neueste({ anzahl: 15, nurUngelesen: true });
    postfach = {
      ungelesen: mails.length,
      neueste: mails.slice(0, 5).map((mail) => ({ von: parseMailAddress(mail.von).name || parseMailAddress(mail.von).email, betreff: mail.betreff })),
    };
  } catch (error) {
    postfach = { fehler: `Apple Mail war nicht lesbar: ${error instanceof Error ? error.message : String(error)}` };
  }

  // Antworten aus Kampagnen, auf die noch keine Antwort rausging (Entwurf liegt evtl. schon bereit).
  const eingang = await prisma.communication.findMany({
    where: { organizationId: org, direction: "inbound", status: "received", createdAt: { gte: new Date(jetzt.getTime() - 14 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
  });
  const antwortenOffen: Array<{ firma: string; betreff: string; entwurf_bereit: boolean }> = [];
  for (const mail of eingang) {
    if (!mail.replyRef) continue;
    const antworten = await prisma.communication.findMany({ where: { organizationId: org, direction: "outbound", replyRef: mail.replyRef } });
    if (antworten.some((row) => row.status === "sent")) continue;
    antwortenOffen.push({ firma: mail.recipientName ?? mail.fromAddress ?? "", betreff: mail.subject, entwurf_bereit: antworten.some((row) => row.status === "draft") });
  }

  await schliesseAbgelaufeneFreigaben(org, jetzt);
  const freigaben = await prisma.approvalRequest.findMany({
    where: { organizationId: org, status: "pending", createdAt: { gte: new Date(jetzt.getTime() - 7 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
  });
  const entwuerfe = await prisma.communication.findMany({
    where: { organizationId: org, direction: "outbound", status: "draft", campaignId: null, createdAt: { gte: new Date(jetzt.getTime() - 7 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
  });

  const kampagnen = await prisma.campaign.findMany({
    where: { organizationId: org, status: { in: ["laeuft", "wartet_auf_freigabe"] }, createdAt: { gte: new Date(jetzt.getTime() - 14 * 86_400_000) } },
  });
  const staende = await Promise.all(kampagnen.map((kampagne) => kampagnenStand(org, kampagne.id)));
  const nachfassGeplant = await prisma.communication.count({ where: { organizationId: org, status: "draft", nachfassZu: { not: null } } });

  const claude = alleAuftraege()
    .filter((auftrag) => auftrag.organizationId === org && new Date(auftrag.erstellt) >= new Date(jetzt.getTime() - 7 * 86_400_000))
    .filter((auftrag) => auftrag.status !== "live")
    .map((auftrag) => ({
      projekt: auftrag.projekt,
      aufgabe: auftrag.aufgabe.slice(0, 160),
      stand:
        auftrag.status === "fertig"
          ? "fertig und geprüft, wartet auf dein Ja zum Live-Stellen"
          : auftrag.status === "fehlgeschlagen" || auftrag.status === "live_fehlgeschlagen"
            ? `Problem: ${auftrag.fehler ?? auftrag.status}`
            : "läuft",
    }));

  // Heute und morgen; bereits erinnerte Termine von heute bleiben drin, bis sie erledigt sind.
  const heuteFrueh = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const termine = await termineAnzeigen({ organizationId: org, von: heuteFrueh, bis: new Date(heuteFrueh.getTime() + 2 * 86_400_000) });

  const cfg = leseEinstellungen();
  const wirkt = await wirkung({ organizationId: org, seit: gestern, bis: jetzt, quelle: input.checkQuelle });
  const gesendetSeitGestern = await prisma.communication.count({
    where: { organizationId: org, direction: "outbound", status: "sent", sentAt: { gte: gestern, lt: jetzt } },
  });

  return {
    wartet_auf_dich: {
      antworten_ohne_rueckmeldung: antwortenOffen,
      offene_freigaben: freigaben.map((item) => item.description),
      entwuerfe_nicht_gesendet: entwuerfe.map((row) => ({ an: row.recipientName || row.toAddress, betreff: row.subject })),
      claude_auftraege: claude,
      termine_heute_und_morgen: termine.map((t) => ({ wann: t.wann, titel: t.titel, notiz: t.notiz })),
    },
    laeuft: {
      kampagnen: staende.map((stand) => ({ name: stand.name, status: stand.status, gesendet: stand.gesendet, gesamt: stand.gesamt })),
      nachfass_geplant: nachfassGeplant,
      tagesbetrieb: cfg.aktiv ? `an, ${cfg.start}–${cfg.ende} Uhr, bis ${cfg.maxProTag} Mails` : "aus",
    },
    seit_gestern: {
      mails_gesendet: gesendetSeitGestern,
      antworten: wirkt.kampagnen.reduce((summe, k) => summe + k.antworten, 0),
      checks: wirkt.checks_eingerichtet ? wirkt.checks.length : "nicht eingerichtet",
      neue_konten: wirkt.checks.filter((check) => check.konto_angelegt).length,
    },
    postfach,
  };
}
