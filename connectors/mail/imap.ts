import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser, type ParsedMail } from "mailparser";
import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { signaturFuer } from "@/lib/mail/signaturen";
import { absenderMitName } from "@/lib/mail/absendernamen";
import { istAutomatischeAntwort, normalisiereMessageId, parseMailAddress, verlaufsKennungen } from "@/lib/mail/adressen";
import { mailKonten, mailPasswort, type MailKontoZugang } from "@/lib/mail/konten";
import { baueNachricht, type Antwortbezug } from "@/lib/mail/nachricht";
import {
  decodeMailRef,
  encodeMailRef,
  type EingangsMail,
  type MailKopf,
  type MailVoll,
  type Postfach,
  type VersandErgebnis,
} from "@/services/mail/postfach";

/**
 * Postfach über IMAP (lesen, in „Gesendet“ ablegen) und SMTP (senden) – direkt beim Mailanbieter (IONOS),
 * ohne Apple Mail. Liest live, ohne Zwischenspeicher. Lesen markiert nichts als gelesen.
 * Gesendet heißt: Der SMTP-Server des Absenders hat die Mail angenommen. Danach wird sie im Ordner „Gesendet“
 * abgelegt und dort wiedergefunden; scheitert nur die Ablage, bleibt sie gesendet (sonst ginge sie doppelt raus)
 * und der Grund steht im Ergebnis.
 */

/** Der Teil einer IMAP-Verbindung, den NOVA braucht (ImapFlow erfüllt ihn; Tests setzen eine eigene ein). */
export type ImapVerbindung = {
  list(): Promise<Array<{ path: string; specialUse?: string }>>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: Record<string, unknown>, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchAll(
    uids: number[],
    query: { uid: true; flags: true; internalDate: true; source: true | { maxLength: number } },
    options: { uid: true },
  ): Promise<Array<{ uid: number; flags?: Set<string>; internalDate?: Date | string; source?: Buffer }>>;
  append(path: string, content: Buffer, flags?: string[]): Promise<unknown>;
  messageFlagsAdd(uids: number[], flags: string[], options: { uid: true }): Promise<boolean>;
  logout(): Promise<void>;
};

