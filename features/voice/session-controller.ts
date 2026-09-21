import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";
import { MicrophoneCapture, type VoiceCapture } from "@/features/voice/capture";
import {
  INITIAL_VOICE_SESSION,
  reduceVoiceSession,
  type VoiceSessionModel,
} from "@/features/voice/session-machine";
import {
  IDLE_VOICE_SNAPSHOT,
  browserClock,
  isVoiceCapturing,
  isVoiceSessionActive,
  voiceSessionLabel,
  type VoiceClock,
  type VoiceSessionSnapshot,
  type VoiceTurn,
} from "@/features/voice/session-types";
import { isSpeechRecognitionSupported, WebSpeechStt, type SpeechToText } from "@/features/voice/stt";
import { VoiceActivityDetector, type VadFrame } from "@/features/voice/vad";

export type VoiceSessionListener = {
  onSnapshot?: (snapshot: VoiceSessionSnapshot) => void;
  onTurn?: (turn: VoiceTurn) => void;
  onInterruptNova?: () => void;
};

export type VoiceSessionDeps = {
  config?: VoiceSessionConfig;
  clock?: VoiceClock;
  createCapture?: (onTrackEnded: () => void) => VoiceCapture;
  createStt?: () => SpeechToText;
};

type PendingSpeech = {
  text: string;
  confidence?: number;
  at: number;
};

export class VoiceSessionController {
  private readonly config: VoiceSessionConfig;
  private readonly clock: VoiceClock;
  private readonly createCapture: (onTrackEnded: () => void) => VoiceCapture;
  private readonly createStt: () => SpeechToText;
  private listener: VoiceSessionListener = {};
  private model: VoiceSessionModel = { ...INITIAL_VOICE_SESSION };
  private capture: VoiceCapture | null = null;
  private stt: SpeechToText | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private vad = new VoiceActivityDetector();
  private silenceTimer: unknown = null;
  private silenceTick: unknown = null;
  private guardTimer: unknown = null;
  private transcript = "";
  private confidence: number | undefined;
  private pending: PendingSpeech | null = null;
  private level = 0;
  private lastError: string | null = null;
  private generation = 0;
  private supported = false;

  constructor(deps: VoiceSessionDeps = {}) {
    this.config = deps.config ?? VOICE_SESSION_CONFIG;
    this.clock = deps.clock ?? browserClock;
    this.createCapture =
      deps.createCapture ?? ((onTrackEnded) => new MicrophoneCapture(this.config, onTrackEnded));
    this.createStt = deps.createStt ?? (() => new WebSpeechStt(this.config, this.clock));
    this.vad = new VoiceActivityDetector(this.config);
    this.supported = typeof window === "undefined" ? false : isSpeechRecognitionSupported();
  }

  setListener(listener: VoiceSessionListener) {
    this.listener = listener;
  }

  getSnapshot(): VoiceSessionSnapshot {
    const state = this.model.state;
    return {
      state,
      active: isVoiceSessionActive(state),
      capturing: isVoiceCapturing(state),
      listening: isVoiceCapturing(state),
      userSpeaking: state === "USER_SPEAKING" || state === "INTERRUPTED",
      supported: this.supported,
      error: this.lastError,
      transcript: this.transcript,
      silenceRemainingMs: this.silenceRemaining(),
      silenceTimeoutMs: this.config.silenceTimeoutMs,
      level: this.level,
      label: voiceSessionLabel(state),
    };
  }

  async toggle() {
    if (isVoiceSessionActive(this.model.state) || this.model.state === "STARTING") {
      this.stop();
      return;
    }
    await this.start();
  }

