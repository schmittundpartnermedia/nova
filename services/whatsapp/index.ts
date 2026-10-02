import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { assertOrganizationId } from "@/services/tenant";
import { createApprovalRequest, decideApproval } from "@/services/approvals";
import { enqueueWorkItem } from "@/services/worker/queue";
import { meldeNutzer } from "@/services/meldungen";
import { runHeadLoop } from "@/agents/master/head";
import type { HeadProvider } from "@/types/ai";
import type { Postfach } from "@/services/mail/postfach";
import { normTelefon, PREIS_WERBUNG_USD, whatsappDienst, ZernioFehler } from "@/lib/whatsapp/zernio";
import { findeWhatsappVorlage, fuelleWhatsapp, leseWhatsappVorlagen, metaText } from "@/lib/whatsapp/vorlagen";

/**
 * WhatsApp über Zernio (Joachims Business-Nummer, Entscheidung 03.10.2026):
 * Vorlagen (Meta prüft sie) → Kontakte mit Vornamen → Kampagne planen (sendet nichts, eine Freigabe) → nach Joachims
 * Ja in Wellen über den Hintergrund-Läufer (Tageslimit, 9–19 Uhr, Abstand) → Wache: Antworten der Angeschriebenen
 * melden und eine Antwort vorschlagen; gesendet wird nur mit Joachims Ja. „Stop“ sperrt den Kontakt.
 * Joachims eigene Chats in der App fasst NOVA nicht an: beobachtet werden nur Kontakte aus NOVA-Kampagnen.
 */

export const WACHE_INTERVALL_MS = 5 * 60_000;
/** Meta startet neue Nummern mit 250 verschiedenen Empfängern pro Tag. */
export const META_START_LIMIT = 250;
export const VERSAND_VON_STUNDE = 9;
export const VERSAND_BIS_STUNDE = 19;
const BEOBACHTUNG_TAGE = 30;
const ANTWORT_FENSTER_MS = 24 * 60 * 60 * 1000;
const STOP = /^\s*(stop+|stopp|abmelden|abbestellen|unsubscribe|bitte keine (nachrichten|werbung)|keine (nachrichten|werbung) mehr)\b/i;

/* ---------- Vornamen ---------- */

