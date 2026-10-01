import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Verbrauchsbuch für bezahlte Dienste, die NOVA selbst aufruft (OpenAI: Kopf, Stimme, Spracherkennung, Websuche).
 * Eine Zeile je Aufruf in `~/Nova/zustand/kosten/<JJJJ-MM>.jsonl`; in Dollar umgerechnet wird erst beim Auswerten
 * mit der Preistabelle. Preise, die nicht sicher bekannt sind, stehen NICHT im Code – Joachim trägt sie in
 * `~/Nova/preise.json` ein; bis dahin meldet NOVA „Preis fehlt“ statt eine Zahl zu erfinden.
 */

export type VerbrauchsArt = "kopf" | "stimme" | "spracherkennung" | "websuche";

export type Buchung = {
  zeit: string;
  art: VerbrauchsArt;
  modell: string;
  eingabeTokens?: number;
  /** Davon aus dem Zwischenspeicher (OpenAI rechnet sie deutlich billiger ab). */
  gecachteTokens?: number;
  ausgabeTokens?: number;
  zeichen?: number;
  sekunden?: number;
  anfragen?: number;
};

/** Preise je Modell (Dollar). Jede Angabe optional; fehlt die passende, ist der Preis unbekannt. */
export type Preis = {
  proMioEingabeTokens?: number;
  proMioGecachteTokens?: number;
  proMioAusgabeTokens?: number;
  proMinute?: number;
  proMioZeichen?: number;
  proAnfrage?: number;
};

/**
 * Bekannte Listenpreise (öffentliche OpenAI-Preisliste, Stand meines Wissens; per ~/Nova/preise.json überschreibbar).
 * Für gpt-6-astra und gpt-4o-mini-tts ist hier bewusst nichts eingetragen.
 */
const BEKANNTE_PREISE: Record<string, Preis> = {
  "whisper-1": { proMinute: 0.006 },
  "gpt-4o-mini-transcribe": { proMinute: 0.003 },
  "gpt-4o-mini": { proMioEingabeTokens: 0.15, proMioAusgabeTokens: 0.6 },
};

/** Google Places Text Search (Enterprise-SKU) laut Lead-Scanner-README. */
export const GOOGLE_USD_PRO_ANFRAGE = 0.035;

function kostenDir(): string {
  // NOVA_KOSTENBUCH_DIR nur für Vergleichsläufe (Nachweise mit Wegwerf-NOVA_HOME sollen ihren Verbrauch behalten).
  return process.env.NOVA_KOSTENBUCH_DIR?.trim() || path.join(novaHomeDir(), "zustand", "kosten");
}

export function preisDatei(): string {
  return path.join(novaHomeDir(), "preise.json");
}

/** Schreibt eine Buchung. Darf nie einen Aufruf scheitern lassen – Fehler beim Schreiben werden geschluckt. */
export function bucheVerbrauch(buchung: Omit<Buchung, "zeit"> & { zeit?: Date }): void {
  try {
    const zeit = buchung.zeit ?? new Date();
    const datei = path.join(kostenDir(), `${zeit.toISOString().slice(0, 7)}.jsonl`);
    fs.mkdirSync(kostenDir(), { recursive: true });
    const { zeit: _z, ...rest } = buchung;
    void _z;
    fs.appendFileSync(datei, `${JSON.stringify({ zeit: zeit.toISOString(), ...rest })}\n`, "utf8");
  } catch {
    // Kostenbuch ist Beiwerk; der eigentliche Aufruf hat geklappt.
  }
}

export function lesePreise(): Record<string, Preis> {
  let eigene: Record<string, Preis> = {};
  try {
    eigene = JSON.parse(fs.readFileSync(preisDatei(), "utf8")) as Record<string, Preis>;
  } catch {
    eigene = {};
  }
  return { ...BEKANNTE_PREISE, ...eigene };
}

export function leseBuchungen(von: Date, bis: Date): Buchung[] {
  const monate = new Set<string>();
  for (let d = new Date(von.getFullYear(), von.getMonth(), 1); d < bis; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    monate.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const ergebnis: Buchung[] = [];
  for (const monat of monate) {
    let inhalt = "";
    try {
      inhalt = fs.readFileSync(path.join(kostenDir(), `${monat}.jsonl`), "utf8");
    } catch {
      continue;
    }
    for (const zeile of inhalt.split("\n")) {
      if (!zeile.trim()) continue;
      try {
        const b = JSON.parse(zeile) as Buchung;
        const t = new Date(b.zeit);
        if (t >= von && t < bis) ergebnis.push(b);
      } catch {
        // kaputte Zeile überspringen
      }
    }
  }
  return ergebnis;
}

/** Dollar einer Buchung; null, wenn für das, was verbraucht wurde, kein Preis bekannt ist. */
export function usdFuer(b: Buchung, preise: Record<string, Preis>): number | null {
  const p = preise[b.modell];
  if (!p) return null;
  let summe = 0;
  const teil = (menge: number | undefined, preis: number | undefined, teiler: number) => {
    if (!menge) return true;
    if (preis === undefined) return false;
    summe += (menge / teiler) * preis;
    return true;
  };
  // Gecachte Eingabe-Tokens zum Cache-Preis (wenn bekannt), der Rest zum vollen Eingabepreis.
  const gecacht = p.proMioGecachteTokens !== undefined ? Math.min(b.gecachteTokens ?? 0, b.eingabeTokens ?? 0) : 0;
  const ok =
    teil(gecacht, p.proMioGecachteTokens, 1_000_000) &&
    teil((b.eingabeTokens ?? 0) - gecacht, p.proMioEingabeTokens, 1_000_000) &&
    teil(b.ausgabeTokens, p.proMioAusgabeTokens, 1_000_000) &&
    teil(b.zeichen, p.proMioZeichen, 1_000_000) &&
    teil(b.sekunden, p.proMinute, 60) &&
    teil(b.anfragen, p.proAnfrage, 1);
  return ok ? summe : null;
}
