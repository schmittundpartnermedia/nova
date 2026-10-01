import type { Termin } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kalender, type KalenderEintrag } from "@/lib/kalender";
import { meldeNutzer } from "@/services/meldungen";
import { cancelWorkItem, enqueueWorkItem } from "@/services/worker/queue";

/**
 * Termine und Rückrufe. NOVA speichert sie bei sich und erinnert über den Hintergrund-Läufer
 * (Work-Item „termin.erinnerung“ mit runAt = Beginn − Vorlauf). Auf Wunsch zusätzlich im Kalender.
 */

export type TerminAnsicht = {
  id: string;
  titel: string;
  beginn: string;
  wann: string;
  dauerMinuten: number;
  notiz: string | null;
  erinnerungMinuten: number;
  status: string;
  imKalender: string | null;
};

export function wannText(beginn: Date): string {
  const tag = beginn.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const zeit = beginn.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${tag}, ${zeit} Uhr`;
}

function ansicht(t: Termin): TerminAnsicht {
  return {
    id: t.id,
    titel: t.titel,
    beginn: t.beginn.toISOString(),
    wann: wannText(t.beginn),
    dauerMinuten: t.dauerMinuten,
    notiz: t.notiz,
    erinnerungMinuten: t.erinnerungMinuten,
    status: t.status,
    imKalender: t.kalenderName,
  };
}

function eintragAus(t: Termin): KalenderEintrag {
  return { titel: t.titel, beginn: t.beginn, dauerMinuten: t.dauerMinuten, notiz: t.notiz ?? undefined, erinnerungMinuten: t.erinnerungMinuten };
}

function erinnerungsSchluessel(t: Termin): string {
  return `termin.erinnerung:${t.id}:${t.beginn.getTime()}:${t.erinnerungMinuten}`;
}

/** Plant die Erinnerung; liegt der Zeitpunkt schon zurück, der Termin aber noch vor uns, sofort. */
async function planeErinnerung(t: Termin, jetzt: Date): Promise<void> {
  if (t.erinnerungMinuten <= 0 || t.status !== "geplant" || t.beginn <= jetzt) return;
  const zeitpunkt = new Date(t.beginn.getTime() - t.erinnerungMinuten * 60_000);
  await enqueueWorkItem({
    organizationId: t.organizationId,
    kind: "termin.erinnerung",
    idempotencyKey: erinnerungsSchluessel(t),
    payload: { terminId: t.id, beginn: t.beginn.toISOString() },
    runAt: zeitpunkt > jetzt ? zeitpunkt : jetzt,
    maxAttempts: 3,
  });
}

async function streicheErinnerungen(t: Termin): Promise<void> {
  const offen = await prisma.workItem.findMany({
    where: { organizationId: t.organizationId, kind: "termin.erinnerung", status: { in: ["queued", "paused"] }, payload: { contains: `"terminId":"${t.id}"` } },
  });
  for (const item of offen) await cancelWorkItem(item.id, t.organizationId, "Termin geändert");
}

export function leseBeginn(wert: unknown): Date | null {
  if (typeof wert !== "string" || !wert.trim()) return null;
  // Ohne Zeitzonenangabe gilt deutsche Zeit (Prozesse laufen mit TZ=Europe/Berlin) (so rechnet der Kopf „Donnerstag 10 Uhr“).
  const d = new Date(wert.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function legeTerminAn(input: {
  organizationId: string;
  titel: string;
  beginn: Date;
  dauerMinuten?: number;
  notiz?: string;
  erinnerungMinuten?: number;
  quelleId?: string;
  inKalender: boolean;
  jetzt?: Date;
}): Promise<{ termin: TerminAnsicht; kalender: string }> {
  const jetzt = input.jetzt ?? new Date();
  if (input.beginn <= jetzt) throw new Error(`Der Zeitpunkt ${wannText(input.beginn)} liegt in der Vergangenheit.`);
  let t = await prisma.termin.create({
    data: {
      organizationId: input.organizationId,
      titel: input.titel.trim(),
      beginn: input.beginn,
      dauerMinuten: input.dauerMinuten ?? 30,
      notiz: input.notiz?.trim() || null,
      erinnerungMinuten: input.erinnerungMinuten ?? 15,
      quelleId: input.quelleId ?? null,
    },
  });
  await planeErinnerung(t, jetzt);
  let kalenderStand = "nicht eingetragen (nicht gewünscht)";
  if (input.inKalender) {
    const r = await kalender().eintragen(eintragAus(t));
    if (r.ok) {
      t = await prisma.termin.update({ where: { id: t.id }, data: { kalenderName: r.kalender, kalenderUid: r.uid } });
      kalenderStand = `eingetragen im Kalender „${r.kalender}“`;
    } else {
      kalenderStand = `nicht im Kalender: ${r.grund}`;
    }
  }
  return { termin: ansicht(t), kalender: kalenderStand };
}

export async function termineAnzeigen(input: { organizationId: string; von: Date; bis: Date; auchErledigte?: boolean }): Promise<TerminAnsicht[]> {
  const rows = await prisma.termin.findMany({
    where: {
      organizationId: input.organizationId,
      beginn: { gte: input.von, lt: input.bis },
      ...(input.auchErledigte ? {} : { status: { in: ["geplant", "erinnert"] } }),
    },
    orderBy: { beginn: "asc" },
  });
  return rows.map(ansicht);
}

export async function aendereTermin(input: {
  organizationId: string;
  id: string;
  titel?: string;
  beginn?: Date;
  dauerMinuten?: number;
  notiz?: string;
  erinnerungMinuten?: number;
  status?: "erledigt" | "abgesagt";
  inKalender?: boolean;
  jetzt?: Date;
}): Promise<{ termin: TerminAnsicht; kalender: string }> {
  const jetzt = input.jetzt ?? new Date();
  const alt = await prisma.termin.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
  if (!alt) throw new Error("Termin nicht gefunden.");
  if (input.beginn && input.beginn <= jetzt) throw new Error(`Der Zeitpunkt ${wannText(input.beginn)} liegt in der Vergangenheit.`);
  const zeitNeu = Boolean(input.beginn && input.beginn.getTime() !== alt.beginn.getTime());
  let t = await prisma.termin.update({
    where: { id: alt.id },
    data: {
      ...(input.titel?.trim() ? { titel: input.titel.trim() } : {}),
      ...(input.beginn ? { beginn: input.beginn } : {}),
      ...(input.dauerMinuten ? { dauerMinuten: input.dauerMinuten } : {}),
      ...(input.notiz !== undefined ? { notiz: input.notiz.trim() || null } : {}),
      ...(input.erinnerungMinuten !== undefined ? { erinnerungMinuten: input.erinnerungMinuten } : {}),
      // Neue Zeit heißt: wieder offen, wieder erinnern.
      status: input.status ?? (zeitNeu ? "geplant" : alt.status),
    },
  });
  await streicheErinnerungen(t);
  await planeErinnerung(t, jetzt);

  let kalenderStand = t.kalenderUid ? `steht im Kalender „${t.kalenderName}“` : "nicht im Kalender";
  const ort = t.kalenderUid && t.kalenderName ? { kalender: t.kalenderName, uid: t.kalenderUid } : null;
  if (ort && t.status === "abgesagt") {
    const r = await kalender().entfernen(ort);
    if (r.ok) {
      t = await prisma.termin.update({ where: { id: t.id }, data: { kalenderName: null, kalenderUid: null } });
      kalenderStand = "aus dem Kalender entfernt";
    } else kalenderStand = `im Kalender nicht entfernt: ${r.grund}`;
  } else if (ort && t.status !== "erledigt") {
    const r = await kalender().aendern(ort, eintragAus(t));
    kalenderStand = r.ok ? `im Kalender „${r.kalender}“ angepasst` : `im Kalender nicht angepasst: ${r.grund}`;
  } else if (!ort && input.inKalender && t.status === "geplant") {
    const r = await kalender().eintragen(eintragAus(t));
    if (r.ok) {
      t = await prisma.termin.update({ where: { id: t.id }, data: { kalenderName: r.kalender, kalenderUid: r.uid } });
      kalenderStand = `eingetragen im Kalender „${r.kalender}“`;
    } else kalenderStand = `nicht im Kalender: ${r.grund}`;
  }
  return { termin: ansicht(t), kalender: kalenderStand };
}

/** Worker „termin.erinnerung“: meldet sich einmal, wenn der Termin noch so steht wie beim Planen. */
export async function erinnere(input: { organizationId: string; terminId: string; beginn: string; jetzt?: Date }): Promise<string> {
  const t = await prisma.termin.findFirst({ where: { id: input.terminId, organizationId: input.organizationId } });
  if (!t) return "Termin gibt es nicht mehr";
  if (t.status !== "geplant") return `Termin ist ${t.status}`;
  if (t.beginn.toISOString() !== input.beginn) return "Termin wurde verschoben";
  const jetzt = input.jetzt ?? new Date();
  const minuten = Math.round((t.beginn.getTime() - jetzt.getTime()) / 60_000);
  const uhr = `${t.beginn.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
  // Lief der Worker zu spät (Mac im Ruhezustand), wird das ehrlich gesagt.
  const wann =
    minuten < -5 ? `Verpasst, war ${wannText(t.beginn)}` : minuten <= 0 ? "Jetzt" : minuten < 60 ? `In ${minuten} ${minuten === 1 ? "Minute" : "Minuten"}` : `Um ${uhr}`;
  await meldeNutzer({
    organizationId: t.organizationId,
    anlass: `termin:${t.id}:${t.beginn.getTime()}`,
    // Gesprochen nur Zeit und Titel; die Notiz bleibt im Verlauf für „Worum ging es?“.
    text: `${wann}: ${t.titel.replace(/[.\s]+$/, "")}.`,
    werkzeugNotiz: `termin_id ${t.id}${t.notiz ? `, Notiz: ${t.notiz}` : ""}`,
  });
  await prisma.termin.update({ where: { id: t.id }, data: { status: "erinnert" } });
  return "erinnert";
}