const KEIN_VORNAME = new Set(
  "gmbh mbh ug kg ag ohg gbr ek e.k. co praxis bäckerei baeckerei metzgerei schreinerei zimmerei salon studio team firma restaurant hotel autohaus friseur kanzlei büro buero service shop store café cafe bar steuerberater versicherung immobilien handwerk werkstatt stiftung verein dr dr. prof prof. herr frau mama papa oma opa schatz familie fam fam. info kontakt".split(" "),
);
const NAMENSWORT = /^[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?$/;

/** Vorname aus dem WhatsApp-Kontaktnamen. Sicher nur bei „Vorname Nachname“ ohne Firmenwort; sonst unsicher oder leer. */
export function vornameAus(name: string | null): { vorname: string | null; unsicher: boolean } {
  const woerter = (name ?? "")
    .replace(/[^\p{L}\s.-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!woerter.length) return { vorname: null, unsicher: true };
  if (woerter.some((w) => KEIN_VORNAME.has(w.toLowerCase()))) return { vorname: null, unsicher: true };
  const erstes = woerter[0]!;
  const gross = erstes
    .split("-")
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join("-");
  if (!NAMENSWORT.test(gross) || gross.length < 2 || gross.length > 20) return { vorname: null, unsicher: true };
  const sicher = woerter.length >= 2 && woerter.length <= 3 && NAMENSWORT.test(erstes) && woerter.slice(1).every((w) => NAMENSWORT.test(w));
  return { vorname: gross, unsicher: !sicher };
}

/* ---------- Kontakte ---------- */

export async function holeKontakte(organizationId: string) {
  assertOrganizationId(organizationId);
  const kontakte = await whatsappDienst().kontakte();
  let neu = 0;
  for (const k of kontakte) {
    const vorhanden = await prisma.whatsappKontakt.findUnique({ where: { organizationId_telefon: { organizationId, telefon: k.telefon } } });
    if (vorhanden) {
      // Von Joachim gesetzte Vornamen bleiben; nur der Name wird nachgeführt.
      await prisma.whatsappKontakt.update({ where: { id: vorhanden.id }, data: { name: k.name, zernioId: k.id } });
      continue;
    }
    const v = vornameAus(k.name);
    await prisma.whatsappKontakt.create({
      data: { organizationId, telefon: k.telefon, name: k.name, vorname: v.vorname, vornameUnsicher: v.unsicher, zernioId: k.id },
    });
    neu += 1;
  }
  return { ...(await kontaktUebersicht(organizationId)), neu_geholt: neu, von_zernio: kontakte.length };
}

export async function kontaktUebersicht(organizationId: string) {
  const alle = await prisma.whatsappKontakt.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  const ohne = alle.filter((k) => !k.gesperrt && !k.vorname);
  const unsicher = alle.filter((k) => !k.gesperrt && k.vorname && k.vornameUnsicher);
  return {
    gesamt: alle.length,
    mit_sicherem_vornamen: alle.filter((k) => !k.gesperrt && k.vorname && !k.vornameUnsicher).length,
    vorname_unsicher: unsicher.length,
    ohne_vornamen: ohne.length,
    gesperrt: alle.filter((k) => k.gesperrt).length,
    beispiele_unsicher: unsicher.slice(0, 15).map((k) => ({ telefon: k.telefon, name: k.name, vorschlag: k.vorname })),
    beispiele_ohne: ohne.slice(0, 15).map((k) => ({ telefon: k.telefon, name: k.name })),
  };
}

export async function kontaktSuchen(organizationId: string, suche: string) {
  const s = suche.trim().toLowerCase();
  const tel = normTelefon(suche);
  const alle = await prisma.whatsappKontakt.findMany({ where: { organizationId } });
  return alle
    .filter((k) => (tel.length >= 4 && k.telefon.includes(tel)) || (s && `${k.name ?? ""} ${k.vorname ?? ""}`.toLowerCase().includes(s)))
    .slice(0, 20)
    .map((k) => ({ telefon: k.telefon, name: k.name, vorname: k.vorname, vorname_unsicher: k.vornameUnsicher, gesperrt: k.gesperrt }));
}

export async function aendereKontakt(organizationId: string, telefonRoh: string, aenderung: { vorname?: string; sperren?: boolean; grund?: string }) {
  const telefon = normTelefon(telefonRoh);
  const k = await prisma.whatsappKontakt.findUnique({ where: { organizationId_telefon: { organizationId, telefon } } });
  if (!k) throw new Error(`Kein WhatsApp-Kontakt mit der Nummer ${telefonRoh}.`);
  const data: Record<string, unknown> = {};
  if (aenderung.vorname !== undefined) {
    const v = aenderung.vorname.trim();
    if (v && /[–—{}]/.test(v)) throw new Error("Vorname ohne Gedankenstrich und Klammern.");
    data.vorname = v || null;
    data.vornameUnsicher = false;
  }
  if (aenderung.sperren !== undefined) {
    data.gesperrt = aenderung.sperren;
    data.sperrGrund = aenderung.sperren ? aenderung.grund?.trim() || "auf Joachims Wort" : null;
  }
  const neu = await prisma.whatsappKontakt.update({ where: { id: k.id }, data });
  return { telefon: neu.telefon, name: neu.name, vorname: neu.vorname, gesperrt: neu.gesperrt };
}

async function sperreKontakt(organizationId: string, telefon: string, grund: string) {
  await prisma.whatsappKontakt.updateMany({ where: { organizationId, telefon }, data: { gesperrt: true, sperrGrund: grund } });
}

/* ---------- Vorlagen ---------- */

export async function vorlagenStand() {
  const lokal = leseWhatsappVorlagen();
  let meta: Awaited<ReturnType<ReturnType<typeof whatsappDienst>["vorlagen"]>> = [];
  let metaFehler: string | null = null;
  try {
    meta = await whatsappDienst().vorlagen();
  } catch (e) {
    metaFehler = e instanceof Error ? e.message : String(e);
  }
  return {
    vorlagen: lokal.map((v) => {
      const m = meta.find((x) => x.name === v.name && x.sprache.startsWith(v.sprache));
      return { name: v.name, datei: v.datei, kategorie: v.kategorie, meta_status: m?.status ?? (metaFehler ? "unbekannt" : "nicht eingereicht"), ablehnungsgrund: m?.ablehnungsgrund ?? null };
    }),
    nur_bei_meta: meta.filter((m) => !lokal.some((v) => v.name === m.name)).map((m) => ({ name: m.name, sprache: m.sprache, status: m.status })),
    fehler: metaFehler,
  };
}

export async function reicheVorlageEin(name: string) {
  const v = findeWhatsappVorlage(name);
  const r = await whatsappDienst().vorlageEinreichen({ name: v.name, sprache: v.sprache, kategorie: v.kategorie, text: metaText(v), beispiel: v.platzhalter.length ? ["Anna"] : [] });
  return { name: v.name, status: r.status, hinweis: "Meta prüft die Vorlage, meist in Minuten, höchstens 24 Stunden." };
}

async function metaFreigegeben(name: string, sprache: string): Promise<boolean> {
  const alle = await whatsappDienst().vorlagen();
  return alle.some((m) => m.name === name && m.sprache.startsWith(sprache) && m.status === "APPROVED");
}

/* ---------- Kampagne ---------- */

/** Versandzeiten: ab start, nur VERSAND_VON–BIS Uhr (Ortszeit), höchstens proTag je Tag, im Abstand. */
export function versandZeiten(start: Date, anzahl: number, proTag: number, abstandSekunden: number): Date[] {
  const out: Date[] = [];
  let t = new Date(start);
  let tag = "";
  let heute = 0;
  const naechsterTag = (d: Date) => {
    const n = new Date(d);
    n.setDate(n.getDate() + 1);
    n.setHours(VERSAND_VON_STUNDE, 0, 0, 0);
    return n;
  };
  while (out.length < anzahl) {
    if (t.getHours() < VERSAND_VON_STUNDE) t.setHours(VERSAND_VON_STUNDE, 0, 0, 0);
    if (t.getHours() >= VERSAND_BIS_STUNDE) {
      t = naechsterTag(t);
      continue;
    }
    const key = t.toDateString();
    if (key !== tag) {
      tag = key;
      heute = 0;
    }
    if (heute >= proTag) {
      t = naechsterTag(t);
      continue;
    }
    out.push(new Date(t));
    heute += 1;
    t = new Date(t.getTime() + abstandSekunden * 1000);
  }
  return out;
}

export async function planeWhatsappKampagne(input: {
  organizationId: string;
  vorlage: string;
  anzahl: number;
  proTag: number;
  abstandSekunden: number;
  auchUnsichere?: boolean;
}) {
  assertOrganizationId(input.organizationId);
  const v = findeWhatsappVorlage(input.vorlage);
  const anzahl = Math.round(input.anzahl);
  const proTag = Math.round(input.proTag);
  const abstand = Math.round(input.abstandSekunden);
  if (!(anzahl >= 1 && anzahl <= 5000)) throw new Error("Anzahl 1 bis 5000.");
  if (!(proTag >= 1 && proTag <= META_START_LIMIT)) throw new Error(`Pro Tag 1 bis ${META_START_LIMIT} (Meta-Grenze für neue Nummern).`);
  if (!(abstand >= 10 && abstand <= 3600)) throw new Error("Abstand 10 bis 3600 Sekunden.");
  if (!(await metaFreigegeben(v.name, v.sprache))) {
    throw new Error(`Die Vorlage „${v.name}“ ist bei Meta noch nicht freigegeben (whatsapp_status zeigt den Stand).`);
  }
  const schonAngeschrieben = new Set(
    (
      await prisma.whatsappNachricht.findMany({
        where: { organizationId: input.organizationId, richtung: "aus", art: "vorlage", status: { in: ["entwurf", "geplant", "sendet", "gesendet"] }, kampagne: { vorlage: v.name } },
        select: { telefon: true },
      })
    ).map((n) => n.telefon),
  );
  const kandidaten = await prisma.whatsappKontakt.findMany({
    where: { organizationId: input.organizationId, gesperrt: false, vorname: { not: null }, ...(input.auchUnsichere ? {} : { vornameUnsicher: false }) },
    orderBy: { createdAt: "asc" },
  });
  const auswahl = kandidaten.filter((k) => !schonAngeschrieben.has(k.telefon)).slice(0, anzahl);
  if (!auswahl.length) throw new Error("Keine passenden Kontakte (alle schon angeschrieben, gesperrt oder ohne Vornamen).");
  const kampagne = await prisma.whatsappKampagne.create({
    data: { organizationId: input.organizationId, name: `${v.name} (${auswahl.length})`, vorlage: v.name, sprache: v.sprache, proTag, abstandSekunden: abstand },
  });
  for (const k of auswahl) {
    await prisma.whatsappNachricht.create({
      data: { organizationId: input.organizationId, kampagneId: kampagne.id, telefon: k.telefon, name: k.vorname, richtung: "aus", art: "vorlage", text: fuelleWhatsapp(v, k.vorname!), status: "entwurf" },
    });
  }
  const tage = Math.ceil(auswahl.length / proTag);
  const kosten = Math.round(auswahl.length * PREIS_WERBUNG_USD * 100) / 100;
  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    actionType: "whatsapp.campaign",
    description: `WhatsApp „${v.name}“ an ${auswahl.length} Kontakte, höchstens ${proTag} pro Tag (${VERSAND_VON_STUNDE} bis ${VERSAND_BIS_STUNDE} Uhr), etwa ${tage} Tag(e), Meta-Kosten bis ${kosten} $`,
    payload: { kampagneId: kampagne.id, anzahl: auswahl.length },
  });
  await prisma.whatsappKampagne.update({ where: { id: kampagne.id }, data: { approvalId: approval.id } });
  const ohneVorname = await prisma.whatsappKontakt.count({ where: { organizationId: input.organizationId, gesperrt: false, vorname: null } });
  const unsicher = input.auchUnsichere ? 0 : await prisma.whatsappKontakt.count({ where: { organizationId: input.organizationId, gesperrt: false, vornameUnsicher: true, vorname: { not: null } } });
  return {
    kampagne_id: kampagne.id,
    freigabe_id: approval.id,
    vorlage: v.name,
    anzahl: auswahl.length,
    pro_tag: proTag,
    abstand_sekunden: abstand,
    tage,
    kosten_bis_usd: kosten,
    kosten_hinweis: `Meta berechnet ${PREIS_WERBUNG_USD} $ je zugestellter Werbe-Vorlage (Deutschland), nur zugestellte zählen.`,
    nicht_dabei: { ohne_vornamen: ohneVorname, vorname_unsicher: unsicher },
    empfaenger: auswahl.slice(0, 30).map((k) => `${k.vorname} (${k.name ?? k.telefon})`),
    beispiel: fuelleWhatsapp(v, auswahl[0]!.vorname!),
  };
}

