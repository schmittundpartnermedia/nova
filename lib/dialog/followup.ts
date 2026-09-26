import { detectDialogMove } from "@/lib/dialog/intent";

export type ConversationMove = "return" | "continue" | "fresh";

const RETURN_RE = /\b(zurück|zurueck|wieder (?:zu|zum|zur)|wo waren wir|wo warst du)\b/i;
const ANAPHORA_RE =
  /\b(davon|darüber|darueber|damit|dazu|die andere|das andere|den anderen|welche davon|eben|diesen|diese|dieses|jenen|jene)\b/i;
const OPENING_RE = /^(warum|wieso|weshalb|und|aber|welche|mach das|die andere|und dann)\b/i;
const FRESH_RE =
  /\b(mails?|e-mails?|postfach|projekte?|kontakte?|tickets?|aufgaben?|termine?|kalender|recherch|dateien?|upload|entwickl|cursor|was steht an|wie ist der stand|wie weit bist du|was hast du gerade)\b/i;

export function classifyConversationMove(text: string): ConversationMove {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "fresh";
  if (detectDialogMove(value).kind === "social") return "fresh";
  if (RETURN_RE.test(value)) return "return";
  const words = value.split(" ").filter(Boolean);
  const anaphora = ANAPHORA_RE.test(value) || OPENING_RE.test(value);
  if (FRESH_RE.test(value) && !anaphora) return "fresh";
  if (anaphora && words.length <= 14) return "continue";
  if (words.length <= 5 && !FRESH_RE.test(value)) return "continue";
  return "fresh";
}
