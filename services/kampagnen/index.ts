import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { fuelleVorlage, leseVorlagen } from "@/lib/mail/vorlagen";
import { leseKontaktliste } from "@/lib/mail/kontaktlisten";
import { createApprovalRequest, decideApproval } from "@/services/approvals";
import { erstelleEntwurf } from "@/services/mail/entwuerfe";
import { scheduleMailSendBatch } from "@/services/mail/schedule";
import { enqueueWorkItem } from "@/services/worker/queue";
import { aufSperrliste, leseSperrliste } from "@/lib/mail/sperrliste";
import { NACHFASS_INTERVALL_MS, planeNachfass } from "@/services/nachfass";
import { kuerzlichGemeldet, meldeNutzer } from "@/services/meldungen";

/**
 * Kampagnen: eine Vorlage × eine Kontaktliste, eine Mail alle N Minuten über den Hintergrund-Läufer.
 * Ablauf: planen (Entwürfe + eine Freigabe) → Nutzer sagt ja → starten (Work-Items mit runAt) → fertig melden.
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const WACHE_INTERVALL_MS = 5 * 60_000;

export type Ungueltig = { zeile: number; firma: string; email: string; grund: string };

export type KampagnenStand = {
  kampagne_id: string;
  name: string;
  status: string;
  vorlage: string;
  liste: string;
  absender: string;
  abstand_minuten: number;
  gesamt: number;
  gesendet: number;
  offen: number;
  fehlgeschlagen: Array<{ firma: string; email: string; grund: string }>;
  /** Nicht gesendet, weil der Empfänger inzwischen auf der Sperrliste steht. */
  gesperrt: Array<{ firma: string; email: string }>;
  /** Gesendet, aber als unzustellbar zurückgekommen. */
  unzustellbar: Array<{ firma: string; email: string }>;
  nachfass: { nach_tagen: number; vorlage: string; gesendet: number; geplant: number } | null;
  ungueltig: Ungueltig[];
  naechste_mail: string | null;
};

/** Standard-Abstand der Nachfass-Mail, wenn es eine Nachfass-Vorlage gibt. */
export const NACHFASS_STANDARD_TAGE = 6;

/**
 * Nachfass-Einstellung einer Kampagne: Vorlage „<vorlage>-nachfass“ muss es geben.
 * tage weggelassen → Standard; 0 → kein Nachfassen.
 */