export async function starteWhatsappKampagne(input: { organizationId: string; kampagneId: string; freigabeId: string; jetzt?: Date }) {
  assertOrganizationId(input.organizationId);
  const k = await prisma.whatsappKampagne.findFirst({ where: { id: input.kampagneId, organizationId: input.organizationId } });
  if (!k) throw new Error("WhatsApp-Kampagne nicht gefunden.");
  if (k.status !== "wartet_auf_freigabe") throw new Error(`Kampagne ist bereits ${k.status}.`);
  if (!k.approvalId || k.approvalId !== input.freigabeId) throw new Error("Diese Freigabe gehört nicht zu dieser Kampagne.");
  await decideApproval({ organizationId: input.organizationId, approvalId: k.approvalId, status: "approved" });
  const start = input.jetzt ?? new Date();
  const nachrichten = await prisma.whatsappNachricht.findMany({ where: { kampagneId: k.id, status: "entwurf" }, orderBy: { createdAt: "asc" } });
  const zeiten = versandZeiten(start, nachrichten.length, k.proTag, k.abstandSekunden);
  await prisma.whatsappKampagne.update({ where: { id: k.id }, data: { status: "laeuft", startedAt: start } });
  for (let i = 0; i < nachrichten.length; i++) {
    const n = nachrichten[i]!;
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "geplant", geplantFuer: zeiten[i] } });
    await enqueueWorkItem({ organizationId: input.organizationId, kind: "whatsapp.send", idempotencyKey: `whatsapp.send:${n.id}`, payload: { nachrichtId: n.id }, runAt: zeiten[i], maxAttempts: 1 });
  }
  await planeWhatsappWache(input.organizationId, new Date(start.getTime() + WACHE_INTERVALL_MS));
  return whatsappKampagnenStand(input.organizationId, k.id);
}

