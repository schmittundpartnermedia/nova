import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";
import type { VoiceClock } from "@/features/voice/session-types";
import { browserClock } from "@/features/voice/session-types";

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal?: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export type SpeechToTextListener = {
  onTranscript?: (input: { transcript: string; confidence?: number; isFinal: boolean }) => void;
  onError?: (message: string, fatal: boolean) => void;
};

export type SpeechToText = {
  readonly supported: boolean;
  readonly engine: string;
  start(listener: SpeechToTextListener): void;
  stop(): void;
  pause(): void;
  resume(): void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const g = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    window?: {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
  };
  return (
    g.SpeechRecognition ??
    g.webkitSpeechRecognition ??
    g.window?.SpeechRecognition ??
    g.window?.webkitSpeechRecognition ??
    null
  );
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

const FATAL_STT_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

export class WebSpeechStt implements SpeechToText {
  readonly supported: boolean;
  readonly engine = "web-speech";
  private readonly config: VoiceSessionConfig;
  private readonly clock: VoiceClock;
  private readonly Ctor: SpeechRecognitionCtor | null;
  private rec: SpeechRecognitionLike | null = null;
  private listener: SpeechToTextListener = {};
  private wanted = false;
  private paused = false;
  private restartTimer: unknown = null;

  constructor(config: VoiceSessionConfig = VOICE_SESSION_CONFIG, clock: VoiceClock = browserClock) {
    this.config = config;
    this.clock = clock;
    this.Ctor = getSpeechRecognitionCtor();
    this.supported = Boolean(this.Ctor);
  }

  start(listener: SpeechToTextListener) {
    this.listener = listener;
    this.wanted = true;
    this.paused = false;
    this.boot();
  }

  stop() {
    this.wanted = false;
    this.paused = false;
    this.clearRestart();
    this.tearDown();
  }

  pause() {
    this.paused = true;
    this.clearRestart();
    this.tearDown();
  }

  resume() {
    if (!this.wanted) return;
    this.paused = false;
    this.boot();
  }

  private boot() {
    if (!this.wanted || this.paused || !this.Ctor) return;
    this.tearDown();
    const rec = new this.Ctor();
    rec.lang = this.config.sttLang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => this.handleResult(event);
    rec.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "aborted" || code === "no-speech") return;
      const fatal = FATAL_STT_ERRORS.has(code);
      this.listener.onError?.(sttErrorMessage(code), fatal);
      if (fatal) {
        this.wanted = false;
        this.tearDown();
      }
    };
    rec.onend = () => {
      if (!this.wanted || this.paused) return;
      this.scheduleRestart();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.scheduleRestart();
    }
  }

  private handleResult(event: SpeechRecognitionEventLike) {
    if (!this.wanted || this.paused) return;
    let finals = "";
    let interim = "";
    let confidenceSum = 0;
    let confidenceCount = 0;
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alt = result?.[0];
      const text = alt?.transcript ?? "";
      if (!text) continue;
      if (typeof alt?.confidence === "number" && Number.isFinite(alt.confidence)) {
        confidenceSum += alt.confidence;
        confidenceCount += 1;
      }
      if (result.isFinal) finals += `${text} `;
      else interim += `${text} `;
    }
    const transcript = `${finals}${interim}`.replace(/\s+/g, " ").trim();
    if (!transcript) return;
    this.listener.onTranscript?.({
      transcript,
      confidence: confidenceCount ? confidenceSum / confidenceCount : undefined,
      isFinal: Boolean(finals.trim()) && !interim.trim(),
    });
  }

  private scheduleRestart() {
    this.clearRestart();
    this.restartTimer = this.clock.setTimeout(() => {
      this.restartTimer = null;
      if (this.wanted && !this.paused) this.boot();
    }, this.config.sttRestartDelayMs);
  }

  private clearRestart() {
    if (this.restartTimer != null) {
      this.clock.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private tearDown() {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort?.();
      } catch {
        // already stopped
      }
    }
  }
}

function sttErrorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Mikrofonzugriff wurde verweigert.";
  }
  if (code === "audio-capture") {
    return "Mikrofon ist nicht verfügbar.";
  }
  return "Spracheingabe ist fehlgeschlagen.";
}
