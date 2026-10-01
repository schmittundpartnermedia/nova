import { caldavKalender } from "@/lib/kalender/caldav";

/** Wohin NOVA Termine zusätzlich einträgt. Tests setzen ein Ziel im Speicher ein. */
export type KalenderEintrag = { titel: string; beginn: Date; dauerMinuten: number; notiz?: string; erinnerungMinuten: number };
/** kalender = Anzeigename des Kalenders, uid = Verweis auf den Eintrag (bei CalDAV seine Adresse). */
export type KalenderOrt = { kalender: string; uid: string };
export type KalenderErgebnis = ({ ok: true } & KalenderOrt) | { ok: false; grund: string };
export type KalenderZiel = {
  eintragen(eintrag: KalenderEintrag): Promise<KalenderErgebnis>;
  aendern(ort: KalenderOrt, eintrag: KalenderEintrag): Promise<KalenderErgebnis>;
  entfernen(ort: KalenderOrt): Promise<{ ok: true } | { ok: false; grund: string }>;
};

const globalRef = globalThis as unknown as { __novaKalender?: KalenderZiel };

export function kalender(): KalenderZiel {
  return globalRef.__novaKalender ?? caldavKalender;
}

/** Tests setzen ein Kalender-Ziel im Speicher; nie Joachims echter Kalender. */
export function setzeKalender(ziel: KalenderZiel | null): void {
  globalRef.__novaKalender = ziel ?? undefined;
}