export async function whatsappKampagnenStand(organizationId: string, kampagneId: string) {
  const k = await prisma.whatsappKampagne.findFirstOrThrow({ where: { id: kampagneId, organizationId } });
  const n = await prisma.whatsappNachricht.findMany({ where: { kampagneId: k.id }, orderBy: { geplantFuer: "asc" } });
  const zaehl = (s: string) => n.filter((x) => x.status === s).length;
  const naechste = n.find((x) => x.status === "geplant");
  const telefone = new Set(n.filter((x) => x.status === "gesendet").map((x) => x.telefon));
  const antworten = telefone.size
    ? await prisma.whatsappNachricht.findMany({ where: { organizationId, richtung: "ein", telefon: { in: [...telefone] }, empfangenAt: { gte: k.startedAt ?? k.createdAt } }, select: { telefon: true }, distinct: ["telefon"] })
    : [];
  return {
    kampagne_id: k.id,
    name: k.name,
    vorlage: k.vorlage,
    status: k.status,
    gesamt: n.length,
    gesendet: zaehl("gesendet"),
    geplant: zaehl("geplant"),
    fehlgeschlagen: n.filter((x) => x.status === "fehlgeschlagen").map((x) => ({ name: x.name, telefon: x.telefon, grund: x.fehler })),
    abgebrochen: zaehl("abgebrochen"),
    geantwortet: antworten.length,
    naechste: naechste?.geplantFuer?.toISOString() ?? null,
    pro_tag: k.proTag,
  };
}

