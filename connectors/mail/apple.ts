import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { signaturFuer } from "@/lib/mail/signaturen";
import {
  accountListScript,
  deliveryFromVerification,
  localStampToIso,
  messageDetailScript,
  neuesteNachrichtenScript,
  newSendScript,
  parseDetail,
  parseMailAddress,
  parseRecords,
  replySendScript,
  sentLookupScript,
} from "@/lib/mail/apple";
import {
  openMailIfClosed,
  promptMailAutomationAccess,
  readMailAutomationState,
  runMailAppleScript,
} from "@/services/mail/apple-events";
import {
  decodeMailRef,
  encodeMailRef,
  type MailKonto,
  type MailKopf,
  type MailVoll,
  type Postfach,
  type VersandErgebnis,
} from "@/services/mail/postfach";

const KONTEN_TTL_MS = 60_000;

function fehlgeschlagen(grund: string): VersandErgebnis {
  return { ok: false, executed: false, grund };
}

function liste(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => parseMailAddress(item).email.toLowerCase())
    .filter(Boolean);
}

/** Apple Mail über Apple Events (Swift-Helfer). Liest live, ohne Zwischenspeicher in der Datenbank. */
export class AppleMailPostfach implements Postfach {
  private konten: { at: number; liste: MailKonto[] } | null = null;

  private async bereit(): Promise<void> {
    await openMailIfClosed();
    let state = await readMailAutomationState();
    if (state === "required") state = await promptMailAutomationAccess();
    if (state === "granted") return;
    if (state === "denied") {
      throw new Error("NOVA darf Apple Mail nicht steuern (Automation abgelehnt). Freigabe unter Systemeinstellungen › Datenschutz & Sicherheit › Automation.");
    }
    throw new Error("Apple Mail ist nicht erreichbar oder die Automations-Freigabe fehlt.");
  }

  private async script(source: string, timeoutMs: number): Promise<string> {
    const result = await runMailAppleScript(source, timeoutMs);
    if (!result.ok) {
      throw new Error(result.permission ? "Automations-Freigabe für Apple Mail fehlt." : `Apple Mail: ${result.error}`);
    }
    return result.output;
  }

  private async kontenListe(): Promise<MailKonto[]> {
    if (this.konten && Date.now() - this.konten.at < KONTEN_TTL_MS) return this.konten.liste;
    const rows = parseRecords(await this.script(accountListScript(), 20_000));
    const konten = rows
      .map((row) => ({ appleId: row[0] ?? "", email: (row[2] ?? "").trim().toLowerCase() }))
      .filter((konto) => konto.appleId && konto.email);
    this.konten = { at: Date.now(), liste: konten };
    return konten;
  }

  private async kontoFuer(absender: string): Promise<MailKonto | null> {
    const email = absender.trim().toLowerCase();
    return (await this.kontenListe()).find((konto) => konto.email === email) ?? null;
  }

  async neueste(input: { anzahl: number; nurUngelesen: boolean }): Promise<MailKopf[]> {
    await this.bereit();
    const konten = await this.kontenListe();
    const rows = parseRecords(await this.script(neuesteNachrichtenScript(input), 60_000));
    return rows.map((row) => ({
      ref: encodeMailRef({
        nachrichtId: row[0] ?? "",
        kontoId: row[1] ?? "",
        postfach: row[2] ?? "",
        messageId: row[7] ?? "",
      }),
      konto: konten.find((konto) => konto.appleId === row[1])?.email ?? "",
      von: row[3] ?? "",
      betreff: row[4] ?? "",
      eingang: localStampToIso(row[5] ?? "") ?? row[5] ?? "",
      gelesen: /true/i.test(row[6] ?? ""),
      textanfang: (row[8] ?? "").trim(),
    }));
  }

  async lesen(ref: string): Promise<MailVoll | null> {
    const decoded = decodeMailRef(ref);
    if (!decoded) return null;
    await this.bereit();
    const result = await runMailAppleScript(
      messageDetailScript(decoded.kontoId, decoded.postfach, decoded.nachrichtId, decoded.messageId),
      30_000,
    );
    if (!result.ok) {
      if (result.permission) throw new Error("Automations-Freigabe für Apple Mail fehlt.");
      return null;
    }
    const { fields, body } = parseDetail(result.output);
    const konten = await this.kontenListe();
    return {
      ref,
      konto: konten.find((konto) => konto.appleId === decoded.kontoId)?.email ?? "",
      von: fields[2] ?? "",
      betreff: fields[3] ?? "",
      eingang: localStampToIso(fields[4] ?? "") ?? fields[4] ?? "",
      gelesen: /true/i.test(fields[5] ?? ""),
      an: liste(fields[6] ?? ""),
      cc: liste(fields[7] ?? ""),
      textanfang: body.slice(0, 400),
      text: body,
    };
  }

  async senden(input: { absender: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis> {
    if (!isSteerableMailAddress(input.absender)) {
      return fehlgeschlagen(`NOVA sendet nur von ${steerableMailAddresses().join(" oder ")}.`);
    }
    await this.bereit();
    const konto = await this.kontoFuer(input.absender);
    if (!konto) return fehlgeschlagen(`Kein Apple-Mail-Konto mit der Adresse ${input.absender}.`);
    const sent = await runMailAppleScript(
      newSendScript({ sender: konto.email, to: input.an, subject: input.betreff, body: input.text, signature: signaturFuer(konto.email) }),
      40_000,
    );
    if (!sent.ok) return fehlgeschlagen(sent.error);
    return this.bestaetigen(konto.appleId, input.betreff, input.an, sent.output);
  }

  async antworten(input: { absender: string; ref: string; an: string; betreff: string; text: string }): Promise<VersandErgebnis> {
    if (!isSteerableMailAddress(input.absender)) {
      return fehlgeschlagen(`NOVA sendet nur von ${steerableMailAddresses().join(" oder ")}.`);
    }
    const original = decodeMailRef(input.ref);
    if (!original) return fehlgeschlagen("Bezug auf die Originalmail fehlt.");
    await this.bereit();
    const konto = await this.kontoFuer(input.absender);
    if (!konto) return fehlgeschlagen(`Kein Apple-Mail-Konto mit der Adresse ${input.absender}.`);
    const sent = await runMailAppleScript(
      replySendScript({
        accountId: original.kontoId,
        mailbox: original.postfach,
        messageId: original.nachrichtId,
        internetMessageId: original.messageId,
        body: input.text,
        replyAll: false,
        sender: konto.email,
        signature: signaturFuer(konto.email),
      }),
      40_000,
    );
    if (!sent.ok) return fehlgeschlagen(sent.error);
    return this.bestaetigen(konto.appleId, input.betreff, input.an, sent.output);
  }

  /** Gesendet heißt: im Ordner „Gesendet“ des Absenderkontos gefunden. */
  private async bestaetigen(kontoId: string, betreff: string, an: string, scriptOutput: string): Promise<VersandErgebnis> {
    const accepted = /true/i.test(scriptOutput);
    let messageId = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const lookup = await runMailAppleScript(sentLookupScript(kontoId, betreff, an), 25_000);
      messageId = lookup.ok ? lookup.output.trim() : "";
      if (messageId) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (deliveryFromVerification(accepted, Boolean(messageId)) !== "VERIFIED") {
      return fehlgeschlagen(
        accepted
          ? "Apple Mail hat den Versand angenommen, im Ordner Gesendet ist die Mail aber noch nicht zu finden."
          : "Die Mail ist nicht im Ordner Gesendet angekommen.",
      );
    }
    return { ok: true, executed: true, messageId, grund: "Im Ordner Gesendet gefunden." };
  }
}
