export type MailClassification =
  | "IMPORTANT"
  | "ACTION_REQUIRED"
  | "REPLY_REQUIRED"
  | "INFORMATIONAL"
  | "NEWSLETTER"
  | "SPAM_OR_LOW_VALUE"
  | "UNKNOWN";

export type PriorityLevel = "high" | "normal" | "low";

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
]);

export function isConsumerDomain(domain: string): boolean {
  return FREE_DOMAINS.has(domain.toLowerCase());
}

export function classifyMail(input: {
  from: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  knownImportant?: boolean;
}): MailClassification {
  const headers = input.headers ?? {};
  const blob = `${input.subject}\n${input.text}`.toLowerCase();
  const listUnsub = headers["list-unsubscribe"] || headers["List-Unsubscribe"];
  const precedence = (headers.precedence || headers.Precedence || "").toLowerCase();
  if (listUnsub || precedence === "bulk" || precedence === "list" || /newsletter|abmelden|unsubscribe/.test(blob)) {
    return "NEWSLETTER";
  }
  if (/\b(viagra|lottery|gewinnspiel|krypto-airdrop|you have won)\b/i.test(blob)) return "SPAM_OR_LOW_VALUE";
  if (/\?/.test(input.text) && /bitte|können sie|koennen sie|rückfrage|rueckfrage|antwort/.test(blob)) return "REPLY_REQUIRED";
  if (/bitte (um|bis)|deadline|frist|handlung|angebot|rechnung|zahlung/.test(blob)) return "ACTION_REQUIRED";
  if (input.knownImportant || /partnerschaft|vertrag|angebot|dringend/.test(blob)) return "IMPORTANT";
  if (input.text.trim().length > 40) return "INFORMATIONAL";
  return "UNKNOWN";
}

export function detectPriority(input: {
  classification: MailClassification;
  knownContact: boolean;
  knownCompany: boolean;
  knownProject: boolean;
  text: string;
}): { priority: PriorityLevel; reason: string } {
  const reasons: string[] = [];
  if (input.knownProject) reasons.push("bestehendes Projekt");
  if (input.knownContact) reasons.push("bekannte Person");
  if (input.knownCompany) reasons.push("bekannte Firma");
  if (/deadline|frist|bis morgen|heute/.test(input.text.toLowerCase())) reasons.push("Zeitbezug");
  if (/\?/.test(input.text) && input.classification === "REPLY_REQUIRED") reasons.push("direkte Frage");
  if (/zusage|wir vereinbaren|commitment|zusagen/.test(input.text.toLowerCase())) reasons.push("Commitment");
  const highClass = input.classification === "IMPORTANT" || input.classification === "ACTION_REQUIRED" || input.classification === "REPLY_REQUIRED";
  if (highClass && reasons.length) return { priority: "high", reason: reasons.join(", ") };
  if (input.classification === "NEWSLETTER" || input.classification === "SPAM_OR_LOW_VALUE") {
    return { priority: "low", reason: input.classification === "NEWSLETTER" ? "Newsletter" : "geringer Wert" };
  }
  return { priority: "normal", reason: reasons[0] ?? "kein besonderes Signal" };
}
