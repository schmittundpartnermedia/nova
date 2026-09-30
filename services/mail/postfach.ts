/**
 * Das Postfach, wie der Kopf es sieht: lesen, senden, antworten.
 * Einzige echte Umsetzung ist Apple Mail (`connectors/mail/apple.ts`); Tests setzen eine eigene ein.
 */

export type MailKonto = { appleId: string; email: string };

export type MailKopf = {
  /** Opaker Verweis auf die Nachricht in Apple Mail; so an mail_lesen / mail_antworten zurückgeben. */
  ref: string;
  konto: string;
  von: string;
  betreff: string;
  eingang: string;
  gelesen: boolean;
  textanfang: string;
};

export type MailVoll = MailKopf & {
  an: string[];
  cc: string[];
  text: string;
};

/** Eingegangene Mail mit Verlauf: Message-IDs, auf die sie antwortet (In-Reply-To, References). */
export type EingangsMail = MailKopf & {
  messageId: string;
  bezuege: string[];
  /** Abwesenheitsnotiz o. Ä. (laut Kopfzeilen automatisch erzeugt). */
  automatisch: boolean;
};

export type VersandErgebnis =
  | { ok: true; executed: true; messageId: string; grund: string }
  | { ok: false; executed: false; grund: string };

export interface Postfach {
  neueste(input: { anzahl: number; nurUngelesen: boolean }): Promise<MailKopf[]>;
  /** Alles, was seit „seit“ in Posteingang oder Werbung/Junk eingegangen ist (höchstens max). */
  eingang(input: { seit: Date; max: number }): Promise<EingangsMail[]>;
  lesen(ref: string): Promise<MailVoll | null>;
  senden(input: { absender: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis>;
  antworten(input: { absender: string; ref: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis>;
}

export type MailRef = { kontoId: string; postfach: string; nachrichtId: string; messageId: string };

export function encodeMailRef(ref: MailRef): string {
  return Buffer.from(JSON.stringify([ref.kontoId, ref.postfach, ref.nachrichtId, ref.messageId]), "utf8").toString("base64url");
}

export function decodeMailRef(raw: string): MailRef | null {
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4 || !parsed.every((item) => typeof item === "string")) return null;
    const [kontoId, postfach, nachrichtId, messageId] = parsed as string[];
    if (!kontoId || !nachrichtId) return null;
    return { kontoId, postfach: postfach ?? "", nachrichtId, messageId: messageId ?? "" };
  } catch {
    return null;
  }
}

/** Betreff einer Antwort: „Re: …“, außer er ist schon eine Antwort. */
export function antwortBetreff(betreff: string): string {
  const clean = betreff.trim();
  return /^(re|aw|antw)\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}