export async function whatsappKampagnen(organizationId: string) {
  const rows = await prisma.whatsappKampagne.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10 });
  return Promise.all(rows.map((r) => whatsappKampagnenStand(organizationId, r.id)));
}

export async function brecheWhatsappKampagneAb(organizationId: string, kampagneId: string) {
  const k = await prisma.whatsappKampagne.findFirst({ where: { id: kampagneId, organizationId } });
  if (!k) throw new Error("WhatsApp-Kampagne nicht gefunden.");
  if (k.status === "fertig" || k.status === "abgebrochen") throw new Error(`Kampagne ist schon ${k.status}.`);
  const offen = await prisma.whatsappNachricht.findMany({ where: { kampagneId: k.id, status: { in: ["entwurf", "geplant"] } } });
  await prisma.whatsappKampagne.update({ where: { id: k.id }, data: { status: "abgebrochen", finishedAt: new Date() } });
  await prisma.whatsappNachricht.updateMany({ where: { kampagneId: k.id, status: { in: ["entwurf", "geplant"] } }, data: { status: "abgebrochen" } });
  await prisma.workItem.updateMany({
    where: { organizationId, kind: "whatsapp.send", status: "queued", idempotencyKey: { in: offen.map((x) => `whatsapp.send:${x.id}`) } },
    data: { status: "cancelled", lockedBy: null, lockedUntil: null },
  });
  if (k.approvalId && k.status === "wartet_auf_freigabe") await decideApproval({ organizationId, approvalId: k.approvalId, status: "rejected" });
  return whatsappKampagnenStand(organizationId, k.id);
}

/** Worker „whatsapp.send“: eine Kampagnen-Nachricht, nur bei laufender Kampagne mit erteilter Freigabe. */
export async function sendeKampagnenNachricht(organizationId: string, nachrichtId: string): Promise<string> {
  const n = await prisma.whatsappNachricht.findFirst({ where: { id: nachrichtId, organizationId }, include: { kampagne: true } });
  if (!n || n.status !== "geplant") return "nicht mehr geplant";
  const k = n.kampagne;
  const freigabe = k?.approvalId ? await prisma.approvalRequest.findFirst({ where: { id: k.approvalId, organizationId } }) : null;
  if (!k || k.status !== "laeuft" || freigabe?.status !== "approved") {
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "abgebrochen", fehler: "Kampagne läuft nicht oder ohne Freigabe" } });
    return "ohne laufende, freigegebene Kampagne nicht gesendet";
  }
  const kontakt = await prisma.whatsappKontakt.findUnique({ where: { organizationId_telefon: { organizationId, telefon: n.telefon } } });
  if (!kontakt || kontakt.gesperrt) {
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "abgebrochen", fehler: "Kontakt gesperrt" } });
    await schliesseWennFertig(organizationId, k.id);
    return "Kontakt gesperrt";
  }
  // Vor dem Aufruf markieren: Ein Absturz mittendrin führt nicht zu einem zweiten Versand.
  await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "sendet" } });
  try {
    const r = await whatsappDienst().sendeVorlage({ telefon: n.telefon, vorlage: k.vorlage, sprache: k.sprache, werte: [n.name ?? ""] });
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "gesendet", zernioId: r.nachrichtId, gespraechId: r.gespraechId || null, gesendetAt: new Date() } });
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e);
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "fehlgeschlagen", fehler: grund.slice(0, 300) } });
    if (e instanceof ZernioFehler && e.code === "recipient_opted_out") await sperreKontakt(organizationId, n.telefon, "hat WhatsApp-Nachrichten abbestellt");
  }
  await schliesseWennFertig(organizationId, k.id);
  return "erledigt";
}

