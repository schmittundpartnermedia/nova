import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import type { TagesbetriebEinstellungen } from "@/services/tagesbetrieb/einstellungen";

/**
 * Suchplan des Tagesbetriebs: Welche Branchen im Suchgebiet schon vollständig gesucht sind.
 * `~/Nova/zustand/suchplan.json`. Ein anderes Gebiet (Ort oder Umkreis) beginnt wieder bei der ersten Branche.
 */
export type SuchplanEintrag = { branche: string; mitte: string; radiusKm: number; datum: string; betriebe: number; vollstaendig: boolean };

function datei(): string {
  return path.join(novaHomeDir(), "zustand", "suchplan.json");
}

export function leseSuchplan(): SuchplanEintrag[] {
  try {
    const daten = JSON.parse(fs.readFileSync(datei(), "utf8")) as { erledigt?: SuchplanEintrag[] };
    return daten.erledigt ?? [];
  } catch {
    return [];
  }
}

function gleichesGebiet(eintrag: SuchplanEintrag, cfg: TagesbetriebEinstellungen): boolean {
  return eintrag.mitte.toLowerCase() === cfg.suchgebiet.mitte.toLowerCase() && eintrag.radiusKm === cfg.suchgebiet.radiusKm;
}

/** Erledigte Branchen im aktuellen Gebiet, in Plan-Reihenfolge. */
export function erledigteBranchen(cfg: TagesbetriebEinstellungen): string[] {
  const erledigt = new Set(leseSuchplan().filter((e) => gleichesGebiet(e, cfg)).map((e) => e.branche.toLowerCase()));
  return cfg.branchen.filter((branche) => erledigt.has(branche.toLowerCase()));
}

/** Nächste Branche, die im Gebiet noch nicht gesucht wurde; null = alle durch. */
export function naechsteBranche(cfg: TagesbetriebEinstellungen): string | null {
  const erledigt = new Set(erledigteBranchen(cfg).map((b) => b.toLowerCase()));
  return cfg.branchen.find((branche) => !erledigt.has(branche.toLowerCase())) ?? null;
}

export function markiereErledigt(eintrag: SuchplanEintrag): void {
  const alle = leseSuchplan().filter(
    (e) => !(e.branche.toLowerCase() === eintrag.branche.toLowerCase() && e.mitte.toLowerCase() === eintrag.mitte.toLowerCase() && e.radiusKm === eintrag.radiusKm),
  );
  alle.push(eintrag);
  fs.mkdirSync(path.dirname(datei()), { recursive: true });
  fs.writeFileSync(datei(), `${JSON.stringify({ erledigt: alle }, null, 2)}\n`, "utf8");
}
