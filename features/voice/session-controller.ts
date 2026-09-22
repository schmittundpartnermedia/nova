import { isVoiceCaptureSupported, MicrophoneCapture, type VoiceCapture } from "@/features/voice/capture";
import { HttpLiveStt, type LiveStt, type LiveSttEvent } from "@/features/voice/live-stt";
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
  createLiveStt?: () => LiveStt;
};

export class VoiceSessionController {
  private readonly config: VoiceSessionConfig;
  private readonly clock: VoiceClock;
  private readonly createCapture: (onTrackEnded: () => void) => VoiceCapture;
  private readonly createLiveStt: () => LiveStt;
  private readonly injectedCapture: boolean;
  private listener: VoiceSessionListener = {};
  private model: VoiceSessionModel = { ...INITIAL_VOICE_SESSION };
  private capture: VoiceCapture | null = null;
  private liveStt: LiveStt | null = null;
  private unsubscribeCapture: (() => void) | null = null;
  private unsubscribePcm: (() => void) | null = null;
  private vad = new VoiceActivityDetector();
  private silenceTick: unknown = null;
  private guardTimer: unknown = null;
  private level = 0;
  private lastError: string | null = null;
  private generation = 0;
  private supported = false;
  private transcript = "";
  private turnStartedAt: number | null = null;
  private finalizing = false;

  constructor(deps: VoiceSessionDeps = {}) {
    this.config = deps.config ?? VOICE_SESSION_CONFIG;
    this.clock = deps.clock ?? browserClock;
    this.injectedCapture = Boolean(deps.createCapture);
    this.createCapture =
      deps.createCapture ?? ((onTrackEnded) => new MicrophoneCapture(this.config, onTrackEnded));
    this.createLiveStt = deps.createLiveStt ?? (() => new HttpLiveStt());
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
      this.liveStt = this.createLiveStt();
      this.unsubscribeCapture = this.capture.subscribe((frame) => this.onFrame(frame));
      this.unsubscribePcm = this.capture.subscribePcm((samples) => this.liveStt?.sendPcm(samples));
      this.capture.setCollecting(true);
      await this.capture.start();
      if (gen !== this.generation || this.model.state !== "STARTING") {
        this.capture.stop();
        return;
      }
      await this.liveStt.start((event) => this.onLiveStt(event));
      if (gen !== this.generation || this.model.state !== "STARTING") {
        this.cleanupResources();
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
    this.turnStartedAt = null;
    this.finalizing = false;
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
      this.turnStartedAt = null;
      this.vad.wake(this.clock.now());
      this.capture?.setCollecting(true);
      this.liveStt?.setPaused(false);
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

  private onLiveStt(event: LiveSttEvent) {
    if (event.type === "error") {
      this.fail(event.message);
      return;
    }
    if (this.model.state === "NOVA_SPEAKING" || this.model.state === "PROCESSING") return;

    if (event.type === "speech_started") {
      this.beginSpeech(this.clock.now());
      return;
    }
    if (event.type === "delta") {
      if (this.model.state === "LISTENING") this.beginSpeech(this.clock.now());
      this.transcript = `${this.transcript}${event.delta}`.slice(0, this.config.maxTranscriptChars);
      this.emit();
      return;
    }
    if (event.type === "speech_stopped") {
      this.endSpeech(this.clock.now());
      return;
    }
    if (event.type === "completed") {
      this.finishWithTranscript(event.transcript);
    }
  }

  private onFrame(frame: VadFrame) {
    if (!isVoiceCapturing(this.model.state) && this.model.state !== "NOVA_SPEAKING") return;
    const status = this.vad.push(frame);
    this.level = Math.max(0, Math.min(1, status.level / 0.12));
    this.emit();
  }

  private beginSpeech(at: number) {
    if (this.turnStartedAt == null) this.turnStartedAt = at;
    if (this.model.state === "LISTENING" || this.model.state === "SILENCE_WAIT" || this.model.state === "INTERRUPTED") {
      this.dispatch({ type: "VOICE_START", at });
    }
    this.armSilenceUi();
  }

  private endSpeech(at: number) {
    if (this.model.state !== "USER_SPEAKING") return;
    this.dispatch({ type: "VOICE_END", at });
    this.armSilenceUi();
  }

  private finishWithTranscript(raw: string) {
    if (this.finalizing) return;
    const transcript = raw.replace(/\s+/g, " ").trim() || this.transcript.replace(/\s+/g, " ").trim();
    const inTurn = this.model.state === "SILENCE_WAIT" || this.model.state === "USER_SPEAKING" || Boolean(transcript);
    if (!inTurn && this.model.state !== "LISTENING") return;
    if (!transcript) {
      this.transcript = "";
      this.turnStartedAt = null;
      if (this.model.state === "USER_SPEAKING" || this.model.state === "SILENCE_WAIT") {
        this.dispatch({ type: "SILENCE_TIMEOUT", hasTranscript: false });
      }
      this.emit();
      return;
    }
    if (this.model.state === "LISTENING" && transcript) {
      const now = this.clock.now();
      this.dispatch({ type: "VOICE_START", at: this.turnStartedAt ?? now });
      this.dispatch({ type: "VOICE_END", at: now });
    }
    this.finalizing = true;
    const startedAt = this.turnStartedAt ?? this.clock.now();
    const endedAt = this.clock.now();
    this.pauseInput();
    this.dispatch({ type: "SILENCE_TIMEOUT", hasTranscript: true });
    if (this.model.state !== "PROCESSING") {
      this.finalizing = false;
      return;
    }
    const durationMs = Math.max(0, Math.round(endedAt - startedAt));
    const wallEnd = new Date();
    const wallStart = new Date(wallEnd.getTime() - durationMs);
    const turn: VoiceTurn = {
      transcript: transcript.slice(0, this.config.maxTranscriptChars),
      startedAt: wallStart.toISOString(),
      endedAt: wallEnd.toISOString(),
      durationMs,
      sttEngine: "realtime",
      inputMode: "voice",
    };
    this.transcript = "";
    this.turnStartedAt = null;
    this.finalizing = false;
    this.emit();
    this.listener.onTurn?.(turn);
  }

  private pauseInput() {
    this.clearSilence();
    this.capture?.setCollecting(false);
    this.liveStt?.setPaused(true);
  }

  private armSilenceUi() {
    this.clearSilence();
    if (this.model.state !== "SILENCE_WAIT") return;
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
    this.emit();
  }

  private tickSilence() {
    if (this.model.state !== "SILENCE_WAIT") return;
    this.emit();
    this.silenceTick = this.clock.setTimeout(() => this.tickSilence(), this.config.silenceUiTickMs);
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
    this.unsubscribePcm?.();
    this.unsubscribePcm = null;
    this.liveStt?.stop();
    this.liveStt = null;
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
