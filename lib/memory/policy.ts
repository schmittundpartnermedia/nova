import { looksLikeSecret } from "@/lib/secrets";
import { isPureSocial } from "@/lib/dialog/intent";
import type { MemoryType } from "@/types";

export type MemoryWorth = "durable" | "skip" | "secret";

const LOW_VALUE =
  /^(ok(ay)?|ja|nein|danke|thanks|thx|bitte|hmm+|lol|hi|hallo|hey|sure|cool|super|genau|gerne\.?|alles\s+klar|schönen\s+feierabend)\.?$/i;

const DURABLE_RE =
  /\b(merk(?:e)?\s*dir|beschlossen|entschieden|entscheidung|wir nehmen|ab sofort|deadline|frist|präferenz|lieber immer|nicht mehr|pilot|vertrag|zusage|preis|ich will|ich möchte künftig)\b/i;

const DECISION_RE = /\b(beschlossen|entschieden|entscheidung|wir nehmen|ab sofort)\b/i;
const PREFERENCE_RE = /\b(präferenz|lieber immer|nicht mehr|ich will immer|ich möchte künftig)\b/i;

export function classifyMemoryWorth(text: string): MemoryWorth {
  const value = text.trim();
  if (!value) return "skip";
  if (looksLikeSecret(value)) return "secret";
  if (isPureSocial(value) || LOW_VALUE.test(value)) return "skip";
  if (DURABLE_RE.test(value) && value.length > 12) return "durable";
  return "skip";
}

export function extractSpokenMemory(userRequest: string): { type: MemoryType; title: string; content: string } | null {
  if (classifyMemoryWorth(userRequest) !== "durable") return null;
  const content = userRequest.replace(/\s+/g, " ").trim().slice(0, 400);
  const type: MemoryType = DECISION_RE.test(userRequest)
    ? "decision"
    : PREFERENCE_RE.test(userRequest)
      ? "preference"
      : "fact";
  const title = content.slice(0, 72).replace(/[?.!]+$/, "").trim() || "Gesprächsnotiz";
  return { type, title, content };
}

export function shouldPersistMemoryItem(input: { title: string; content: string }): boolean {
  const blob = `${input.title}\n${input.content}`;
  if (classifyMemoryWorth(blob) === "secret") return false;
  if (looksLikeSecret(input.title) || looksLikeSecret(input.content)) return false;
  if (LOW_VALUE.test(input.content.trim()) || LOW_VALUE.test(input.title.trim())) return false;
  return true;
}