async function schliesseWennFertig(organizationId: string, kampagneId: string) {
  const offen = await prisma.whatsappNachricht.count({ where: { kampagneId, status: { in: ["entwurf", "geplant", "sendet"] } } });
  if (offen > 0) return;
  const beendet = await prisma.whatsappKampagne.updateMany({ where: { id: kampagneId, status: "laeuft" }, data: { status: "fertig", finishedAt: new Date() } });
  if (beendet.count !== 1) return;
  const s = await whatsappKampagnenStand(organizationId, kampagneId);
  const teile = [`WhatsApp „${s.vorlage}“ ist durch: ${s.gesendet} von ${s.gesamt} Nachrichten sind raus.`];
  if (s.fehlgeschlagen.length) teile.push(`${s.fehlgeschlagen.length} gingen nicht raus (${s.fehlgeschlagen.slice(0, 5).map((x) => x.name ?? x.telefon).join(", ")}).`);
  if (s.geantwortet) teile.push(`${s.geantwortet} haben schon geantwortet.`);
  await meldeNutzer({ organizationId, anlass: `whatsapp-fertig:${kampagneId}`, text: teile.join(" ") });
}

/* ---------- Antworten ---------- */

export async function planeWhatsappWache(organizationId: string, runAt: Date) {
  const slot = Math.floor(runAt.getTime() / WACHE_INTERVALL_MS);
  return enqueueWorkItem({ organizationId, kind: "whatsapp.wache", idempotencyKey: `whatsapp.wache:${slot}`, payload: {}, runAt, maxAttempts: 1 });
}

function standDatei(): string {
  return path.join(novaHomeDir(), "zustand", "whatsapp-wache.json");
}

function letzterLauf(organizationId: string): Date | null {
  try {
    const d = (JSON.parse(fs.readFileSync(standDatei(), "utf8")) as Record<string, string>)[organizationId];
    return d ? new Date(d) : null;
  } catch {
    return null;
  }
}

function merkeLauf(organizationId: string, zeit: Date) {
  let stand: Record<string, string> = {};
  try {
    stand = JSON.parse(fs.readFileSync(standDatei(), "utf8")) as Record<string, string>;
  } catch {
    stand = {};
  }
  stand[organizationId] = zeit.toISOString();
  fs.mkdirSync(path.dirname(standDatei()), { recursive: true });
  fs.writeFileSync(standDatei(), JSON.stringify(stand, null, 2));
}

/**
 * Wache „whatsapp.wache“ (alle 5 Min., solange es Kampagnen-Nachrichten der letzten 30 Tage gibt): neue Nachrichten
 * von Angeschriebenen festhalten. „Stop“ → gesperrt. Hat Joachim (oder NOVA) danach schon geantwortet → nichts.
 * Sonst schlägt der Kopf eine Antwort vor (Entwurf + Freigabe) und meldet sich. Gesendet wird nie von hier.
 */
