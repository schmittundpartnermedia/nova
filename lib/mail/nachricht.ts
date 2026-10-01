import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { ohneFett } from "@/lib/mail/fett";

/**
 * Baut eine fertige Mail (MIME), wie sie per SMTP rausgeht und im Ordner „Gesendet“ abgelegt wird:
 * Textfassung (ohne Sternchen) und HTML-Fassung (**so** → fett), Signatur darunter, bei Antworten
 * Verlauf (In-Reply-To/References) und das zitierte Original.
 */

export type Antwortbezug = {
  messageId: string;
  references: string[];
  von: string;
  datum: Date | null;
  text: string;
};

export type NachrichtEingabe = {
  /** „Name <adresse>“ oder nur die Adresse. */
  von: string;
  an: string;
  betreff: string;
  /** Text mit **Fettmarkierung**. */
  text: string;
  signatur?: string;
  antwortAuf?: Antwortbezug;
  datum?: Date;
};

function maskiere(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Absätze (Leerzeile) → <p>, einfache Zeilenumbrüche → <br>, **so** → <strong>. */
export function alsHtml(markiert: string): string {
  return markiert
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((absatz) => {
      const html = maskiere(absatz).replace(/\*\*([^*]+?)\*\*/g, (_, inhalt: string) => (inhalt.trim() ? `<strong>${inhalt}</strong>` : `**${inhalt}**`));
      return `<p style="margin:0 0 1em 0">${html.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function zitatKopf(bezug: Antwortbezug): string {
  const wann = bezug.datum
    ? `${bezug.datum.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })} um ${bezug.datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  return `Am ${wann ? `${wann} ` : ""}schrieb ${bezug.von}:`;
}

export async function baueNachricht(eingabe: NachrichtEingabe): Promise<{ raw: Buffer; messageId: string }> {
  const domain = (eingabe.von.match(/@([^>\s]+)/)?.[1] ?? "nova.local").toLowerCase();
  const messageId = `<${randomUUID()}@${domain}>`;
  const signatur = eingabe.signatur?.trim();
  const zitat = eingabe.antwortAuf?.text.trim();

  const textTeile = [ohneFett(eingabe.text).trim()];
  if (signatur) textTeile.push(ohneFett(signatur));
  if (eingabe.antwortAuf && zitat) {
    textTeile.push(`${zitatKopf(eingabe.antwortAuf)}\n${zitat.split("\n").map((zeile) => `> ${zeile}`).join("\n")}`);
  }

  const htmlTeile = [alsHtml(eingabe.text.trim())];
  if (signatur) htmlTeile.push(`<div class="signatur">${alsHtml(signatur)}</div>`);
  if (eingabe.antwortAuf && zitat) {
    htmlTeile.push(
      `<p style="margin:1em 0 0.5em 0">${maskiere(zitatKopf(eingabe.antwortAuf))}</p><blockquote style="margin:0 0 0 0.8em;border-left:2px solid #ccc;padding-left:0.8em;color:#555">${alsHtml(zitat)}</blockquote>`,
    );
  }
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#111">\n${htmlTeile.join("\n")}\n</body></html>`;

  const bezug = eingabe.antwortAuf;
  const composer = new MailComposer({
    from: eingabe.von,
    to: eingabe.an,
    subject: ohneFett(eingabe.betreff),
    text: textTeile.join("\n\n"),
    html,
    messageId,
    date: eingabe.datum ?? new Date(),
    ...(bezug?.messageId
      ? { inReplyTo: bezug.messageId, references: [...bezug.references, bezug.messageId].join(" ") }
      : {}),
  });
  const raw = await new Promise<Buffer>((resolve, reject) => composer.compile().build((error, message) => (error ? reject(error) : resolve(message))));
  return { raw, messageId };
}
