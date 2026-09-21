export type SpeechViseme =
  | "REST"
  | "A"
  | "E"
  | "I"
  | "O"
  | "U"
  | "M_B_P"
  | "F_V"
  | "L"
  | "S_Z"
  | "SH_CH"
  | "R"
  | "TH"
  | "W_Q";

export type SpeechEmotion = "neutral" | "positive" | "focused" | "concerned";

export type TimedViseme = {
  viseme: SpeechViseme;
  startMs: number;
  endMs: number;
};

export type VoiceSynthesizeInput = {
  text: string;
  language?: string;
  signal?: AbortSignal;
};

export type VoiceSynthesizeResult = {
  audio: Buffer;
  mimeType: string;
  durationMs?: number;
  visemes?: TimedViseme[];
  provider: string;
  model: string;
  voice: string;
};

export type VoiceHealthCheckResult = {
  ok: boolean;
  provider: string;
  model: string;
  voice: string;
  message: string;
};

export interface VoiceProvider {
  id: string;
  name: string;
  synthesize(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult>;
  stop(): void;
  healthCheck(): Promise<VoiceHealthCheckResult>;
}

export type SpectralBands = {
  bass: number;
  low: number;
  mid: number;
  high: number;
  sibilant: number;
};

export class VoiceUnavailableError extends Error {
  constructor(message = "Sprachausgabe momentan nicht verfügbar.") {
    super(message);
    this.name = "VoiceUnavailableError";
  }
}
