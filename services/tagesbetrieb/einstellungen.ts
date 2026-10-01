import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Einstellungen des Kunden-Tagesbetriebs: `~/Nova/tagesbetrieb.json` (von Joachim änderbar).
 * Zeiten sind deutsche Zeit (TZ=Europe/Berlin); wochentage 1 = Montag … 7 = Sonntag.
 */
export type TagesbetriebEinstellungen = {
  aktiv: boolean;
  /** Organisation, für die der Tagesbetrieb eingeschaltet wurde. */
  organizationId?: string;
  vorlage: string;
  absender: string;
  maxProTag: number;
  abstandMinuten: number;
  start: string;
  ende: string;
  wochentage: number[];
  /** Unter so vielen geprüften Adressen startet NOVA den nächsten Scanner-Tageslauf. */
  vorratMindestens: number;
  /** Nachfass-Mail nach so vielen Tagen ohne Antwort (0 = aus; braucht die Vorlage „<vorlage>-nachfass“). */
  nachfassTage: number;
  /** Höchstens so viele Nachfass-Mails am Tag (über alle Kampagnen). */
  nachfassMaxProTag: number;
  /** Suchgebiet: alle Betriebe im Umkreis um diesen Ort (Gebietssuche des Lead-Scanners). */
  suchgebiet: { mitte: string; radiusKm: number };
  /** Branchen in dieser Reihenfolge; eine Branche wird im ganzen Gebiet gesucht, dann kommt die nächste. */
  branchen: string[];
};

export const STANDARD: TagesbetriebEinstellungen = {
  aktiv: false,
  vorlage: "kunden",
  absender: "joachim@rankpilot.de",
  maxProTag: 50,
  abstandMinuten: 5,
  start: "08:00",
  ende: "17:00",
  wochentage: [1, 2, 3, 4, 5],
  vorratMindestens: 5,
  nachfassTage: 6,
  nachfassMaxProTag: 30,
  suchgebiet: { mitte: "Pforzheim", radiusKm: 40 },
  branchen: [
    "Schreinerei", "Zahnarztpraxis", "Physiotherapie", "Rechtsanwalt", "Steuerberater", "Autowerkstatt", "Restaurant",
    "Friseursalon", "Kosmetikstudio", "Fitnessstudio", "Immobilienmakler", "Elektriker", "Sanitär Heizung", "Dachdecker",
    "Maler und Lackierer", "Garten- und Landschaftsbau", "Fahrschule", "Tierarzt", "Hörgeräteakustiker", "Bestattungsunternehmen",
  ],
};

export function einstellungenDatei(): string {
  return path.join(novaHomeDir(), "tagesbetrieb.json");
}

export function leseEinstellungen(): TagesbetriebEinstellungen {
  const file = einstellungenDatei();
  if (!fs.existsSync(file)) return { ...STANDARD };
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TagesbetriebEinstellungen>;
  return { ...STANDARD, ...raw };
}

export function schreibeEinstellungen(neu: Partial<TagesbetriebEinstellungen>): TagesbetriebEinstellungen {
  const merged = { ...leseEinstellungen(), ...neu };
  fs.mkdirSync(path.dirname(einstellungenDatei()), { recursive: true });
  fs.writeFileSync(einstellungenDatei(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

function minuten(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Lokales Datum YYYY-MM-DD. */
export function lokalesDatum(jetzt: Date): string {
  const y = jetzt.getFullYear();
  const m = String(jetzt.getMonth() + 1).padStart(2, "0");
  const d = String(jetzt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function zeitfenster(cfg: TagesbetriebEinstellungen, jetzt: Date) {
  const wochentag = jetzt.getDay() === 0 ? 7 : jetzt.getDay();
  const nun = jetzt.getHours() * 60 + jetzt.getMinutes();
  const arbeitstag = cfg.wochentage.includes(wochentag);
  return {
    arbeitstag,
    vorStart: nun < minuten(cfg.start),
    imFenster: arbeitstag && nun >= minuten(cfg.start) && nun < minuten(cfg.ende),
    nachEnde: nun >= minuten(cfg.ende),
    /** Ab eine Stunde vor Start wird schon gesucht und geprüft, damit um Start etwas vorliegt. */
    vorbereiten: arbeitstag && nun >= minuten(cfg.start) - 60 && nun < minuten(cfg.ende),
  };
}