export function nachfassEinstellung(
  vorlage: string,
  tage?: number,
  /** Ausdrücklich gewünscht (Werkzeug): fehlende Vorlage ist ein Fehler. Tagesbetrieb: dann eben ohne Nachfass. */
  vorlagePflicht = true,
): { tage: number; vorlage: string } | null {
  if (tage === 0) return null;
  const name = `${vorlage}-nachfass`;
  const gibtEs = leseVorlagen().some((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!gibtEs) {
    if (tage !== undefined && vorlagePflicht) throw new Error(`Für eine Nachfass-Mail fehlt die Vorlage „${name}“ in ~/Nova/vorlagen/.`);
    return null;
  }
  const clean = tage === undefined ? NACHFASS_STANDARD_TAGE : Math.round(tage);
  if (!Number.isFinite(clean) || clean < 2 || clean > 30) throw new Error("Nachfass nach 2 bis 30 Tagen.");
  return { tage: clean, vorlage: name };
}

function firmaAus(werte: Record<string, string>): string {
  return werte.firma || werte.unternehmen || werte.email || "";
}

export async function planeKampagne(input: {
  organizationId: string;
  vorlage: string;
  liste: string;
  absender: string;
  abstandMinuten: number;
  name?: string;
  /** Nachfass nach so vielen Tagen ohne Antwort; 0 = keins; weggelassen = Standard (wenn es „<vorlage>-nachfass“ gibt). */
  nachfassTage?: number;
}) {
  assertOrganizationId(input.organizationId);
  const absender = input.absender.trim().toLowerCase();
  if (!isSteerableMailAddress(absender)) {
    throw new Error(`Absender muss ${steerableMailAddresses().join(" oder ")} sein.`);
  }
  const abstand = Math.round(input.abstandMinuten);
  if (!Number.isFinite(abstand) || abstand < 1 || abstand > 24 * 60) {
    throw new Error("Abstand muss zwischen 1 und 1440 Minuten liegen.");
  }
  const zeilen = leseKontaktliste(input.liste);
  if (!zeilen.length) throw new Error(`Die Kontaktliste „${input.liste}“ ist leer.`);

  const gueltig: Array<{ firma: string; email: string; betreff: string; text: string; werte: Record<string, string> }> = [];
  const ungueltig: Ungueltig[] = [];
  const gesehen = new Set<string>();
  const sperrliste = leseSperrliste();
  for (const { zeile, werte } of zeilen) {
    const email = (werte.email ?? "").trim();
    const firma = firmaAus(werte);
    if (!EMAIL.test(email)) {
      ungueltig.push({ zeile, firma, email, grund: "keine gültige Mail-Adresse" });
      continue;
    }
    if (gesehen.has(email.toLowerCase())) {
      ungueltig.push({ zeile, firma, email, grund: "Adresse doppelt in der Liste" });
      continue;
    }
    if (aufSperrliste(email, sperrliste)) {
      ungueltig.push({ zeile, firma, email, grund: "steht auf der Sperrliste" });
      continue;
    }
    const gefuellt = fuelleVorlage(input.vorlage, werte);
    if (gefuellt.fehlend.length) {
      ungueltig.push({ zeile, firma, email, grund: `fehlende Werte: ${gefuellt.fehlend.join(", ")}` });
      continue;
    }
    gesehen.add(email.toLowerCase());
    gueltig.push({ firma, email, betreff: gefuellt.betreff, text: gefuellt.text, werte });
  }
  if (!gueltig.length) throw new Error("Keine Zeile der Liste ist versendbar.");
  const nachfass = nachfassEinstellung(input.vorlage, input.nachfassTage);

  const kampagne = await prisma.campaign.create({
    data: {
      organizationId: input.organizationId,
      name: input.name?.trim() || `${input.vorlage} → ${input.liste}`,
      vorlage: input.vorlage,
      liste: input.liste,
      absender,
      abstandMinuten: abstand,
      ungueltig: JSON.stringify(ungueltig),
      nachfassTage: nachfass?.tage ?? null,
      nachfassVorlage: nachfass?.vorlage ?? null,
    },
  });
  for (const mail of gueltig) {
    await erstelleEntwurf({
      organizationId: input.organizationId,
      absender,
      an: mail.email,
      betreff: mail.betreff,
      text: mail.text,
      kampagneId: kampagne.id,
      empfaengerName: mail.firma,
      vorlagenWerte: mail.werte,
    });
  }
  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    actionType: "mail.campaign",
    description:
      `Kampagne „${kampagne.name}“: ${gueltig.length} Mails von ${absender}, alle ${abstand} Minuten` +
      (nachfass ? `; wer nach ${nachfass.tage} Tagen nicht geantwortet hat, bekommt eine Nachfass-Mail (Vorlage „${nachfass.vorlage}“)` : ""),
    payload: { kampagneId: kampagne.id, anzahl: gueltig.length },
  });
  await prisma.campaign.update({ where: { id: kampagne.id }, data: { approvalId: approval.id } });

  return {
    kampagne_id: kampagne.id,
    freigabe_id: approval.id,
    name: kampagne.name,
    anzahl: gueltig.length,
    absender,
    abstand_minuten: abstand,
    dauer_minuten: (gueltig.length - 1) * abstand,
    nachfass: nachfass
      ? { nach_tagen: nachfass.tage, vorlage: nachfass.vorlage, hinweis: "Nur an Empfänger ohne Antwort; in der Zusammenfassung nennen." }
      : "keine Nachfass-Mail",
    empfaenger: gueltig.map((mail) => `${mail.firma} <${mail.email}>`),
    ungueltig,
    beispiel: { an: gueltig[0]!.email, betreff: gueltig[0]!.betreff, text: gueltig[0]!.text },
  };
}

/** Startet eine geplante Kampagne – nur mit ihrer eigenen, vom Nutzer bestätigten Freigabe. */
export async function starteKampagne(input: { organizationId: string; kampagneId: string; freigabeId: string }) {
  assertOrganizationId(input.organizationId);
  const kampagne = await prisma.campaign.findFirst({
    where: { id: input.kampagneId, organizationId: input.organizationId },
  });
  if (!kampagne) throw new Error("Kampagne nicht gefunden.");
  if (kampagne.status !== "wartet_auf_freigabe") throw new Error(`Kampagne ist bereits ${kampagne.status}.`);
  if (!kampagne.approvalId || kampagne.approvalId !== input.freigabeId) {
    throw new Error("Diese Freigabe gehört nicht zu dieser Kampagne.");
  }
  await decideApproval({ organizationId: input.organizationId, approvalId: kampagne.approvalId, status: "approved" });
  const entwuerfe = await prisma.communication.findMany({
    where: { campaignId: kampagne.id, status: "draft" },
    orderBy: { createdAt: "asc" },
  });
  const start = new Date();
  await prisma.campaign.update({ where: { id: kampagne.id }, data: { status: "laeuft", startedAt: start } });
  await scheduleMailSendBatch({
    organizationId: input.organizationId,
    entwurfIds: entwuerfe.map((row) => row.id),
    startAt: start,
    intervalMs: kampagne.abstandMinuten * 60_000,
  });
  await planePostfachWache(input.organizationId, new Date(start.getTime() + WACHE_INTERVALL_MS));
  if (kampagne.nachfassTage) await planeNachfass(input.organizationId, new Date(start.getTime() + NACHFASS_INTERVALL_MS));
  return kampagnenStand(input.organizationId, kampagne.id);
}

