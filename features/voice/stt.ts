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

function recognitionResult(
  results: SpeechRecognitionEventLike["results"],
  index: number,
): SpeechRecognitionResultLike | undefined {
  const list = results as SpeechRecognitionEventLike["results"] & {
    item?: (i: number) => SpeechRecognitionResultLike | undefined;
  };
  return list.item?.(index) ?? list[index];
}

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
  private booting = false;
  private resultCursor = 0;
  private committed = "";
  private interim = "";

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
    this.resetBuffer();
    if (this.rec) this.kickStart();
    else this.boot();
  }

  stop() {
    this.wanted = false;
    this.paused = false;
    this.clearRestart();
    this.resetBuffer();
    this.tearDown();
  }

  pause() {
    this.paused = true;
    this.resetBuffer();
  }

  resume() {
    if (!this.wanted) return;
    this.paused = false;
    this.resetBuffer();
    if (!this.rec) this.boot();
    else this.kickStart();
  }

  private resetBuffer() {
    this.committed = "";
    this.interim = "";
  }

  private boot() {
    if (!this.wanted || !this.Ctor || this.booting) return;
    this.booting = true;
    this.tearDown();
    this.resultCursor = 0;
    const rec = new this.Ctor();
    rec.lang = this.config.sttLang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => this.handleResult(event);
    rec.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "aborted" || code === "no-speech") return;
      const fatal = FATAL_STT_ERRORS.has(code);
      if (!this.paused) this.listener.onError?.(sttErrorMessage(code), fatal);
      if (fatal) {
        this.wanted = false;
        this.tearDown();
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.commitInterim();
      this.resultCursor = 0;
      if (!this.wanted) return;
      // WKWebView continues recognition only if start() runs from onend on
      // the same instance. A new SpeechRecognition from a timer has no
      // user-gesture and will not restart after TTS.
      this.kickStart();
    };
    this.rec = rec;
    this.kickStart();
    this.booting = false;
  }

  private kickStart() {
    if (!this.wanted || !this.rec) return;
    this.clearRestart();
    try {
      this.rec.start();
    } catch (error) {
      if (isBenignStartError(error)) return;
      this.scheduleRestart();
    }
  }

  private handleResult(event: SpeechRecognitionEventLike) {
    const length = event.results.length;
    if (this.paused) {
      this.resultCursor = length;
      return;
    }
    const start = Math.max(
      typeof event.resultIndex === "number" ? event.resultIndex : 0,
      this.resultCursor,
    );
    let sawInterim = false;
    for (let i = start; i < length; i += 1) {
      const result = recognitionResult(event.results, i);
      const alt = result?.[0];
      const text = alt?.transcript ?? "";
      if (!text) continue;
      const isFinal = result?.isFinal === true;
      if (isFinal) {
        this.committed = `${this.committed} ${text}`.replace(/\s+/g, " ").trim();
        this.interim = "";
      } else {
        this.interim = text.trim();
        sawInterim = true;
      }
    }
    if (!sawInterim && start < length) {
      const last = recognitionResult(event.results, length - 1);
      if (last && last.isFinal !== true) {
        this.interim = last[0]?.transcript?.trim() ?? this.interim;
      }
    }
    this.resultCursor = length;
    this.emitCurrent(event);
  }

  private emitCurrent(event?: SpeechRecognitionEventLike) {
    const transcript = `${this.committed} ${this.interim}`.replace(/\s+/g, " ").trim();
    if (!transcript) return;
    let confidenceSum = 0;
    let confidenceCount = 0;
    if (event) {
      for (let i = 0; i < event.results.length; i += 1) {
        const alt = recognitionResult(event.results, i)?.[0];
        if (typeof alt?.confidence === "number" && Number.isFinite(alt.confidence)) {
          confidenceSum += alt.confidence;
          confidenceCount += 1;
        }
      }
    }
    this.listener.onTranscript?.({
      transcript,
      confidence: confidenceCount ? confidenceSum / confidenceCount : undefined,
      isFinal: Boolean(this.committed) && !this.interim,
    });
  }

  private commitInterim() {
    if (this.paused || !this.interim) return;
    this.committed = `${this.committed} ${this.interim}`.replace(/\s+/g, " ").trim();
    this.interim = "";
    this.emitCurrent();
  }

  private scheduleRestart() {
    this.clearRestart();
    this.restartTimer = this.clock.setTimeout(() => {
      this.restartTimer = null;
      if (!this.wanted) return;
      if (this.rec) this.kickStart();
      else this.boot();
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

function isBenignStartError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "InvalidStateError" || message.toLowerCase().includes("invalid state");
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
