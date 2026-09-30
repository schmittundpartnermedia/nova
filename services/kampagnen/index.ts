import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { fuelleVorlage } from "@/lib/mail/vorlagen";
import { leseKontaktliste } from "@/lib/mail/kontaktlisten";
import { createApprovalRequest, decideApproval } from "@/services/approvals";
import { erstelleEntwurf } from "@/services/mail/entwuerfe";
import { scheduleMailSendBatch } from "@/services/mail/schedule";
import { enqueueWorkItem } from "@/services/worker/queue";
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
  ungueltig: Ungueltig[];
  naechste_mail: string | null;
};

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

  const gueltig: Array<{ firma: string; email: string; betreff: string; text: string }> = [];
  const ungueltig: Ungueltig[] = [];
  const gesehen = new Set<string>();
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
    const gefuellt = fuelleVorlage(input.vorlage, werte);
    if (gefuellt.fehlend.length) {
      ungueltig.push({ zeile, firma, email, grund: `fehlende Werte: ${gefuellt.fehlend.join(", ")}` });
      continue;
    }
    gesehen.add(email.toLowerCase());
    gueltig.push({ firma, email, betreff: gefuellt.betreff, text: gefuellt.text });
  }
  if (!gueltig.length) throw new Error("Keine Zeile der Liste ist versendbar.");

  const kampagne = await prisma.campaign.create({
    data: {
      organizationId: input.organizationId,
      name: input.name?.trim() || `${input.vorlage} → ${input.liste}`,
      vorlage: input.vorlage,
      liste: input.liste,
      absender,
      abstandMinuten: abstand,
      ungueltig: JSON.stringify(ungueltig),
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
    });
  }
  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    actionType: "mail.campaign",
    description: `Kampagne „${kampagne.name}“: ${gueltig.length} Mails von ${absender}, alle ${abstand} Minuten`,
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
  return kampagnenStand(input.organizationId, kampagne.id);
}

export async function kampagnenStand(organizationId: string, kampagneId: string): Promise<KampagnenStand> {
  const kampagne = await prisma.campaign.findFirstOrThrow({ where: { id: kampagneId, organizationId } });
  const mails = await prisma.communication.findMany({
    where: { campaignId: kampagne.id, direction: "outbound" },
    orderBy: { createdAt: "asc" },
  });
  const gesendet = mails.filter((row) => row.status === "sent").length;
  const fehlgeschlagen = mails.filter((row) => row.status === "failed");
  const offen = mails.filter((row) => row.status === "draft").length;
  const naechste = await prisma.workItem.findFirst({
    where: {
      organizationId,
      kind: "mail.send",
      status: { in: ["queued", "leased", "running"] },
      payload: { in: mails.map((row) => JSON.stringify({ entwurfId: row.id })) },
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
  if (stand.ungueltig.length) {
    teile.push(`${stand.ungueltig.length} ${stand.ungueltig.length === 1 ? "Adresse war" : "Adressen waren"} ungültig und wurden nicht angeschrieben.`);
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

/** Beim Start des Hintergrund-Läufers: laufende Kampagnen melden und die Wache sicherstellen. */
export async function nachNeustart(): Promise<number> {
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