export async function kampagnenStand(organizationId: string, kampagneId: string): Promise<KampagnenStand> {
  const kampagne = await prisma.campaign.findFirstOrThrow({ where: { id: kampagneId, organizationId } });
  const alle = await prisma.communication.findMany({
    where: { campaignId: kampagne.id, direction: "outbound" },
    orderBy: { createdAt: "asc" },
  });
  // Erste Mails und Nachfass-Mails getrennt zählen.
  const mails = alle.filter((row) => !row.nachfassZu);
  const nachfassMails = alle.filter((row) => row.nachfassZu);
  const gesendet = mails.filter((row) => row.status === "sent").length;
  const fehlgeschlagen = mails.filter((row) => row.status === "failed");
  const offen = mails.filter((row) => row.status === "draft").length;
  const sperrliste = leseSperrliste();
  const person = (row: { recipientName: string | null; toAddress: string | null }) => ({ firma: row.recipientName ?? "", email: row.toAddress ?? "" });
  const gesperrt = mails.filter((row) => row.status === "cancelled" && aufSperrliste(row.toAddress ?? "", sperrliste)).map(person);
  const unzustellbar = mails.filter((row) => row.status === "sent" && row.deliveryStatus === "BOUNCED").map(person);
  const naechste = await prisma.workItem.findFirst({
    where: {
      organizationId,
      kind: "mail.send",
      status: { in: ["queued", "leased", "running"] },
      payload: { in: alle.map((row) => JSON.stringify({ entwurfId: row.id })) },
    },
    orderBy: { runAt: "asc" },
  });
  return {
    kampagne_id: kampagne.id,
    name: kampagne.name,
    status: kampagne.status,
    vorlage: kampagne.vorlage,
    liste: kampagne.liste,
    absender: kampagne.absender,
    abstand_minuten: kampagne.abstandMinuten,
    gesamt: mails.length,
    gesendet,
    offen,
    fehlgeschlagen: fehlgeschlagen.map((row) => ({
      firma: row.recipientName ?? "",
      email: row.toAddress ?? "",
      grund: row.externalReference ?? "",
    })),
    gesperrt,
    unzustellbar,
    nachfass: kampagne.nachfassTage
      ? {
          nach_tagen: kampagne.nachfassTage,
          vorlage: kampagne.nachfassVorlage ?? "",
          gesendet: nachfassMails.filter((row) => row.status === "sent").length,
          geplant: nachfassMails.filter((row) => row.status === "draft").length,
        }
      : null,
    ungueltig: JSON.parse(kampagne.ungueltig || "[]") as Ungueltig[],
    naechste_mail: kampagne.status === "laeuft" && naechste ? naechste.runAt.toISOString() : null,
  };
}

export async function kampagnenListe(organizationId: string): Promise<KampagnenStand[]> {
  assertOrganizationId(organizationId);
  const rows = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return Promise.all(rows.map((row) => kampagnenStand(organizationId, row.id)));
}

export async function brecheKampagneAb(organizationId: string, kampagneId: string) {
  assertOrganizationId(organizationId);
  const kampagne = await prisma.campaign.findFirst({ where: { id: kampagneId, organizationId } });
  if (!kampagne) throw new Error("Kampagne nicht gefunden.");
  if (kampagne.status === "fertig" || kampagne.status === "abgebrochen") {
    throw new Error(`Kampagne ist schon ${kampagne.status}.`);
  }
  const alle = await prisma.communication.findMany({ where: { campaignId: kampagne.id, direction: "outbound" } });
  await prisma.campaign.update({ where: { id: kampagne.id }, data: { status: "abgebrochen", finishedAt: new Date() } });
  await prisma.communication.updateMany({ where: { campaignId: kampagne.id, status: "draft" }, data: { status: "cancelled" } });
  await prisma.workItem.updateMany({
    where: {
      organizationId,
      kind: "mail.send",
      status: "queued",
      payload: { in: alle.map((row) => JSON.stringify({ entwurfId: row.id })) },
    },
    data: { status: "cancelled", lockedBy: null, lockedUntil: null },
  });
  if (kampagne.approvalId && kampagne.status === "wartet_auf_freigabe") {
    await decideApproval({ organizationId, approvalId: kampagne.approvalId, status: "rejected" });
  }
  return kampagnenStand(organizationId, kampagne.id);
}

