import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { fuelleVorlage, leseVorlagen } from "@/lib/mail/vorlagen";
import { createApprovalRequest, decideApproval } from "@/services/approvals";
import { erstelleEntwurf, sendeEntwurf } from "@/services/mail/entwuerfe";
import type { Postfach } from "@/services/mail/postfach";
import { enqueueWorkItem } from "@/services/worker/queue";
import { kuerzlichGemeldet, meldeNutzer } from "@/services/meldungen";
import { nachfassEinstellung, planePostfachWache } from "@/services/kampagnen";
import { schreibeTagesbericht } from "@/services/tagesbericht";
import { schaetzeKosten } from "@/lib/leads/scanner";
import { erledigteBranchen, naechsteBranche } from "@/services/tagesbetrieb/suchplan";
import { leseEinstellungen, lokalesDatum, zeitfenster, type TagesbetriebEinstellungen } from "@/services/tagesbetrieb/einstellungen";
import { feststellungAus } from "@/lib/leads/feststellung";
import { planeNachfass } from "@/services/nachfass";
import { pruefeAdresse, type MxPruefer } from "@/services/tagesbetrieb/pruefen";

/**
 * Kunden-Tagesbetrieb (Worker-Job „tagesbetrieb.tick“ alle 5 Minuten, solange eingeschaltet):
 * 1. Vorrat: Unter N geprüften Adressen schlägt NOVA die nächste Branche im Suchgebiet vor (Reihenfolge laut Einstellungen,
 *    mit Kosten und Freigabe); gesucht wird erst nach Joachims Ja – über kunden_suchen (Gebietssuche, Worker „scanner.lauf“).
 * 2. Morgens: eine Tageskampagne mit EINER Beispiel-Mail und einer Freigabe; NOVA legt sie im Chat vor.
 * 3. Nach dem Ja: pro Takt eine Mail (geprüfte Adresse → Entwurf aus der Vorlage → Versand), bis Tageslimit oder Feierabend.
 * 4. Nach Feierabend: Tagesbericht in den Chat und nach ~/Nova/berichte/.
 */

export const TICK_MS = 5 * 60_000;

function kampagnenName(datum: string): string {
  return `Kunden-Tagesbetrieb ${datum}`;
}

function werteAus(lead: {
  firma: string;
  ansprechpartner: string | null;
  anrede: string;
  ort: string | null;
  branche: string | null;
  website: string | null;
  befunde: string | null;
  aufhaenger: string | null;
}): Record<string, string> {
  return {
    firma: lead.firma,
    ansprechpartner: lead.ansprechpartner ?? "",
    anrede: lead.anrede,
    ort: lead.ort ?? "",
    branche: lead.branche ?? "",
    website: lead.website ?? "",
    befunde: lead.befunde ?? "",
    feststellung: feststellungAus(lead.befunde),
    aufhaenger: lead.aufhaenger ?? "",
  };
}

/** Nächste geprüfte Adresse als Entwurf der Tageskampagne; unpassende Leads werden mit Grund verworfen. */
async function naechsterEntwurf(input: {
  organizationId: string;
  cfg: TagesbetriebEinstellungen;
  kampagneId: string;
  mx: MxPruefer;
}): Promise<{ entwurfId: string; leadId: string } | null> {
  for (;;) {
    const lead = await prisma.lead.findFirst({
      where: { organizationId: input.organizationId, status: "geprueft" },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    });
    if (!lead) return null;
    const erneut = await pruefeAdresse({ organizationId: input.organizationId, email: lead.email, mx: input.mx });
    if (!erneut.ok) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "verworfen", grund: erneut.grund, geprueftAt: new Date() } });
      continue;
    }
    const gefuellt = fuelleVorlage(input.cfg.vorlage, werteAus(lead));
    if (gefuellt.fehlend.length) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "verworfen", grund: `fehlende Werte für die Vorlage: ${gefuellt.fehlend.join(", ")}` },
      });
      continue;
    }
    const entwurf = await erstelleEntwurf({
      organizationId: input.organizationId,
      absender: input.cfg.absender,
      an: lead.email!,
      betreff: gefuellt.betreff,
      text: gefuellt.text,
      kampagneId: input.kampagneId,
      empfaengerName: lead.firma,
      vorlagenWerte: werteAus(lead),
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { campaignId: input.kampagneId, entwurfId: entwurf.id } });
    return { entwurfId: entwurf.id, leadId: lead.id };
  }
}

/**
 * Vorschlag statt eigenmächtiger Suche (Joachims Wunsch 01.10.2026): NOVA nennt die nächste Branche im Suchgebiet
 * mit Kosten und legt eine Freigabe genau dieser Suche an. Joachim sagt ja – oder nennt eine andere Branche.
 */
