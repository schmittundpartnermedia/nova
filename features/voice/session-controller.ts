import { isVoiceCaptureSupported, MicrophoneCapture, type VoiceCapture } from "@/features/voice/capture";
import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";
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
import { transcribeUtterance as transcribeUtteranceRequest } from "@/features/voice/transcribe";
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
  transcribeUtterance?: (blob: Blob) => Promise<string>;
};

export class VoiceSessionController {
  private readonly config: VoiceSessionConfig;
  private readonly clock: VoiceClock;
  private readonly createCapture: (onTrackEnded: () => void) => VoiceCapture;
  private readonly injectedCapture: boolean;
  private readonly transcribeUtterance: (blob: Blob) => Promise<string>;
  private listener: VoiceSessionListener = {};
  private model: VoiceSessionModel = { ...INITIAL_VOICE_SESSION };
  private capture: VoiceCapture | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private vad = new VoiceActivityDetector();
  private silenceTimer: unknown = null;
  private silenceTick: unknown = null;
  private guardTimer: unknown = null;
  private level = 0;
  private lastError: string | null = null;
  private generation = 0;
  private supported = false;
  private transcript = "";
  private lastTurnActivityAt: number | null = null;
  private tentativeResumeAt: number | null = null;
  private utteranceFromMs: number | null = null;
  private finalizing = false;
  private pendingTranscript: Promise<string> | null = null;
  private bargeInSince: number | null = null;
  private bargeInSpeechMs = 0;

  constructor(deps: VoiceSessionDeps = {}) {
    this.config = deps.config ?? VOICE_SESSION_CONFIG;
    this.clock = deps.clock ?? browserClock;
    this.injectedCapture = Boolean(deps.createCapture);
    this.createCapture =
      deps.createCapture ?? ((onTrackEnded) => new MicrophoneCapture(this.config, onTrackEnded));
    this.transcribeUtterance = deps.transcribeUtterance ?? transcribeUtteranceRequest;
    this.vad = new VoiceActivityDetector(this.config);
    this.supported = this.peekSupported();
  }

  setListener(listener: VoiceSessionListener) {
    this.listener = listener;
  }