  async start() {
    const canStart = this.model.state === "OFF" || this.model.state === "ERROR";
    if (!canStart) return;
    this.supported = this.peekSupported();
    this.dispatch({ type: "START_REQUESTED" });
    const gen = this.generation;
    try {
      if (!this.supported) {
        throw new Error("Spracheingabe ist in diesem Browser nicht verfügbar.");
      }
      this.capture = this.createCapture(() => {
        this.fail("Mikrofonverbindung verloren.");
      });
      this.stt = this.createStt();
      if (!this.stt.supported) {
        throw new Error("Spracheingabe ist in diesem Browser nicht verfügbar.");
      }
      this.unsubscribeCapture = this.capture.subscribe((frame) => this.onFrame(frame));
      await this.capture.start();
      if (gen !== this.generation || this.model.state !== "STARTING") {
        this.capture.stop();
        return;
      }
      this.vad.reset(this.clock.now());
      this.armStt();
      this.dispatch({ type: "START_READY" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice Session konnte nicht starten.";
      this.cleanupResources();
      this.lastError = permissionMessage(message);
      this.dispatch({ type: "START_FAILED", error: this.lastError });
    }
  }

  stop() {
    this.generation += 1;
    this.clearTimers();
    this.cleanupResources();
    this.transcript = "";
    this.pending = null;
    this.confidence = undefined;
    this.level = 0;
    this.lastError = this.model.state === "ERROR" ? this.lastError : null;
    this.dispatch({ type: "STOP" });
  }

  notifyProcessing() {
    if (this.model.state === "OFF" || this.model.state === "ERROR") return;
    this.pauseInput();
    this.pending = null;
    if (this.model.state !== "PROCESSING" && this.model.state !== "NOVA_SPEAKING") {
      this.dispatch({ type: "EXTERNAL_PROCESS" });
    }
  }

  notifyNovaSpeaking() {
    if (!isVoiceSessionActive(this.model.state) && this.model.state !== "PROCESSING") return;
    this.clearGuard();
    this.pauseInput();
    this.dispatch({ type: "NOVA_SPEAKING" });
  }

  notifyNovaIdle() {
    if (!isVoiceSessionActive(this.model.state) && this.model.state !== "PROCESSING") return;
    if (this.model.state === "LISTENING" || this.model.state === "USER_SPEAKING" || this.model.state === "SILENCE_WAIT") {
      return;
    }
    this.clearGuard();
    this.guardTimer = this.clock.setTimeout(() => {
      this.guardTimer = null;
      if (!isVoiceSessionActive(this.model.state) && this.model.state !== "PROCESSING" && this.model.state !== "NOVA_SPEAKING") {
        return;
      }
      this.transcript = "";
      this.pending = null;
      this.vad.releaseUtterance();
      this.dispatch({ type: "NOVA_IDLE" });
      this.armStt();
    }, this.config.postTtsGuardMs);
  }

  fail(message: string) {
    if (this.model.state === "OFF") return;
    this.generation += 1;
    this.clearTimers();
    this.cleanupResources();
    this.lastError = message;
    this.dispatch({ type: "ERROR", error: message });
  }

  dispose() {
    this.stop();
    this.listener = {};
  }

  private peekSupported() {
    try {
      return this.createStt().supported;
    } catch {
      return isSpeechRecognitionSupported();
    }
  }

  private onFrame(frame: VadFrame) {
    if (this.model.state === "NOVA_SPEAKING" && !this.config.bargeInEnabled) {
      return;
    }
    if (!isVoiceCapturing(this.model.state) && this.model.state !== "NOVA_SPEAKING") return;
    const status = this.vad.push(frame);
    this.level = status.level;
    this.emit();

    if (this.model.state === "NOVA_SPEAKING") {
      if (this.config.bargeInEnabled && status.event === "VOICE_START") {
        this.listener.onInterruptNova?.();
        this.transcript = "";
        this.pending = null;
        this.dispatch({ type: "BARGE_IN", at: frame.timestampMs });
        this.dispatch({ type: "VOICE_START", at: frame.timestampMs });
        this.armStt();
      }
      return;
    }

    if (status.event === "VOICE_START" || (status.event === "VOICE_ACTIVE" && this.model.state === "LISTENING")) {
      this.beginSpeech(frame.timestampMs);
      return;
    }
    if (status.event === "VOICE_END") {
      this.endSpeech(frame.timestampMs);
    }
  }

  private beginSpeech(at: number) {
    this.clearSilence();
    if (this.pending && at - this.pending.at <= this.config.earlySttWindowMs && !this.transcript) {
      this.transcript = this.pending.text;
      this.confidence = this.pending.confidence;
    }
    this.pending = null;
    this.dispatch({ type: "VOICE_START", at });
  }

  private endSpeech(at: number) {
    if (this.model.state !== "USER_SPEAKING") return;
    this.dispatch({ type: "VOICE_END", at });
    this.startSilenceTimer();
  }

  private startSilenceTimer() {
    this.clearSilence();
    this.silenceTimer = this.clock.setTimeout(() => {
      this.silenceTimer = null;
      this.finalizeTurn();
    }, this.config.silenceTimeoutMs);
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
    this.emit();
  }

  private tickSilence() {
    if (this.model.state !== "SILENCE_WAIT") return;
    this.emit();
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
  }

  private finalizeTurn() {
    const transcript = this.transcript.trim();
    const startedAt = this.model.turnStartedAt;
    const endedAt = this.clock.now();
    this.dispatch({ type: "SILENCE_TIMEOUT", hasTranscript: Boolean(transcript) });
    if (!transcript || this.model.state !== "PROCESSING") {
      this.transcript = "";
      this.pending = null;
      this.emit();
      return;
    }
    this.pauseInput();
    const durationMs = startedAt != null ? Math.max(0, Math.round(endedAt - startedAt)) : 0;
    const wallEnd = new Date();
    const wallStart = new Date(wallEnd.getTime() - durationMs);
    const turn: VoiceTurn = {
      transcript: transcript.slice(0, this.config.maxTranscriptChars),
      startedAt: wallStart.toISOString(),
      endedAt: wallEnd.toISOString(),
      durationMs,
      confidence: this.confidence,
      sttEngine: this.stt?.engine,
      inputMode: "voice",
    };
    this.transcript = "";
    this.pending = null;
    this.confidence = undefined;
    this.emit();
    this.listener.onTurn?.(turn);
  }

  private onSttTranscript(input: { transcript: string; confidence?: number }) {
    const now = this.clock.now();
    const text = input.transcript.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (this.model.state === "LISTENING") {
      this.pending = { text, confidence: input.confidence, at: now };
      return;
    }
    if (this.model.state === "USER_SPEAKING" || this.model.state === "SILENCE_WAIT" || this.model.state === "INTERRUPTED") {
      this.transcript = mergeTranscript(this.transcript, text);
      if (typeof input.confidence === "number") this.confidence = input.confidence;
      this.emit();
    }
  }

  private armStt() {
    if (!this.stt) return;
    this.stt.start({
      onTranscript: (input) => this.onSttTranscript(input),
      onError: (message, fatal) => {
        if (fatal) this.fail(message);
      },
    });
  }

  private pauseInput() {
    this.clearSilence();
    this.stt?.pause();
  }

  private silenceRemaining(): number | null {
    if (this.model.state !== "SILENCE_WAIT" || this.model.lastVoiceEndAt == null) return null;
    return Math.max(0, this.config.silenceTimeoutMs - (this.clock.now() - this.model.lastVoiceEndAt));
  }

  private dispatch(event: Parameters<typeof reduceVoiceSession>[1]) {
    this.model = reduceVoiceSession(this.model, event);
    this.emit();
  }

  private emit() {
    this.listener.onSnapshot?.(this.getSnapshot());
  }

  private clearSilence() {
    if (this.silenceTimer != null) {
      this.clock.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.silenceTick != null) {
      this.clock.clearTimeout(this.silenceTick);
      this.silenceTick = null;
    }
  }

  private clearGuard() {
    if (this.guardTimer != null) {
      this.clock.clearTimeout(this.guardTimer);
      this.guardTimer = null;
    }
  }

  private clearTimers() {
    this.clearSilence();
    this.clearGuard();
  }

  private cleanupResources() {
    this.unsubscribeCapture?.();
    this.unsubscribeCapture = null;
    this.stt?.stop();
    this.stt = null;
    this.capture?.stop();
    this.capture = null;
    this.vad.reset(this.clock.now());
  }
}

function mergeTranscript(current: string, next: string): string {
  const a = current.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  if (a.endsWith(b)) return a;
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

function permissionMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("permission") || lower.includes("not allowed") || lower.includes("denied")) {
    return "Mikrofonzugriff wurde verweigert.";
  }
  return message;
}

export { IDLE_VOICE_SNAPSHOT };
