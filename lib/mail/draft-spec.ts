export type MailDraftSpec = {
  to: string | null;
  from: string | null;
  subject: string | null;
  bodyHint: string | null;
};

const EMAIL = "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}";

export function parseMailDraftSpec(userRequest: string): MailDraftSpec {
  const text = userRequest.trim();
  const to =
    text.match(new RegExp(`\\b(?:an|empfänger|empfaenger)\\s+(${EMAIL})`, "i"))?.[1] ??
    text.match(new RegExp(`\\ban\\s+[^\\n@]{0,40}?(${EMAIL})`, "i"))?.[1] ??
    null;
  const from = text.match(new RegExp(`\\b(?:von|absender)\\s+(${EMAIL})`, "i"))?.[1] ?? null;
  const subject = text.match(/\bBetreff\s*[:\-]?\s*([^\n.]+)/i)?.[1]?.trim() || null;
  return {
    to: to ? to.toLowerCase() : null,
    from: from ? from.toLowerCase() : null,
    subject,
    bodyHint: extractBodyHint(text, { to, from, subject }),
  };
}

export function extractAccountChoice(userRequest: string): string | null {
  const text = userRequest.trim();
  const from = text.match(new RegExp(`^(?:von|absender)\\s+(${EMAIL})\\.?$`, "i"))?.[1];
  if (from) return from.toLowerCase();
  const only = text.match(new RegExp(`^(${EMAIL})\\.?$`, "i"))?.[1];
  if (only) return only.toLowerCase();
  const embedded = text.match(new RegExp(`\\b(?:von|absender|konto)\\s+(${EMAIL})`, "i"))?.[1];
  if (embedded) return embedded.toLowerCase();
  return null;
}

export function looksLikeAccountPick(userRequest: string): boolean {
  if (extractAccountChoice(userRequest)) return true;
  if (/^(konto|absender)\s*\d{1,2}\.?$/i.test(userRequest.trim())) return true;
  return false;
}

export function formatAccountQuestion(
  accounts: Array<{ emailAddress: string; displayName: string | null }>,
): string {
  if (!accounts.length) {
    return "Kein Mailkonto ist verbunden. Bitte zuerst Apple Mail in NOVA verbinden. Es wurde nichts vorbereitet und nichts versendet.";
  }
  const list = accounts
    .map((account, index) => {
      const label = account.displayName?.trim()
        ? `${account.displayName.trim()} <${account.emailAddress}>`
        : account.emailAddress;
      return `${index + 1}. ${label}`;
    })
    .join("\n");
  return `Von welchem Mailkonto soll ich senden?\n\n${list}\n\nAntworte mit der Adresse oder „von …“. Es wurde noch nichts versendet.`;
}

export function formatDraftForApproval(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const body = stripDraftFooter(input.body).trim();
  return `Mail-Entwurf zur Freigabe\n\nAbsender: ${input.from}\nEmpfänger: ${input.to}\nBetreff: ${input.subject}\n\n${body}\n\nPasst das? Dann freigeben zum Senden.`;
}

export function stripDraftFooter(body: string): string {
  return body.replace(/\n---\n[\s\S]*$/m, "").trim();
}

function extractBodyHint(
  text: string,
  parts: { to: string | null; from: string | null; subject: string | null },
): string | null {
  const quoted = text.match(/[„"«]([^“"»]{3,})[“"»]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  const inhalt = text.match(/\b(?:inhalt|text|nachricht|body)\s*[:：]\s*([\s\S]+)$/i);
  if (inhalt?.[1]?.trim()) return cleanHint(inhalt[1]);

  const dass = text.match(/\bdass\s+([\s\S]+)$/i);
  if (dass?.[1]?.trim()) {
    const core = dass[1].replace(/[.!?]+$/g, "").trim();
    if (core.length >= 8) {
      return `Guten Tag,\n\n${core.charAt(0).toUpperCase()}${core.slice(1)}.\n\nFreundliche Grüße\nJoachim`;
    }
  }

  let remainder = text
    .replace(new RegExp(`\\b(?:an|empfänger|empfaenger)\\s+${EMAIL}`, "ig"), " ")
    .replace(new RegExp(`\\b(?:von|absender)\\s+${EMAIL}`, "ig"), " ")
    .replace(/\bBetreff\s*[:\-]?\s*[^\n.]+/gi, " ")
    .replace(
      /\b(?:schreib(?:e|en)?|verfass(?:e|en)?|schick(?:e|en)?|send(?:e|en)?|versend(?:e|en)?|antworte|antwort(?:en)?|bitte|eine?|neue?|mailentwurf|e-?mail-?entwurf|e-?mails?|mails?|entwurf|mit|dem|den|der|das|und)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (parts.subject && remainder.toLowerCase().includes(parts.subject.toLowerCase())) {
    remainder = remainder.replace(parts.subject, " ").replace(/\s+/g, " ").trim();
  }
  if (remainder.length >= 12 && /[a-zäöü]/i.test(remainder)) return cleanHint(remainder);
  return null;
}

function cleanHint(value: string): string {
  return value.replace(/^[\s,:.\-–—]+/, "").replace(/\s+/g, " ").trim();
}