  getSnapshot(): VoiceSessionSnapshot {
    const state = this.model.state;
    return {
      state,
      active: isVoiceSessionActive(state),
      capturing: isVoiceCapturing(state) || (state === "NOVA_SPEAKING" && this.config.bargeInEnabled),
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
    this.warmupTranscribe();
    try {
      if (!this.supported) {
        throw new Error("Spracheingabe ist in diesem Browser nicht verfügbar.");
      }
      this.capture = this.createCapture(() => {
        this.fail("Mikrofonverbindung verloren.");
      });
      this.unsubscribeCapture = this.capture.subscribe((frame) => this.onFrame(frame));
      this.capture.setCollecting(true);
      await this.capture.start();
      if (gen !== this.generation || this.model.state !== "STARTING") {
        this.capture.stop();
        return;
      }
      this.vad.reset(this.clock.now());
      this.transcript = "";
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
    this.level = 0;
    this.transcript = "";
    this.lastTurnActivityAt = null;
    this.tentativeResumeAt = null;
    this.utteranceFromMs = null;
    this.pendingTranscript = null;
    this.finalizing = false;
    this.bargeInSince = null;
    this.bargeInSpeechMs = 0;
    this.lastError = this.model.state === "ERROR" ? this.lastError : null;
    this.dispatch({ type: "STOP" });
  }

  notifyProcessing() {
    if (this.model.state === "OFF" || this.model.state === "ERROR") return;
    this.pauseInput();
    if (this.model.state !== "PROCESSING" && this.model.state !== "NOVA_SPEAKING") {
      this.dispatch({ type: "EXTERNAL_PROCESS" });
    }
  }

  notifyNovaSpeaking() {
    if (!isVoiceSessionActive(this.model.state) && this.model.state !== "PROCESSING") return;
    this.clearGuard();
    if (this.config.bargeInEnabled) {
      this.capture?.setCollecting(true);
      this.bargeInSince = this.clock.now();
      this.bargeInSpeechMs = 0;
      this.vad.wake(this.clock.now());
    } else {
      this.pauseInput();
    }
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
      this.lastTurnActivityAt = null;
      this.tentativeResumeAt = null;
      this.utteranceFromMs = null;
      this.pendingTranscript = null;
      this.vad.wake(this.clock.now());
      this.capture?.setCollecting(true);
      this.dispatch({ type: "NOVA_IDLE" });
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
    return this.injectedCapture || isVoiceCaptureSupported();
  }

  private warmupTranscribe() {
    if (typeof window === "undefined" || typeof fetch !== "function") return;
    void fetch("/api/nova/transcribe", { method: "GET", cache: "no-store" }).catch(() => undefined);
    void fetch("/api/nova/speech", { method: "GET", cache: "no-store" }).catch(() => undefined);
  }

  private onFrame(frame: VadFrame) {
    if (this.model.state === "PROCESSING") return;
    if (this.model.state === "NOVA_SPEAKING") {
      this.considerBargeIn(frame);
      return;
    }
    if (!isVoiceCapturing(this.model.state)) return;
    const status = this.vad.push(frame);
    this.level = Math.max(0, Math.min(1, status.level / 0.12));
    this.emit();

    if (this.model.state === "USER_SPEAKING" && status.speechLikely) {
      this.noteSpeechProgress(frame.timestampMs);
    }
    if (status.event === "VOICE_START" || (status.event === "VOICE_ACTIVE" && this.model.state === "LISTENING")) {
      this.beginSpeech(frame.timestampMs);
      return;
    }
    if (status.event === "VOICE_END") {
      this.endSpeech(frame.timestampMs);
    }
  }

  private considerBargeIn(frame: VadFrame) {
    if (!this.config.bargeInEnabled || this.model.state !== "NOVA_SPEAKING") return;
    const energy = Math.max(frame.rms, frame.peak * 0.45);
    this.level = Math.max(0, Math.min(1, energy / 0.12));
    this.emit();
    const started = this.bargeInSince ?? frame.timestampMs;
    if (frame.timestampMs - started < this.config.bargeInWarmupMs) return;
    const speech = frame.rms >= this.config.bargeInMinSpeechRms && frame.peak >= this.config.bargeInMinSpeechPeak;
    if (!speech) {
      this.bargeInSpeechMs = 0;
      return;
    }
    const dt = 20;
    this.bargeInSpeechMs += dt;
    if (this.bargeInSpeechMs < this.config.bargeInMinSpeechMs) return;
    this.bargeInSpeechMs = 0;
    this.bargeInSince = null;
    this.dispatch({ type: "BARGE_IN", at: frame.timestampMs });
    this.beginSpeech(frame.timestampMs);
    this.listener.onInterruptNova?.();
  }

  private beginSpeech(at: number) {
    if (this.model.state === "SILENCE_WAIT") {
      this.tentativeResumeAt = at;
      this.pendingTranscript = null;
    } else {
      this.markTurnActivity(at);
      if (this.utteranceFromMs == null) this.utteranceFromMs = at - this.config.preRollMs;
    }
    this.dispatch({ type: "VOICE_START", at });
    this.scheduleTurnWatchdog();
  }

  private noteSpeechProgress(at: number) {
    if (this.tentativeResumeAt != null) {
      if (at - this.tentativeResumeAt >= this.config.silenceResumeConfirmMs) {
        this.markTurnActivity(at);
      }
      return;
    }
    this.markTurnActivity(at);
  }

  private endSpeech(at: number) {
    if (this.model.state !== "USER_SPEAKING") return;
    this.tentativeResumeAt = null;
    this.dispatch({ type: "VOICE_END", at });
    this.kickTranscribe();
    this.scheduleTurnWatchdog();
  }

  private markTurnActivity(at: number) {
    this.lastTurnActivityAt = at;
    this.tentativeResumeAt = null;
    if (this.model.state === "USER_SPEAKING" || this.model.state === "SILENCE_WAIT") {
      this.scheduleTurnWatchdog();
    }
  }

  private scheduleTurnWatchdog() {
    this.clearSilence();
    if (this.model.state !== "USER_SPEAKING" && this.model.state !== "SILENCE_WAIT") return;
    const origin = this.lastTurnActivityAt;
    if (origin == null) return;
    const remaining = this.config.silenceTimeoutMs - (this.clock.now() - origin);
    this.silenceTimer = this.clock.setTimeout(() => {
      this.silenceTimer = null;
      this.onTurnWatchdog();
    }, Math.max(0, remaining));
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
    this.emit();
  }

  private onTurnWatchdog() {
    if (this.model.state !== "SILENCE_WAIT" && this.model.state !== "USER_SPEAKING") return;
    const origin = this.lastTurnActivityAt;
    if (origin == null) return;
    if (this.clock.now() - origin < this.config.silenceTimeoutMs) {
      this.scheduleTurnWatchdog();
      return;
    }
    void this.finalizeTurn();
  }

  private tickSilence() {
    if (this.model.state !== "SILENCE_WAIT") return;
    this.emit();
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
  }

  private kickTranscribe() {
    if (this.pendingTranscript) return;
    const generation = this.generation;
    const from = this.utteranceFromMs ?? this.clock.now() - 1000;
    const to = (this.lastTurnActivityAt ?? this.clock.now()) + this.config.postRollMs;
    this.pendingTranscript = this.sliceAndTranscribe(from, to).then((text) => {
      if (generation !== this.generation) return "";
      if (text) {
        this.transcript = text.slice(0, this.config.maxTranscriptChars);
        this.emit();
      }
      return text;
    });
  }

  private async sliceAndTranscribe(from: number, to: number): Promise<string> {
    try {
      const blob = await this.capture?.sliceUtterance(from, Math.min(to, from + this.config.maxUtteranceMs));
      if (!blob) return "";
      return (await this.transcribeUtterance(blob)).trim();
    } catch {
      return "";
    }
  }

  private async finalizeTurn() {
    if (this.finalizing) return;
    const inTurn = this.model.state === "SILENCE_WAIT" || this.model.state === "USER_SPEAKING";
    if (!inTurn) return;
    this.finalizing = true;
    const generation = this.generation;
    const startedAt = this.utteranceFromMs ?? this.model.turnStartedAt;
    const endedAt = this.clock.now();
    if (!this.pendingTranscript) this.kickTranscribe();
    let transcript = "";
    try {
      transcript = ((await this.pendingTranscript) ?? "").trim();
    } catch {
      transcript = "";
    }
    if (generation !== this.generation) return;
    this.pendingTranscript = null;
    this.pauseInput();
    this.transcript = transcript.slice(0, this.config.maxTranscriptChars);
    this.dispatch({ type: "SILENCE_TIMEOUT", hasTranscript: Boolean(transcript) });
    if (!transcript || this.model.state !== "PROCESSING") {
      this.lastTurnActivityAt = null;
      this.tentativeResumeAt = null;
      this.utteranceFromMs = null;
      this.finalizing = false;
      this.vad.wake(this.clock.now());
      this.capture?.setCollecting(true);
      this.emit();
      return;
    }
    const durationMs = startedAt != null ? Math.max(0, Math.round(endedAt - startedAt)) : 0;
    const wallEnd = new Date();
    const wallStart = new Date(wallEnd.getTime() - durationMs);
    const turn: VoiceTurn = {
      transcript: this.transcript,
      startedAt: wallStart.toISOString(),
      endedAt: wallEnd.toISOString(),
      durationMs,
      sttEngine: "whisper",
      inputMode: "voice",
    };
    this.lastTurnActivityAt = null;
    this.tentativeResumeAt = null;
    this.utteranceFromMs = null;
    this.finalizing = false;
    this.emit();
    this.listener.onTurn?.(turn);
  }

  private pauseInput() {
    this.clearSilence();
    this.tentativeResumeAt = null;
    this.capture?.setCollecting(false);
  }

  private silenceRemaining(): number | null {
    if (this.model.state !== "SILENCE_WAIT" || this.lastTurnActivityAt == null) return null;
    return Math.max(0, this.config.silenceTimeoutMs - (this.clock.now() - this.lastTurnActivityAt));
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
    this.capture?.stop();
    this.capture = null;
    this.vad.reset(this.clock.now());
  }
}

function permissionMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("permission") || lower.includes("not allowed") || lower.includes("denied")) {
    return "Mikrofonzugriff wurde verweigert.";
  }
  return message;
}

export { IDLE_VOICE_SNAPSHOT };