export async function whatsappWache(input: { organizationId: string; kopf: { provider: HeadProvider; model: string }; postfach: Postfach; jetzt?: Date }): Promise<{ neu: number; weiter: boolean }> {
  const jetzt = input.jetzt ?? new Date();
  const seit = new Date(jetzt.getTime() - BEOBACHTUNG_TAGE * 24 * 3600 * 1000);
  const gesendet = await prisma.whatsappNachricht.findMany({
    where: { organizationId: input.organizationId, richtung: "aus", art: "vorlage", status: "gesendet", gesendetAt: { gte: seit } },
  });
  if (!gesendet.length) return { neu: 0, weiter: false };
  const ersteNachricht = new Map<string, Date>();
  for (const n of gesendet) {
    const t = n.gesendetAt!;
    if (!ersteNachricht.has(n.telefon) || t < ersteNachricht.get(n.telefon)!) ersteNachricht.set(n.telefon, t);
  }
  const ab = new Date((letzterLauf(input.organizationId) ?? seit).getTime() - 10 * 60_000);
  const dienst = whatsappDienst();
  const gespraeche = (await dienst.gespraeche(100)).filter((g) => ersteNachricht.has(g.telefon) && new Date(g.aktualisiert) >= ab);
  let neu = 0;
  for (const g of gespraeche) {
    const verlauf = (await dienst.nachrichten(g.id, 30)).sort((a, b) => a.zeit.localeCompare(b.zeit));
    const erste = ersteNachricht.get(g.telefon)!;
    const eingehend = verlauf.filter((m) => m.richtung === "ein" && new Date(m.zeit) > erste);
    const neueHier: typeof eingehend = [];
    for (const m of eingehend) {
      const bekannt = await prisma.whatsappNachricht.findUnique({ where: { organizationId_zernioId: { organizationId: input.organizationId, zernioId: m.id } } });
      if (bekannt) continue;
      await prisma.whatsappNachricht.create({
        data: { organizationId: input.organizationId, telefon: g.telefon, name: g.name, richtung: "ein", art: "text", text: m.text, status: "empfangen", zernioId: m.id, gespraechId: g.id, empfangenAt: new Date(m.zeit) },
      });
      neueHier.push(m);
    }
    if (!neueHier.length) continue;
    neu += 1;
    const letzte = neueHier[neueHier.length - 1]!;
    const kontakt = await prisma.whatsappKontakt.findUnique({ where: { organizationId_telefon: { organizationId: input.organizationId, telefon: g.telefon } } });
    const wer = kontakt?.vorname ? `${kontakt.vorname}${kontakt.name && kontakt.name !== kontakt.vorname ? ` (${kontakt.name})` : ""}` : g.name || g.telefon;
    if (neueHier.some((m) => STOP.test(m.text))) {
      await sperreKontakt(input.organizationId, g.telefon, "hat per WhatsApp „Stop“ geschrieben");
      await meldeNutzer({ organizationId: input.organizationId, anlass: `whatsapp-stop:${letzte.id}`, text: `${wer} möchte keine WhatsApp-Nachrichten mehr. Ich habe die Nummer gesperrt.` });
      continue;
    }
    const spaeterBeantwortet = verlauf.some((m) => m.richtung === "aus" && m.zeit > letzte.zeit);
    if (spaeterBeantwortet) continue;
    const kopf = await runHeadLoop({
      provider: input.kopf.provider,
      model: input.kopf.model,
      history: [],
      userRequest: [
        `[WhatsApp-Wache] ${wer} (Telefon ${g.telefon}) hat auf Joachims WhatsApp geantwortet.`,
        "Verlauf (älteste zuerst):",
        ...verlauf.slice(-12).map((m) => `${m.richtung === "ein" ? wer : "Joachim"}: ${m.text.replace(/\s+/g, " ").slice(0, 600)}`),
        "",
        "Schlag eine kurze, persönliche Antwort in Joachims Ton vor (duzen, herzlich, keine Gedankenstriche, kein Werbeton): " +
          `whatsapp_antwort_entwurf mit telefon ${g.telefon}. Nicht senden. ` +
          `Sag Joachim dann in zwei, drei gesprochenen Sätzen, was ${wer} geschrieben hat und was du kurz vorschlägst, und frag, ob du so senden sollst. ` +
          "Fragt die Person nach rankPilot oder einem Termin, nimm das in den Vorschlag auf. Den Entwurf nicht wörtlich vorlesen.",
      ].join("\n"),
      context: { organizationId: input.organizationId, postfach: input.postfach },
    });
    await meldeNutzer({ organizationId: input.organizationId, anlass: `whatsapp-antwort:${letzte.id}`, text: kopf.reply, werkzeugNotiz: kopf.werkzeugNotiz });
  }
  merkeLauf(input.organizationId, jetzt);
  return { neu, weiter: true };
}

