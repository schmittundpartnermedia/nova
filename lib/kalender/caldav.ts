import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDAVClient } from "tsdav";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import type { KalenderEintrag, KalenderErgebnis, KalenderOrt, KalenderZiel } from "@/lib/kalender";

/**
 * Kalender über CalDAV (iCloud, Google, IONOS …) – läuft auf dem Server ohne Mac.
 * Einstellung `~/Nova/kalender.json`: {"server": "https://caldav.icloud.com", "benutzer": "<Apple-ID>", "kalender": "<Name>"}
 * (ohne "kalender": der erste Kalender, der Termine kann). Passwort (bei iCloud ein App-Passwort) in
 * `~/Nova/geheim/kalender`, eingetragen von Joachim (scripts/server/nova.sh kalender-passwort).
 */

type Einstellung = { server: string; benutzer: string; kalender?: string };
type DavKalender = { url: string; displayName?: unknown; components?: string[] };
export type DavClient = {
  fetchCalendars(): Promise<DavKalender[]>;
  createCalendarObject(p: { calendar: DavKalender; iCalString: string; filename: string }): Promise<Response>;
  updateCalendarObject(p: { calendarObject: { url: string; data: string } }): Promise<Response>;
  deleteCalendarObject(p: { calendarObject: { url: string } }): Promise<Response>;
};

export function kalenderEinstellung(): Einstellung | null {
  try {
    const e = JSON.parse(fs.readFileSync(path.join(novaHomeDir(), "kalender.json"), "utf8")) as Partial<Einstellung>;
    if (!e.server || !e.benutzer) return null;
    return { server: e.server, benutzer: e.benutzer, kalender: e.kalender?.trim() || undefined };
  } catch {
    return null;
  }
}

function kalenderPasswort(): string | null {
  try {
    return fs.readFileSync(path.join(novaHomeDir(), "geheim", "kalender"), "utf8").replace(/\r?\n$/, "") || null;
  } catch {
    return null;
  }
}

/** Text für iCalendar: Backslash, Semikolon, Komma, Zeilenumbruch maskiert. */
function ical(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen über 75 Bytes werden nach RFC 5545 umbrochen (Fortsetzung mit Leerzeichen). */
function falte(zeile: string): string {
  const teile: string[] = [];
  let rest = zeile;
  let grenze = 75;
  while (Buffer.byteLength(rest, "utf8") > grenze) {
    let n = grenze;
    while (Buffer.byteLength(rest.slice(0, n), "utf8") > grenze) n -= 1;
    teile.push(rest.slice(0, n));
    rest = rest.slice(n);
    grenze = 74;
  }
  teile.push(rest);
  return teile.join("\r\n ");
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function ics(uid: string, e: KalenderEintrag, jetzt = new Date()): string {
  const ende = new Date(e.beginn.getTime() + e.dauerMinuten * 60_000);
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NOVA//Termine//DE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${utc(jetzt)}`,
    `DTSTART:${utc(e.beginn)}`,
    `DTEND:${utc(ende)}`,
    `SUMMARY:${ical(e.titel)}`,
    ...(e.notiz ? [`DESCRIPTION:${ical(e.notiz)}`] : []),
    ...(e.erinnerungMinuten > 0
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${ical(e.titel)}`, `TRIGGER:-PT${Math.round(e.erinnerungMinuten)}M`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${zeilen.map(falte).join("\r\n")}\r\n`;
}

function name(k: DavKalender): string {
  return typeof k.displayName === "string" ? k.displayName : "";
}

export type DavClientFabrik = (e: Einstellung, passwort: string) => Promise<DavClient>;

const echterClient: DavClientFabrik = async (e, passwort) =>
  (await createDAVClient({
    serverUrl: e.server,
    credentials: { username: e.benutzer, password: passwort },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  })) as unknown as DavClient;

export function baueCaldavKalender(fabrik: DavClientFabrik = echterClient): KalenderZiel {
  async function verbinden(): Promise<{ client: DavClient; e: Einstellung } | { fehler: string }> {
    const e = kalenderEinstellung();
    if (!e) return { fehler: "Kein Kalender eingerichtet (~/Nova/kalender.json mit server und benutzer)." };
    const pw = kalenderPasswort();
    if (!pw) return { fehler: "Für den Kalender fehlt das Passwort (Joachim trägt es mit „nova.sh kalender-passwort“ ein)." };
    try {
      return { client: await fabrik(e, pw), e };
    } catch (error) {
      return { fehler: `Kalender nicht erreichbar: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const uidAus = (url: string) => decodeURIComponent(url.split("/").pop() ?? "").replace(/\.ics$/, "");

  return {
    async eintragen(eintrag): Promise<KalenderErgebnis> {
      const v = await verbinden();
      if ("fehler" in v) return { ok: false, grund: v.fehler };
      const alle = await v.client.fetchCalendars();
      const kalender = v.e.kalender
        ? alle.find((k) => name(k) === v.e.kalender)
        : alle.find((k) => !k.components || k.components.includes("VEVENT"));
      if (!kalender) return { ok: false, grund: v.e.kalender ? `Kalender „${v.e.kalender}“ nicht gefunden.` : "Kein Kalender für Termine gefunden." };
      const uid = `${randomUUID()}@nova`;
      const datei = `${encodeURIComponent(uid)}.ics`;
      const antwort = await v.client.createCalendarObject({ calendar: kalender, iCalString: ics(uid, eintrag), filename: datei });
      if (!antwort.ok) return { ok: false, grund: `Kalender hat den Eintrag abgelehnt (${antwort.status}).` };
      return { ok: true, kalender: name(kalender) || "Kalender", uid: new URL(datei, kalender.url.endsWith("/") ? kalender.url : `${kalender.url}/`).toString() };
    },
    async aendern(ort: KalenderOrt, eintrag): Promise<KalenderErgebnis> {
      const v = await verbinden();
      if ("fehler" in v) return { ok: false, grund: v.fehler };
      const antwort = await v.client.updateCalendarObject({ calendarObject: { url: ort.uid, data: ics(uidAus(ort.uid), eintrag) } });
      if (!antwort.ok) return { ok: false, grund: `Kalender hat die Änderung abgelehnt (${antwort.status}).` };
      return { ok: true, ...ort };
    },
    async entfernen(ort: KalenderOrt) {
      const v = await verbinden();
      if ("fehler" in v) return { ok: false as const, grund: v.fehler };
      const antwort = await v.client.deleteCalendarObject({ calendarObject: { url: ort.uid } });
      // Schon weg (404) ist auch erledigt.
      if (!antwort.ok && antwort.status !== 404) return { ok: false as const, grund: `Kalender hat das Löschen abgelehnt (${antwort.status}).` };
      return { ok: true as const };
    },
  };
}

export const caldavKalender = baueCaldavKalender();
