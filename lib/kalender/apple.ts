import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { ensureNativeHelper, invokeNativeHelper } from "@/lib/native/helper";

/**
 * Apple Kalender über den NOVA-Helfer (Apple Events, wie bei Apple Mail). Beim ersten Mal fragt macOS,
 * ob NOVA den Kalender steuern darf. Welcher Kalender: `~/Nova/kalender.json` ({"kalender": "Arbeit"});
 * ohne Angabe der erste beschreibbare Kalender.
 */

export type KalenderEintrag = { titel: string; beginn: Date; dauerMinuten: number; notiz?: string; erinnerungMinuten: number };
export type KalenderErgebnis = { ok: true; kalender: string; uid: string } | { ok: false; grund: string };
export type KalenderZiel = {
  eintragen(eintrag: KalenderEintrag): Promise<KalenderErgebnis>;
  /** Vorhandenen Eintrag (aus eintragen) auf neue Zeit/Titel setzen. */
  aendern(ort: { kalender: string; uid: string }, eintrag: KalenderEintrag): Promise<KalenderErgebnis>;
  /** Eintrag aus dem Kalender nehmen (abgesagter Termin). */
  entfernen(ort: { kalender: string; uid: string }): Promise<{ ok: true } | { ok: false; grund: string }>;
};

function zitiert(wert: string): string {
  return `"${wert.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

/** AppleScript-Datum aus Bestandteilen (unabhängig von der Datumsschreibweise des Systems). */
function datumZeilen(name: string, d: Date): string {
  const sekunden = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  return [
    `set ${name} to current date`,
    `set day of ${name} to 1`,
    `set year of ${name} to ${d.getFullYear()}`,
    `set month of ${name} to ${d.getMonth() + 1}`,
    `set day of ${name} to ${d.getDate()}`,
    `set time of ${name} to ${sekunden}`,
  ].join("\n  ");
}

export function eintragScript(eintrag: KalenderEintrag, kalenderName: string | null): string {
  const ende = new Date(eintrag.beginn.getTime() + eintrag.dauerMinuten * 60_000);
  const wahl = kalenderName
    ? `set ziel to first calendar whose name is ${zitiert(kalenderName)}`
    : `set ziel to missing value
  repeat with k in calendars
    if writable of k is true then
      set ziel to k
      exit repeat
    end if
  end repeat
  if ziel is missing value then error "Kein beschreibbarer Kalender"`;
  return `tell application "Calendar"
  ${wahl}
  ${datumZeilen("beginnDatum", eintrag.beginn)}
  ${datumZeilen("endeDatum", ende)}
  set ev to make new event at end of events of ziel with properties {summary:${zitiert(eintrag.titel)}, start date:beginnDatum, end date:endeDatum, description:${zitiert(eintrag.notiz ?? "")}}
  ${eintrag.erinnerungMinuten > 0 ? `tell ev to make new display alarm at end of display alarms with properties {trigger interval:${-Math.round(eintrag.erinnerungMinuten)}}` : ""}
  return (name of ziel) & character id 31 & (uid of ev)
end tell`;
}

function findeEreignis(ort: { kalender: string; uid: string }): string {
  return `set ziel to first calendar whose name is ${zitiert(ort.kalender)}
  set treffer to (every event of ziel whose uid is ${zitiert(ort.uid)})
  if (count of treffer) is 0 then error "Eintrag nicht mehr im Kalender"
  set ev to item 1 of treffer`;
}

export function aenderScript(ort: { kalender: string; uid: string }, eintrag: KalenderEintrag): string {
  const ende = new Date(eintrag.beginn.getTime() + eintrag.dauerMinuten * 60_000);
  return `tell application "Calendar"
  ${findeEreignis(ort)}
  ${datumZeilen("beginnDatum", eintrag.beginn)}
  ${datumZeilen("endeDatum", ende)}
  set summary of ev to ${zitiert(eintrag.titel)}
  set start date of ev to beginnDatum
  set end date of ev to endeDatum
  set description of ev to ${zitiert(eintrag.notiz ?? "")}
  return (name of ziel) & character id 31 & (uid of ev)
end tell`;
}

export function entfernScript(ort: { kalender: string; uid: string }): string {
  return `tell application "Calendar"
  ${findeEreignis(ort)}
  delete ev
  return "ok"
end tell`;
}

/** Nur Kalender-Befehle: kein „do shell script“, keine anderen Programme. */
export function kalenderScriptSicher(script: string): boolean {
  if (/do shell script|run script|load script|system events|tell application (?!"Calendar")/i.test(script)) return false;
  return /^tell application "Calendar"/.test(script.trim());
}

export function kalenderEinstellung(): string | null {
  try {
    const name = (JSON.parse(fs.readFileSync(path.join(novaHomeDir(), "kalender.json"), "utf8")) as { kalender?: string }).kalender;
    return name?.trim() || null;
  } catch {
    return null;
  }
}

async function fuehreAus(script: string): Promise<{ ok: true; ausgabe: string } | { ok: false; grund: string }> {
  if (process.platform !== "darwin") return { ok: false, grund: "Apple Kalender gibt es nur auf dem Mac." };
  if (!kalenderScriptSicher(script)) return { ok: false, grund: "Kalender-Skript abgelehnt." };
  const helper = await ensureNativeHelper();
  if (!helper.ok) return { ok: false, grund: helper.reason };
  const result = await invokeNativeHelper({ cmd: "applescript.run", script }, 30_000);
  if (result.permission === "automation" || result.error === "PERMISSION_REQUIRED") {
    return { ok: false, grund: "NOVA darf den Kalender noch nicht steuern. Bitte die macOS-Abfrage erlauben (Systemeinstellungen → Datenschutz → Automation)." };
  }
  if (!result.ok) return { ok: false, grund: typeof result.error === "string" && result.error ? result.error : "Kalender hat nicht geantwortet." };
  return { ok: true, ausgabe: String(result.data?.output ?? "") };
}

function ortAus(ausgabe: string): KalenderErgebnis {
  const [kalenderName, uid] = ausgabe.split(String.fromCharCode(31));
  if (!uid) return { ok: false, grund: `Unerwartete Antwort vom Kalender: ${ausgabe.slice(0, 80)}` };
  return { ok: true, kalender: kalenderName!.trim(), uid: uid.trim() };
}

export const appleKalender: KalenderZiel = {
  async eintragen(eintrag) {
    const r = await fuehreAus(eintragScript(eintrag, kalenderEinstellung()));
    return r.ok ? ortAus(r.ausgabe) : r;
  },
  async aendern(ort, eintrag) {
    const r = await fuehreAus(aenderScript(ort, eintrag));
    return r.ok ? ortAus(r.ausgabe) : r;
  },
  async entfernen(ort) {
    const r = await fuehreAus(entfernScript(ort));
    return r.ok ? { ok: true } : r;
  },
};

const globalRef = globalThis as unknown as { __novaKalender?: KalenderZiel };

export function kalender(): KalenderZiel {
  return globalRef.__novaKalender ?? appleKalender;
}

/** Tests setzen ein Kalender-Ziel im Speicher; nie Joachims echter Kalender. */
export function setzeKalender(ziel: KalenderZiel | null): void {
  globalRef.__novaKalender = ziel ?? undefined;
}