export async function whatsappVerlauf(organizationId: string, telefonRoh: string) {
  const telefon = normTelefon(telefonRoh);
  const rows = await prisma.whatsappNachricht.findMany({ where: { organizationId, telefon }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.reverse().map((r) => ({ id: r.id, richtung: r.richtung, status: r.status, text: r.text, zeit: (r.empfangenAt ?? r.gesendetAt ?? r.createdAt).toISOString() }));
}

export async function offeneAntworten(organizationId: string) {
  const ein = await prisma.whatsappNachricht.findMany({ where: { organizationId, richtung: "ein" }, orderBy: { empfangenAt: "desc" }, take: 100 });
  const proTelefon = new Map<string, (typeof ein)[number]>();
  for (const e of ein) if (!proTelefon.has(e.telefon)) proTelefon.set(e.telefon, e);
  const out = [];
  for (const e of proTelefon.values()) {
    const danach = await prisma.whatsappNachricht.count({ where: { organizationId, telefon: e.telefon, richtung: "aus", status: "gesendet", gesendetAt: { gt: e.empfangenAt ?? e.createdAt } } });
    if (danach) continue;
    const entwurf = await prisma.whatsappNachricht.findFirst({ where: { organizationId, telefon: e.telefon, richtung: "aus", art: "text", status: "entwurf" } });
    out.push({ telefon: e.telefon, name: e.name, nachricht: e.text.slice(0, 300), empfangen: (e.empfangenAt ?? e.createdAt).toISOString(), entwurf_id: entwurf?.id ?? null });
  }
  return out;
}

export async function antwortEntwurf(organizationId: string, telefonRoh: string, text: string) {
  const telefon = normTelefon(telefonRoh);
  const t = text.trim();
  if (!t) throw new Error("Text fehlt.");
  if (/[–—]/.test(t)) throw new Error("Keine Gedankenstriche in Nachrichten (Joachims Regel).");
  const letzteEin = await prisma.whatsappNachricht.findFirst({ where: { organizationId, telefon, richtung: "ein" }, orderBy: { empfangenAt: "desc" } });
  if (!letzteEin?.gespraechId) throw new Error("Von dieser Nummer gibt es keine eingegangene Nachricht – frei schreiben geht nur als Antwort.");
  await prisma.whatsappNachricht.updateMany({ where: { organizationId, telefon, richtung: "aus", art: "text", status: "entwurf" }, data: { status: "ersetzt" } });
  const entwurf = await prisma.whatsappNachricht.create({
    data: { organizationId, telefon, name: letzteEin.name, richtung: "aus", art: "text", text: t, status: "entwurf", gespraechId: letzteEin.gespraechId },
  });
  const approval = await createApprovalRequest({ organizationId, actionType: "whatsapp.reply", description: `WhatsApp-Antwort an ${letzteEin.name ?? telefon}`, payload: { nachrichtId: entwurf.id } });
  await prisma.whatsappNachricht.update({ where: { id: entwurf.id }, data: { approvalId: approval.id } });
  return { entwurf_id: entwurf.id, freigabe_id: approval.id, an: letzteEin.name ?? telefon, text: t };
}

/** Sendet einen Antwort-Entwurf – nur mit seiner Freigabe (Joachims Ja) und im 24-Stunden-Fenster von WhatsApp. */
export async function sendeAntwort(organizationId: string, entwurfId: string, freigabeId: string, jetzt = new Date()) {
  const e = await prisma.whatsappNachricht.findFirst({ where: { id: entwurfId, organizationId } });
  if (!e || e.richtung !== "aus" || e.art !== "text") throw new Error("Antwort-Entwurf nicht gefunden.");
  if (e.status !== "entwurf") throw new Error(`Entwurf ist ${e.status}.`);
  if (!e.approvalId || e.approvalId !== freigabeId) throw new Error("Diese Freigabe gehört nicht zu diesem Entwurf.");
  const letzteEin = await prisma.whatsappNachricht.findFirst({ where: { organizationId, telefon: e.telefon, richtung: "ein" }, orderBy: { empfangenAt: "desc" } });
  if (!letzteEin?.empfangenAt || jetzt.getTime() - letzteEin.empfangenAt.getTime() > ANTWORT_FENSTER_MS) {
    throw new Error("Die letzte Nachricht dieser Person ist älter als 24 Stunden – WhatsApp erlaubt dann nur eine freigegebene Vorlage.");
  }
  const kontakt = await prisma.whatsappKontakt.findUnique({ where: { organizationId_telefon: { organizationId, telefon: e.telefon } } });
  if (kontakt?.gesperrt) throw new Error("Der Kontakt ist gesperrt.");
  await decideApproval({ organizationId, approvalId: freigabeId, status: "approved" });
  await prisma.whatsappNachricht.update({ where: { id: e.id }, data: { status: "sendet" } });
  try {
    const r = await whatsappDienst().sendeText({ gespraechId: e.gespraechId ?? letzteEin.gespraechId!, text: e.text });
    await prisma.whatsappNachricht.update({ where: { id: e.id }, data: { status: "gesendet", zernioId: r.nachrichtId, gesendetAt: new Date() } });
    return { gesendet: true, an: e.name ?? e.telefon };
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    await prisma.whatsappNachricht.update({ where: { id: e.id }, data: { status: "fehlgeschlagen", fehler: grund.slice(0, 300) } });
    throw new Error(`Nicht gesendet: ${grund}`);
  }
}

export async function whatsappStatus(organizationId: string) {
  let konto: unknown = null;
  let fehler: string | null = null;
  try {
    konto = await whatsappDienst().konto();
  } catch (e) {
    fehler = e instanceof Error ? e.message : String(e);
  }
  return {
    verbunden: !fehler,
    konto,
    fehler,
    vorlagen: fehler ? leseWhatsappVorlagen().map((v) => ({ name: v.name, meta_status: "unbekannt" })) : (await vorlagenStand()).vorlagen,
    kontakte: await kontaktUebersicht(organizationId),
    kampagnen: await whatsappKampagnen(organizationId),
    offene_antworten: (await offeneAntworten(organizationId)).length,
  };
}