/** Nach jedem Versandversuch: Ist die Kampagne durch, wird sie abgeschlossen und der Nutzer informiert. */
export async function nachKampagnenVersand(organizationId: string, entwurfId: string, ergebnis: { gesendet: boolean; grund: string }) {
  const entwurf = await prisma.communication.findFirst({ where: { id: entwurfId, organizationId } });
  if (!entwurf?.campaignId) return;
  if (!ergebnis.gesendet && entwurf.status === "draft") {
    // Für Kampagnen-Mails ist „failed“ endgültig; der Grund steht in externalReference.
    await prisma.communication.update({
      where: { id: entwurf.id },
      data: { status: "failed", externalReference: ergebnis.grund.slice(0, 300) },
    });
  }
  const kampagne = await prisma.campaign.findFirst({ where: { id: entwurf.campaignId, organizationId } });
  // Der Tagesbetrieb schließt seine Kampagne selbst nach Feierabend.
  if (!kampagne || kampagne.status !== "laeuft" || kampagne.art === "tagesbetrieb") return;
  const offen = await prisma.communication.count({ where: { campaignId: kampagne.id, status: "draft" } });
  if (offen > 0) return;
  const beendet = await prisma.campaign.updateMany({
    where: { id: kampagne.id, status: "laeuft" },
    data: { status: "fertig", finishedAt: new Date() },
  });
  if (beendet.count !== 1) return;
  const stand = await kampagnenStand(organizationId, kampagne.id);
  await meldeNutzer({
    organizationId,
    anlass: `kampagne-fertig:${kampagne.id}`,
    text: fertigMeldung(stand),
  });
}

export function fertigMeldung(stand: KampagnenStand): string {
  const teile = [
    stand.fehlgeschlagen.length === 0
      ? `Kampagne „${stand.name}“ ist durch: Alle ${stand.gesendet} Mails sind raus.`
      : `Kampagne „${stand.name}“ ist durch: ${stand.gesendet} von ${stand.gesamt} Mails sind raus, ${stand.fehlgeschlagen.length} nicht (${stand.fehlgeschlagen.map((item) => item.firma || item.email).join(", ")}).`,
  ];
  if (stand.gesperrt.length) {
    teile.push(`${stand.gesperrt.length} nicht gesendet, weil sie inzwischen auf der Sperrliste ${stand.gesperrt.length === 1 ? "steht" : "stehen"}.`);
  }
  if (stand.unzustellbar.length) {
    teile.push(`${stand.unzustellbar.length} kam${stand.unzustellbar.length === 1 ? "" : "en"} als unzustellbar zurück (${stand.unzustellbar.map((item) => item.firma || item.email).join(", ")}), die Adresse${stand.unzustellbar.length === 1 ? " ist" : "n sind"} gesperrt.`);
  }
  if (stand.ungueltig.length) {
    teile.push(
      stand.ungueltig.length === 1
        ? "1 Adresse war ungültig und wurde nicht angeschrieben."
        : `${stand.ungueltig.length} Adressen waren ungültig und wurden nicht angeschrieben.`,
    );
  }
  teile.push("Antworten lege ich dir vor, sobald sie eingehen.");
  return teile.join(" ");
}

/** Plant den nächsten Lauf der Postfach-Wache (höchstens einer pro Zeitfenster). */
export async function planePostfachWache(organizationId: string, runAt: Date) {
  const slot = Math.floor(runAt.getTime() / WACHE_INTERVALL_MS);
  return enqueueWorkItem({
    organizationId,
    kind: "postfach.wache",
    idempotencyKey: `postfach.wache:${slot}`,
    payload: {},
    runAt,
    maxAttempts: 1,
  });
}

/** Beim Start des Hintergrund-Läufers: laufende Kampagnen melden, Wache und Nachfass sicherstellen. */
export async function nachNeustart(): Promise<number> {
  const mitNachfass = await prisma.campaign.findMany({
    where: { nachfassTage: { not: null }, status: { in: ["laeuft", "fertig"] } },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });
  for (const { organizationId } of mitNachfass) await planeNachfass(organizationId, new Date(Date.now() + 60_000));

  const laufend = await prisma.campaign.findMany({ where: { status: "laeuft", art: "kampagne" } });
  for (const kampagne of laufend) {
    const anlass = `kampagne-neustart:${kampagne.id}`;
    if (await kuerzlichGemeldet(kampagne.organizationId, anlass, 10)) continue;
    const stand = await kampagnenStand(kampagne.organizationId, kampagne.id);
    await meldeNutzer({
      organizationId: kampagne.organizationId,
      anlass,
      text: `Nach dem Neustart läuft die Kampagne „${stand.name}“ weiter: ${stand.gesendet} von ${stand.gesamt} Mails sind raus, ${stand.offen} folgen.`,
    });
    await planePostfachWache(kampagne.organizationId, new Date(Date.now() + 60_000));
  }
  return laufend.length;
}