async function schlageSucheVor(input: { organizationId: string; cfg: TagesbetriebEinstellungen; branche: string; vorrat: number }) {
  const auftrag = { branche: input.branche, mitte: input.cfg.suchgebiet.mitte, radiusKm: input.cfg.suchgebiet.radiusKm };
  const kosten = schaetzeKosten(auftrag.radiusKm);
  const euro = (usd: number) => usd.toFixed(2).replace(".", ",");
  const freigabe = await createApprovalRequest({
    organizationId: input.organizationId,
    actionType: "scanner.start",
    description: `Lead-Scanner: alle ${auftrag.branche} im Umkreis von ${auftrag.radiusKm} km um ${auftrag.mitte} (ca. ${euro(kosten.kostenUsd)} $, höchstens ${euro(kosten.maxKostenUsd)} $)`,
    payload: auftrag,
  });
  const erledigt = erledigteBranchen(input.cfg);
  await meldeNutzer({
    organizationId: input.organizationId,
    anlass: `tagesbetrieb-vorschlag:${auftrag.branche}:${auftrag.mitte}:${auftrag.radiusKm}`,
    text:
      (input.vorrat === 0 ? "Im Vorrat für den Tagesbetrieb ist kein Betrieb mehr. " : `Im Vorrat für den Tagesbetrieb sind nur noch ${input.vorrat} Betriebe. `) +
      (erledigt.length ? `Durchsucht sind bisher: ${erledigt.join(", ")}. ` : "") +
      `Als Nächstes würde ich alle Betriebe der Branche „${auftrag.branche}“ im Umkreis von ${auftrag.radiusKm} km um ${auftrag.mitte} suchen, ` +
      `etwa ${euro(kosten.kostenUsd)} $, höchstens ${euro(kosten.maxKostenUsd)} $. Soll ich das machen, oder lieber eine andere Branche?`,
    werkzeugNotiz: `kunden_suchen: ${JSON.stringify({
      ok: true,
      executed: false,
      data: { status: "freigabe_noetig", freigabe_id: freigabe.id, branche: auftrag.branche, ort: auftrag.mitte, radius_km: auftrag.radiusKm, vorschlag_tagesbetrieb: true },
    })}`,
  });
}

export type TickErgebnis = { weiter: boolean; aktion: string };

