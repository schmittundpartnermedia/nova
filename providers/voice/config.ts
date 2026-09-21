/**
 * Zentrale NOVA-Stimme. Nicht an Aufrufstellen hardcoden.
 */
export const NOVA_VOICE_CONFIG = {
  providerId: "openai",
  model: "gpt-4o-mini-tts",
  voice: "coral",
  language: "de-DE",
  speed: 1.0,
  responseFormat: "wav" as const,
  instructions: [
    "You are NOVA, an adult female AI business assistant.",
    "Speak natural German (Germany), clear and composed.",
    "Warm, intelligent, calm, sovereign. Slightly futuristic, never robotic.",
    "Not a call-center agent, not a navigation device, not overly emotional.",
    "Moderate pace, clean articulation, short pauses after sentences.",
    "Pronounce German names and business terms naturally:",
    "Joachim, NOVA, rankPilot (as Rank Pilot), Sponsoren, Aufgaben, Projekte.",
  ].join(" "),
  pronunciation: [
    { from: /rank\s*pilot/gi, to: "Rank Pilot" },
    { from: /\brankPilot\b/g, to: "Rank Pilot" },
  ],
  maxInputChars: 4000,
} as const;

export type NovaVoiceConfig = typeof NOVA_VOICE_CONFIG;
