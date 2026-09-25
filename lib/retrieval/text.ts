import { createHash } from "node:crypto";
import { redactSecrets, looksLikeSecret } from "@/lib/computer/redaction";

const LOW_VALUE =
  /^(ok(ay)?|ja|nein|danke|thanks|thx|bitte|hmm+|lol|hi|hallo|hey|sure|cool|super|genau|gerne\.?|alles\s+klar)\.?$/i;

const LOG_NOISE = /^(debug|trace|info)\s+\d{4}-\d{2}-\d{2}/i;

export function contentChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function prepareEmbeddingText(text: string): { text: string; skip?: string } {
  const redacted = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (!redacted) return { text: redacted, skip: "empty" };
  if (LOW_VALUE.test(redacted)) return { text: redacted, skip: "boilerplate" };
  if (looksLikeSecret(text) || looksLikeSecret(redacted)) return { text: redacted, skip: "secret" };
  if (LOG_NOISE.test(redacted)) return { text: redacted, skip: "log" };
  if (redacted.length < 24) return { text: redacted, skip: "empty" };
  return { text: redacted.slice(0, 8000) };
}
