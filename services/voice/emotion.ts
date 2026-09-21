import type { SpeechEmotion } from "@/types/voice";

const POSITIVE = /\b(freut mich|sehr gern(?:e)?|gerne geschehen|wunderbar|klappt)\b/i;
const WARM = /\b(gern(?:e)?|willkommen|schön dich|ich bin da)\b/i;
const CONFIDENT = /\b(übernehme|erledige ich|ist vorbereitet|können wir)\b/i;
const CONCERNED = /\b(leider|vorsicht|risiko|problem|fehlgeschlagen|nicht möglich|achtung|warnung)\b/i;
const FOCUSED = /\b(prüfen|priorisieren|planen|als nächstes|zuerst|fokuss)\b/i;

export function inferSpeechEmotion(text: string): SpeechEmotion | null {
  const value = text.trim();
  if (!value) return null;
  if (CONCERNED.test(value)) return "concerned";
  if (POSITIVE.test(value)) return "positive";
  if (CONFIDENT.test(value) && value.length < 220) return "confident";
  if (WARM.test(value) && value.length < 180) return "warm";
  if (FOCUSED.test(value) && value.length < 280) return "focused";
  return null;
}