export async function tagesbetriebTick(input: {
  organizationId: string;
  jetzt: Date;
  postfach: Postfach;
  mx: MxPruefer;
}): Promise<TickErgebnis> {
  const cfg = leseEinstellungen();
  if (!cfg.aktiv) return { weiter: false, aktion: "ausgeschaltet" };
  const { organizationId, jetzt } = input;
  const datum = lokalesDatum(jetzt);
  const fenster = zeitfenster(cfg, jetzt);
  const kampagne = await prisma.campaign.findFirst({
    where: { organizationId, art: "tagesbetrieb", name: kampagnenName(datum) },
  });

  if (fenster.nachEnde || !fenster.arbeitstag) {
    if (kampagne && kampagne.status !== "fertig" && kampagne.status !== "abgebrochen") {
      await prisma.campaign.update({ where: { id: kampagne.id }, data: { status: "fertig", finishedAt: jetzt } });
      await prisma.communication.updateMany({ where: { campaignId: kampagne.id, status: "draft" }, data: { status: "cancelled" } });
    }
    if (fenster.nachEnde && fenster.arbeitstag && !(await kuerzlichGemeldet(organizationId, `tagesbericht:${datum}`, 24 * 60))) {
      await schreibeTagesbericht({ organizationId, datum, melden: true });
      return { weiter: true, aktion: "tagesbericht" };
    }
    return { weiter: true, aktion: "ausserhalb" };
  }
  if (!fenster.vorbereiten) return { weiter: true, aktion: "vor dem Start" };

  if (!leseVorlagen().some((vorlage) => vorlage.name === cfg.vorlage)) {
    if (!(await kuerzlichGemeldet(organizationId, `tagesbetrieb-vorlage:${datum}`, 24 * 60))) {
      await meldeNutzer({
        organizationId,
        anlass: `tagesbetrieb-vorlage:${datum}`,
        text: `Der Kunden-Tagesbetrieb wartet: Die Vorlage „${cfg.vorlage}“ fehlt in ~/Nova/vorlagen/.`,
      });
    }
    return { weiter: true, aktion: "vorlage fehlt" };
  }

  // Vorrat knapp: nächste Branche im Suchgebiet VORSCHLAGEN (gesucht wird erst nach Joachims Ja).
  const vorrat = await prisma.lead.count({ where: { organizationId, status: "geprueft" } });
  if (vorrat < cfg.vorratMindestens) {
    const laufend = await prisma.workItem.count({
      where: { organizationId, kind: "scanner.lauf", status: { in: ["queued", "leased", "running"] } },
    });
    const branche = naechsteBranche(cfg);
    if (!laufend && !branche) {
      if (!(await kuerzlichGemeldet(organizationId, `tagesbetrieb-gebiet-fertig:${cfg.suchgebiet.mitte}:${cfg.suchgebiet.radiusKm}`, 7 * 24 * 60))) {
        await meldeNutzer({
          organizationId,
          anlass: `tagesbetrieb-gebiet-fertig:${cfg.suchgebiet.mitte}:${cfg.suchgebiet.radiusKm}`,
          text: `Alle ${cfg.branchen.length} Branchen im Umkreis von ${cfg.suchgebiet.radiusKm} km um ${cfg.suchgebiet.mitte} sind durchsucht. Für neue Betriebe brauche ich ein neues Gebiet oder weitere Branchen.`,
        });
      }
    } else if (
      !laufend &&
      branche &&
      !(await kuerzlichGemeldet(organizationId, `tagesbetrieb-vorschlag:${branche}:${cfg.suchgebiet.mitte}:${cfg.suchgebiet.radiusKm}`, 24 * 60))
    ) {
      await schlageSucheVor({ organizationId, cfg, branche, vorrat });
    }
  }

  // Morgens: Tageskampagne mit Beispiel-Mail zur Freigabe vorlegen.
  if (!kampagne) {
    const nachfass = nachfassEinstellung(cfg.vorlage, cfg.nachfassTage, false);
    const neu = await prisma.campaign.create({
      data: {
        organizationId,
        name: kampagnenName(datum),
        art: "tagesbetrieb",
        vorlage: cfg.vorlage,
        liste: "lead-scanner",
        absender: cfg.absender,
        abstandMinuten: cfg.abstandMinuten,
        nachfassTage: nachfass?.tage ?? null,
        nachfassVorlage: nachfass?.vorlage ?? null,
      },
    });
    const beispiel = await naechsterEntwurf({ organizationId, cfg, kampagneId: neu.id, mx: input.mx });
    if (!beispiel) {
      await prisma.campaign.delete({ where: { id: neu.id } });
      return { weiter: true, aktion: "warte auf geprüfte Adressen" };
    }
    const approval = await createApprovalRequest({
      organizationId,
      actionType: "mail.campaign",
      description:
        `${kampagnenName(datum)}: bis ${cfg.maxProTag} Mails von ${cfg.absender}, ${cfg.start}–${cfg.ende} Uhr, alle ${cfg.abstandMinuten} Minuten` +
        (nachfass ? `; Nachfass-Mail nach ${nachfass.tage} Tagen ohne Antwort (Vorlage „${nachfass.vorlage}“)` : ""),
      payload: { kampagneId: neu.id, tagesbetrieb: true },
    });
    await prisma.campaign.update({ where: { id: neu.id }, data: { approvalId: approval.id } });
    const entwurf = await prisma.communication.findUniqueOrThrow({ where: { id: beispiel.entwurfId } });
    await meldeNutzer({
      organizationId,
      anlass: `tagesbetrieb-freigabe:${datum}`,
      text:
        `Kunden-Tagesbetrieb heute: bis zu ${cfg.maxProTag} Mails von ${cfg.absender}, ${cfg.start}–${cfg.ende} Uhr, ` +
        `alle ${cfg.abstandMinuten} Minuten, Vorlage „${cfg.vorlage}“. Jede Adresse wird vorher geprüft. ` +
        (nachfass ? `Wer nach ${nachfass.tage} Tagen nicht antwortet, bekommt eine kurze Nachfass-Mail. ` : "") +
        `Hier die erste Mail als Beispiel (an ${entwurf.recipientName}, ${entwurf.toAddress}). Soll ich heute so starten?`,
      werkzeugNotiz: `kampagne_planen: ${JSON.stringify({
        ok: true,
        executed: true,
        data: { kampagne_id: neu.id, freigabe_id: approval.id, entwurf_id: entwurf.id, status: "wartet_auf_freigabe", tagesbetrieb: true },
      })}`,
    });
    return { weiter: true, aktion: "freigabe vorgelegt" };
  }

  if (kampagne.status !== "laeuft" || !fenster.imFenster) return { weiter: true, aktion: `kampagne ${kampagne.status}` };

  const heute = await prisma.communication.count({ where: { campaignId: kampagne.id, direction: "outbound", status: "sent" } });
  if (heute >= cfg.maxProTag) return { weiter: true, aktion: "tageslimit erreicht" };
  const letzte = await prisma.communication.findFirst({
    where: { campaignId: kampagne.id, status: "sent" },
    orderBy: { sentAt: "desc" },
  });
  if (letzte?.sentAt && jetzt.getTime() - letzte.sentAt.getTime() < (cfg.abstandMinuten * 60_000) - 30_000) {
    return { weiter: true, aktion: "abstand" };
  }

  const offen = await prisma.communication.findFirst({ where: { campaignId: kampagne.id, status: "draft" }, orderBy: { createdAt: "asc" } });
  const naechster = offen
    ? { entwurfId: offen.id }
    : await naechsterEntwurf({ organizationId, cfg, kampagneId: kampagne.id, mx: input.mx });
  if (!naechster) return { weiter: true, aktion: "keine geprüfte Adresse im Vorrat" };

  const ergebnis = await sendeEntwurf({ organizationId, entwurfId: naechster.entwurfId, postfach: input.postfach, jetzt });
  const lead = await prisma.lead.findFirst({ where: { organizationId, entwurfId: naechster.entwurfId } });
  if (ergebnis.status === "gesendet") {
    if (lead) await prisma.lead.update({ where: { id: lead.id }, data: { status: "angeschrieben" } });
    await planePostfachWache(organizationId, new Date(jetzt.getTime() + TICK_MS));
    return { weiter: true, aktion: "gesendet" };
  }
  await prisma.communication.update({
    where: { id: naechster.entwurfId },
    data: { status: "failed", externalReference: ergebnis.grund.slice(0, 300) },
  });
  if (lead) await prisma.lead.update({ where: { id: lead.id }, data: { status: "verworfen", grund: `Versand fehlgeschlagen: ${ergebnis.grund}` } });
  return { weiter: true, aktion: `fehlgeschlagen: ${ergebnis.grund}` };
}

