/**
 * Zentrale NOVA-Stimme. Werte kommen aus der Umgebung, nicht von Aufrufstellen.
 *
 * NOVA_VOICE=marin
 * NOVA_VOICE_SPEED=1.1
 */

export const NOVA_VOICE_NAMES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type NovaVoiceName = (typeof NOVA_VOICE_NAMES)[number];

export const NOVA_VOICE_DEFAULTS = {
  providerId: "openai",
  model: "gpt-4o-mini-tts",
  voice: "marin" as NovaVoiceName,
  language: "de-DE",
  speed: 1.1,
  minSpeed: 0.85,
  maxSpeed: 1.5,
  responseFormat: "wav" as const,
  maxInputChars: 4000,
};

export const NOVA_VOICE_INSTRUCTIONS = [
  "You are NOVA, an adult female AI business assistant.",
  "Speak natural German (Germany), clear and composed.",
  "Warm, intelligent, calm, sovereign. Slightly futuristic, never robotic.",
  "Not a call-center agent, not a navigation device, not overly emotional.",
  "Use a natural conversational pace. Do not speak slowly or linger on words.",
  "Short pauses after sentences only. No dramatic delivery.",
  "Pronounce German names and business terms naturally:",
  "Joachim, NOVA, rankPilot (as Rank Pilot), Sponsoren, Aufgaben, Projekte.",
].join(" ");

export const NOVA_VOICE_PRONUNCIATION = [
  { from: /rank\s*pilot/gi, to: "Rank Pilot" },
  { from: /\brankPilot\b/g, to: "Rank Pilot" },
] as const;

function isVoiceName(value: string): value is NovaVoiceName {
  return (NOVA_VOICE_NAMES as readonly string[]).includes(value);
}

export function resolveVoiceName(raw?: string | null): NovaVoiceName {
  const value = (raw ?? process.env.NOVA_VOICE ?? NOVA_VOICE_DEFAULTS.voice).trim().toLowerCase();
  return isVoiceName(value) ? value : NOVA_VOICE_DEFAULTS.voice;
}

export function resolveVoiceSpeed(raw?: string | number | null): number {
  const parsed = typeof raw === "number" ? raw : Number(raw ?? process.env.NOVA_VOICE_SPEED ?? NOVA_VOICE_DEFAULTS.speed);
  if (!Number.isFinite(parsed)) return NOVA_VOICE_DEFAULTS.speed;
  return Math.min(NOVA_VOICE_DEFAULTS.maxSpeed, Math.max(NOVA_VOICE_DEFAULTS.minSpeed, parsed));
}

export function getNovaVoiceConfig() {
  return {
    providerId: NOVA_VOICE_DEFAULTS.providerId,
    model: NOVA_VOICE_DEFAULTS.model,
    voice: resolveVoiceName(),
    language: NOVA_VOICE_DEFAULTS.language,
    speed: resolveVoiceSpeed(),
    responseFormat: NOVA_VOICE_DEFAULTS.responseFormat,
    instructions: NOVA_VOICE_INSTRUCTIONS,
    pronunciation: NOVA_VOICE_PRONUNCIATION,
    maxInputChars: NOVA_VOICE_DEFAULTS.maxInputChars,
  };
}

/** @deprecated Use getNovaVoiceConfig() so env overrides apply. */
export const NOVA_VOICE_CONFIG = getNovaVoiceConfig();