export type SmtpVersand = {
  sendMail(input: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<{ accepted: Array<string | { address: string }>; rejected: Array<string | { address: string }>; response?: string }>;
};

type Zugang = { konto: MailKontoZugang; passwort: string };

export type MailWege = {
  verbinde(zugang: Zugang): Promise<ImapVerbindung>;
  smtp(zugang: Zugang): SmtpVersand;
};

export const echteMailWege: MailWege = {
  async verbinde({ konto, passwort }) {
    const client = new ImapFlow({
      host: konto.imap.host,
      port: konto.imap.port,
      secure: true,
      auth: { user: konto.email, pass: passwort },
      logger: false,
    });
    await client.connect();
    return client as unknown as ImapVerbindung;
  },
  smtp({ konto, passwort }) {
    return nodemailer.createTransport({
      host: konto.smtp.host,
      port: konto.smtp.port,
      secure: konto.smtp.port === 465,
      auth: { user: konto.email, pass: passwort },
    }) as unknown as SmtpVersand;
  },
};

/** Vorschau: so viel einer Mail wird geladen, um Kopfzeilen und den Textanfang zu lesen. */
const VORSCHAU_BYTES = 64 * 1024;
const GESENDET_NAMEN = ["Gesendete Objekte", "Gesendet", "Sent", "Sent Items", "Sent Messages", "INBOX.Sent"];
const SPAM_NAMEN = ["Spam", "Junk", "Junk-E-Mail", "INBOX.Spam", "INBOX.Junk"];

function fehlgeschlagen(grund: string): VersandErgebnis {
  return { ok: false, executed: false, grund };
}

function adresseVon(parsed: ParsedMail): string {
  const erste = parsed.from?.value[0];
  if (!erste) return "";
  return erste.name ? `${erste.name} <${erste.address ?? ""}>` : (erste.address ?? "");
}

function adressen(feld: ParsedMail["to"]): string[] {
  const liste = Array.isArray(feld) ? feld : feld ? [feld] : [];
  return liste.flatMap((item) => item.value.map((a) => (a.address ?? "").toLowerCase())).filter(Boolean);
}

/** Kopfzeilen als Zuordnung Name (klein) → Rohwert. */
function kopfzeilen(parsed: ParsedMail): Record<string, string> {
  const ergebnis: Record<string, string> = {};
  for (const { key, line } of parsed.headerLines ?? []) {
    const wert = line.slice(line.indexOf(":") + 1).trim();
    ergebnis[key.toLowerCase()] = ergebnis[key.toLowerCase()] ? `${ergebnis[key.toLowerCase()]} ${wert}` : wert;
  }
  return ergebnis;
}

function textVon(parsed: ParsedMail): string {
  if (parsed.text?.trim()) return parsed.text.trim();
  if (typeof parsed.html === "string") return parsed.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function isoVon(datum: Date | string | undefined): string {
  if (!datum) return "";
  const d = datum instanceof Date ? datum : new Date(datum);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export class ImapPostfach implements Postfach {
  constructor(private readonly wege: MailWege = echteMailWege) {}

  private zugang(email: string): Zugang | { fehler: string } {
    const konto = mailKonten().find((k) => k.email === email.trim().toLowerCase());
    if (!konto) return { fehler: `Das Konto ${email} ist in ~/Nova/mailkonten.txt nicht eingetragen.` };
    const passwort = mailPasswort(konto.email);
    if (!passwort) return { fehler: `Für ${konto.email} fehlt das Passwort (Joachim trägt es mit „nova.sh passwort ${konto.email}“ ein).` };
    return { konto, passwort };
  }

  /** Führt eine Arbeit je Konto aus; scheitert ein Konto, laufen die anderen weiter. Scheitern alle, gibt es einen Fehler. */
  private async jeKonto<T>(arbeit: (verbindung: ImapVerbindung, zugang: Zugang) => Promise<T[]>): Promise<T[]> {
    const konten = mailKonten();
    if (!konten.length) throw new Error("Keine Mailkonten eingerichtet (~/Nova/mailkonten.txt).");
    const ergebnisse: T[] = [];
    const fehler: string[] = [];
    for (const konto of konten) {
      const zugang = this.zugang(konto.email);
      if ("fehler" in zugang) {
        fehler.push(zugang.fehler);
        continue;
      }
      try {
        const verbindung = await this.wege.verbinde(zugang);
        try {
          ergebnisse.push(...(await arbeit(verbindung, zugang)));
        } finally {
          await verbindung.logout().catch(() => undefined);
        }
      } catch (error) {
        fehler.push(`${konto.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (fehler.length === konten.length) throw new Error(`Kein Postfach lesbar. ${fehler.join(" ")}`);
    if (fehler.length) console.error(`[postfach] nicht lesbar: ${fehler.join(" | ")}`);
    return ergebnisse;
  }

  private async ordner(verbindung: ImapVerbindung, art: "\\Sent" | "\\Junk"): Promise<string | null> {
    const liste = await verbindung.list();
    const nachArt = liste.find((o) => o.specialUse === art);
    if (nachArt) return nachArt.path;
    const namen = art === "\\Sent" ? GESENDET_NAMEN : SPAM_NAMEN;
    return liste.find((o) => namen.some((n) => n.toLowerCase() === o.path.toLowerCase()))?.path ?? null;
  }

  private async holen(
    verbindung: ImapVerbindung,
    pfad: string,
    suche: Record<string, unknown>,
    voll: boolean,
  ): Promise<Array<{ uid: number; gelesen: boolean; eingang: string; parsed: ParsedMail }>> {
    const lock = await verbindung.getMailboxLock(pfad);
    try {
      const uids = (await verbindung.search(suche, { uid: true })) || [];
      if (!uids.length) return [];
      const nachrichten = await verbindung.fetchAll(
        uids,
        { uid: true, flags: true, internalDate: true, source: voll ? true : { maxLength: VORSCHAU_BYTES } },
        { uid: true },
      );
      const ergebnis = [];
      for (const n of nachrichten) {
        if (!n.source) continue;
        ergebnis.push({
          uid: n.uid,
          gelesen: n.flags?.has("\\Seen") ?? false,
          eingang: isoVon(n.internalDate),
          parsed: await simpleParser(n.source),
        });
      }
      return ergebnis;
    } finally {
      lock.release();
    }
  }

  private kopf(email: string, pfad: string, n: { uid: number; gelesen: boolean; eingang: string; parsed: ParsedMail }): MailKopf {
    return {
      ref: encodeMailRef({ kontoId: email, postfach: pfad, nachrichtId: String(n.uid), messageId: n.parsed.messageId ?? "" }),
      konto: email,
      von: adresseVon(n.parsed),
      betreff: n.parsed.subject ?? "",
      eingang: n.eingang || isoVon(n.parsed.date),
      gelesen: n.gelesen,
      textanfang: textVon(n.parsed).slice(0, 400),
    };
  }

  /** Die zuletzt im Posteingang eingegangenen Mails (höchste UIDs je Konto), über alle Konten nach Eingang sortiert. */
  async neueste(input: { anzahl: number; nurUngelesen: boolean }): Promise<MailKopf[]> {
    const alle = await this.jeKonto(async (verbindung, { konto }) => {
      const lock = await verbindung.getMailboxLock("INBOX");
      let uids: number[];
      try {
        uids = ((await verbindung.search(input.nurUngelesen ? { seen: false } : { all: true }, { uid: true })) || []).sort((a, b) => b - a).slice(0, input.anzahl);
      } finally {
        lock.release();
      }
      if (!uids.length) return [];
      const geholt = await this.holen(verbindung, "INBOX", { uid: uids.join(",") }, false);
      return geholt.map((n) => this.kopf(konto.email, "INBOX", n));
    });
    return alle.sort((a, b) => b.eingang.localeCompare(a.eingang)).slice(0, input.anzahl);
  }

  async eingang(input: { seit: Date; max: number }): Promise<EingangsMail[]> {
    const alle = await this.jeKonto(async (verbindung, { konto }) => {
      const pfade = ["INBOX"];
      const spam = await this.ordner(verbindung, "\\Junk");
      if (spam) pfade.push(spam);
      const ergebnis: EingangsMail[] = [];
      for (const pfad of pfade) {
        // IMAP-SINCE kennt nur Tage; genauer wird danach nach dem Eingang gefiltert.
        for (const n of await this.holen(verbindung, pfad, { since: input.seit }, false)) {
          if (n.eingang && new Date(n.eingang) < input.seit) continue;
          const kopf = kopfzeilen(n.parsed);
          ergebnis.push({
            ...this.kopf(konto.email, pfad, n),
            messageId: normalisiereMessageId(n.parsed.messageId ?? ""),
            bezuege: verlaufsKennungen(kopf["in-reply-to"] ?? "", kopf["references"] ?? ""),
            automatisch: istAutomatischeAntwort(kopf),
          });
        }
      }
      return ergebnis;
    });
    return alle.sort((a, b) => a.eingang.localeCompare(b.eingang)).slice(-input.max);
  }

  private async original(ref: string): Promise<{ email: string; pfad: string; uid: number; parsed: ParsedMail; gelesen: boolean; eingang: string } | null> {
    const decoded = decodeMailRef(ref);
    if (!decoded) return null;
    const zugang = this.zugang(decoded.kontoId);
    if ("fehler" in zugang) throw new Error(zugang.fehler);
    const verbindung = await this.wege.verbinde(zugang);
    try {
      let treffer = await this.holen(verbindung, decoded.postfach, { uid: decoded.nachrichtId }, true);
      // Wurde die Mail verschoben oder neu nummeriert: über die Message-ID suchen.
      if (!treffer.length && decoded.messageId) treffer = await this.holen(verbindung, decoded.postfach, { header: { "message-id": decoded.messageId } }, true);
      const n = treffer[0];
      return n ? { email: zugang.konto.email, pfad: decoded.postfach, ...n } : null;
    } finally {
      await verbindung.logout().catch(() => undefined);
    }
  }

  async lesen(ref: string): Promise<MailVoll | null> {
    const n = await this.original(ref);
    if (!n) return null;
    const text = textVon(n.parsed);
    return {
      ...this.kopf(n.email, n.pfad, n),
      ref,
      an: adressen(n.parsed.to),
      cc: adressen(n.parsed.cc),
      text,
    };
  }

  async senden(input: { absender: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis> {
    return this.verschicken(input);
  }

  async antworten(input: { absender: string; ref: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis> {
    const decoded = decodeMailRef(input.ref);
    if (!decoded) return fehlgeschlagen("Bezug auf die Originalmail fehlt.");
    let original;
    try {
      original = await this.original(input.ref);
    } catch (error) {
      return fehlgeschlagen(error instanceof Error ? error.message : String(error));
    }
    if (!original) return fehlgeschlagen("Die Originalmail ist im Postfach nicht mehr zu finden.");
    const bezug: Antwortbezug = {
      messageId: original.parsed.messageId ?? "",
      references: verlaufsKennungen(kopfzeilen(original.parsed)["references"] ?? "").map((id) => `<${id}>`),
      von: adresseVon(original.parsed),
      datum: original.parsed.date ?? null,
      text: textVon(original.parsed),
    };
    const ergebnis = await this.verschicken({ ...input, antwortAuf: bezug });
    if (ergebnis.ok) {
      // Original als beantwortet markieren (wie Apple Mail); scheitert das, ist die Antwort trotzdem raus.
      const zugang = this.zugang(original.email);
      if (!("fehler" in zugang)) {
        try {
          const verbindung = await this.wege.verbinde(zugang);
          try {
            const lock = await verbindung.getMailboxLock(original.pfad);
            try {
              await verbindung.messageFlagsAdd([original.uid], ["\\Answered"], { uid: true });
            } finally {
              lock.release();
            }
          } finally {
            await verbindung.logout().catch(() => undefined);
          }
        } catch {
          // nur eine Markierung
        }
      }
    }
    return ergebnis;
  }

  private async verschicken(input: { absender: string; an: string; betreff: string; text: string; antwortAuf?: Antwortbezug }): Promise<VersandErgebnis> {
    const absender = input.absender.trim().toLowerCase();
    if (!isSteerableMailAddress(absender)) return fehlgeschlagen(`NOVA sendet nur von ${steerableMailAddresses().join(" oder ")}.`);
    const empfaenger = parseMailAddress(input.an).email.toLowerCase();
    if (!empfaenger) return fehlgeschlagen(`Keine gültige Empfängeradresse: ${input.an}`);
    const zugang = this.zugang(absender);
    if ("fehler" in zugang) return fehlgeschlagen(zugang.fehler);

    const { raw, messageId } = await baueNachricht({
      von: absenderMitName(absender),
      an: input.an,
      betreff: input.betreff,
      text: input.text,
      signatur: signaturFuer(absender),
      antwortAuf: input.antwortAuf,
    });

    try {
      const antwort = await this.wege.smtp(zugang).sendMail({ envelope: { from: absender, to: [empfaenger] }, raw });
      const abgelehnt = antwort.rejected.map((a) => (typeof a === "string" ? a : a.address).toLowerCase());
      const angenommen = antwort.accepted.map((a) => (typeof a === "string" ? a : a.address).toLowerCase());
      if (abgelehnt.includes(empfaenger) || !angenommen.includes(empfaenger)) {
        return fehlgeschlagen(`Der Mailserver hat ${empfaenger} abgelehnt. ${antwort.response ?? ""}`.trim());
      }
    } catch (error) {
      return fehlgeschlagen(`Senden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Ab hier ist die Mail raus. Ablage in „Gesendet“ und Wiederfinden dort.
    try {
      const verbindung = await this.wege.verbinde(zugang);
      try {
        const gesendet = await this.ordner(verbindung, "\\Sent");
        if (!gesendet) throw new Error("kein Ordner „Gesendet“ gefunden");
        await verbindung.append(gesendet, raw, ["\\Seen"]);
        const lock = await verbindung.getMailboxLock(gesendet);
        let gefunden: number[] = [];
        try {
          gefunden = (await verbindung.search({ header: { "message-id": messageId } }, { uid: true })) || [];
        } finally {
          lock.release();
        }
        if (!gefunden.length) throw new Error("nach dem Ablegen nicht wiedergefunden");
      } finally {
        await verbindung.logout().catch(() => undefined);
      }
      return { ok: true, executed: true, messageId, grund: "Vom Mailserver angenommen und im Ordner Gesendet abgelegt." };
    } catch (error) {
      return {
        ok: true,
        executed: true,
        messageId,
        grund: `Vom Mailserver angenommen (gesendet), aber die Ablage im Ordner Gesendet ist fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
