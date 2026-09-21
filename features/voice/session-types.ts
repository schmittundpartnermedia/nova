export type VoiceSessionState =
  | "OFF"
  | "STARTING"
  | "LISTENING"
  | "USER_SPEAKING"
  | "SILENCE_WAIT"
  | "PROCESSING"
  | "NOVA_SPEAKING"
  | "INTERRUPTED"
  | "ERROR";

export type VoiceSessionLabel = "ZUHÖREN" | "ICH HÖRE ZU" | "DENKEN" | "NOVA SPRICHT";

export type VoiceTurn = {
  transcript: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  conversationId?: string;
  organizationId?: string;
  confidence?: number;
  sttEngine?: string;
  inputMode: "voice";
};

export type VoiceSessionSnapshot = {
  state: VoiceSessionState;
  active: boolean;
  capturing: boolean;
  listening: boolean;
  userSpeaking: boolean;
  supported: boolean;
  error: string | null;
  transcript: string;
  silenceRemainingMs: number | null;
  silenceTimeoutMs: number;
  level: number;
  label: VoiceSessionLabel | null;
};

export type VoiceClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

export const browserClock: VoiceClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function voiceSessionLabel(state: VoiceSessionState): VoiceSessionLabel | null {
  switch (state) {
    case "STARTING":
    case "LISTENING":
    case "SILENCE_WAIT":
      return "ZUHÖREN";
    case "USER_SPEAKING":
    case "INTERRUPTED":
      return "ICH HÖRE ZU";
    case "PROCESSING":
      return "DENKEN";
    case "NOVA_SPEAKING":
      return "NOVA SPRICHT";
    default:
      return null;
  }
}

export function isVoiceSessionActive(state: VoiceSessionState): boolean {
  return state !== "OFF" && state !== "ERROR";
}

export function isVoiceCapturing(state: VoiceSessionState): boolean {
  return state === "LISTENING" || state === "USER_SPEAKING" || state === "SILENCE_WAIT" || state === "INTERRUPTED";
}

export const IDLE_VOICE_SNAPSHOT: VoiceSessionSnapshot = {
  state: "OFF",
  active: false,
  capturing: false,
  listening: false,
  userSpeaking: false,
  supported: false,
  error: null,
  transcript: "",
  silenceRemainingMs: null,
  silenceTimeoutMs: 5000,
  level: 0,
  label: null,
};