/** Joachims Ja zur Beispiel-Mail: Tageskampagne läuft. */
export async function tagesbetriebFreigeben(input: { organizationId: string; freigabeId: string }) {
  assertOrganizationId(input.organizationId);
  const kampagne = await prisma.campaign.findFirst({
    where: { organizationId: input.organizationId, art: "tagesbetrieb", approvalId: input.freigabeId },
  });
  if (!kampagne) throw new Error("Zu dieser Freigabe gibt es keine Tageskampagne.");
  if (kampagne.status !== "wartet_auf_freigabe") throw new Error(`Die Tageskampagne ist bereits ${kampagne.status}.`);
  await decideApproval({ organizationId: input.organizationId, approvalId: input.freigabeId, status: "approved" });
  await prisma.campaign.update({ where: { id: kampagne.id }, data: { status: "laeuft", startedAt: new Date() } });
  if (kampagne.nachfassTage) await planeNachfass(input.organizationId, new Date(Date.now() + 60_000));
  return { kampagne_id: kampagne.id, name: kampagne.name, status: "laeuft" };
}

/** Plant den nächsten Takt (höchstens einer pro 5-Minuten-Fenster). */
export async function planeTagesbetriebTick(organizationId: string, runAt: Date) {
  const slot = Math.floor(runAt.getTime() / TICK_MS);
  return enqueueWorkItem({
    organizationId,
    kind: "tagesbetrieb.tick",
    idempotencyKey: `tagesbetrieb.tick:${slot}`,
    payload: {},
    runAt,
    maxAttempts: 1,
  });
}

export async function tagesbetriebStand(organizationId: string, jetzt = new Date()) {
  const cfg = leseEinstellungen();
  const datum = lokalesDatum(jetzt);
  const kampagne = await prisma.campaign.findFirst({ where: { organizationId, art: "tagesbetrieb", name: kampagnenName(datum) } });
  const [vorrat, gesendet, verworfenHeute] = await Promise.all([
    prisma.lead.count({ where: { organizationId, status: "geprueft" } }),
    kampagne ? prisma.communication.count({ where: { campaignId: kampagne.id, status: "sent" } }) : Promise.resolve(0),
    prisma.lead.count({ where: { organizationId, status: "verworfen", geprueftAt: { gte: new Date(`${datum}T00:00:00`) } } }),
  ]);
  return {
    einstellungen: cfg,
    heute: { datum, kampagne: kampagne?.status ?? "noch keine", gesendet, max: cfg.maxProTag, verworfen: verworfenHeute },
    vorrat_geprueft: vorrat,
    suchplan: {
      gebiet: `Umkreis von ${cfg.suchgebiet.radiusKm} km um ${cfg.suchgebiet.mitte}`,
      erledigt: erledigteBranchen(cfg),
      naechste_branche: naechsteBranche(cfg) ?? "keine mehr – alle Branchen durchsucht",
    },
  };
}
