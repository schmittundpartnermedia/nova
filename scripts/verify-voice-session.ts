import { encodeWavPcm16, PcmSlicer } from "@/features/voice/pcm";
import { VOICE_SESSION_CONFIG } from "@/features/voice/session-config";
import { VoiceSessionController } from "@/features/voice/session-controller";
import {
  INITIAL_VOICE_SESSION,
  reduceVoiceSession,
} from "@/features/voice/session-machine";
import type { VoiceClock, VoiceTurn } from "@/features/voice/session-types";
import type { VoiceCapture } from "@/features/voice/capture";
import {
  makeNoiseFrame,
  makeSpeechFrame,
  VoiceActivityDetector,
  type VadFrame,
} from "@/features/voice/vad";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeClock implements VoiceClock {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { at: number; fn: () => void }>();

  now() {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.nowMs + ms, fn });
    return id;
  }

  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }

  advance(ms: number) {
    const target = this.nowMs + ms;
    while (this.timers.size > 0) {
      let next: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (!next || timer.at < next.at || (timer.at === next.at && id < next.id))) {
          next = { id, at: timer.at, fn: timer.fn };
        }
      }
      if (!next) break;
      this.timers.delete(next.id);
      this.nowMs = next.at;
      next.fn();
    }
    this.nowMs = target;
  }
}

class FakeCapture implements VoiceCapture {
  listener: ((frame: VadFrame) => void) | null = null;
  started = false;
  stopped = false;
  collecting = true;
  slices = 0;

  async start() {
    this.started = true;
    this.stopped = false;
    this.collecting = true;
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.collecting = false;
  }

  setCollecting(on: boolean) {
    this.collecting = on;
  }

  subscribe(listener: (frame: VadFrame) => void) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  async sliceUtterance() {
    this.slices += 1;
    return new Blob([new Uint8Array(1200)], { type: "audio/wav" });
  }
}

function pump(capture: FakeCapture, clock: FakeClock, durationMs: number, kind: "speech" | "noise") {
  const end = clock.nowMs + durationMs;
  while (clock.nowMs < end) {
    clock.advance(20);
    capture.listener?.(kind === "speech" ? makeSpeechFrame(clock.nowMs) : makeNoiseFrame(clock.nowMs));
  }
}

export async function runVoiceSessionChecks() {
  assert(VOICE_SESSION_CONFIG.silenceTimeoutMs === 800, "silenceTimeoutMs muss 800 sein.");
  assert(VOICE_SESSION_CONFIG.bargeInEnabled === true, "Barge-In muss während NOVA spricht an sein.");
  assert(VOICE_SESSION_CONFIG.bargeInMinSpeechMs > 0, "Barge-In braucht eine Mindestsprachdauer.");
  assert(VOICE_SESSION_CONFIG.pcmSampleRate === 16000, "PCM muss 16 kHz sein.");
  assert(VOICE_SESSION_CONFIG.minSpeechDurationMs > 0, "minSpeechDurationMs zentral");
  assert(VOICE_SESSION_CONFIG.postTtsGuardMs > 0, "postTtsGuardMs zentral");

  const listening = reduceVoiceSession(INITIAL_VOICE_SESSION, { type: "START_REQUESTED" });
  assert(listening.state === "STARTING", "START_REQUESTED → STARTING");
  const ready = reduceVoiceSession(listening, { type: "START_READY" });
  assert(ready.state === "LISTENING", "START_READY → LISTENING");
  const speaking = reduceVoiceSession(ready, { type: "VOICE_START", at: 1000 });
  assert(speaking.state === "USER_SPEAKING", "VOICE_START → USER_SPEAKING");
  const waiting = reduceVoiceSession(speaking, { type: "VOICE_END", at: 2000 });
  assert(waiting.state === "SILENCE_WAIT", "VOICE_END → SILENCE_WAIT");
  const continued = reduceVoiceSession(waiting, { type: "VOICE_START", at: 2500 });
  assert(continued.state === "USER_SPEAKING", "Pause unter Timeout setzt denselben Turn fort.");
  const waitingAgain = reduceVoiceSession(continued, { type: "VOICE_END", at: 3000 });
  const empty = reduceVoiceSession(waitingAgain, { type: "SILENCE_TIMEOUT", hasTranscript: false });
  assert(empty.state === "LISTENING", "Leerer Silence-Timeout bleibt LISTENING.");
  const waitingFull = reduceVoiceSession(waitingAgain, { type: "SILENCE_TIMEOUT", hasTranscript: true });
  assert(waitingFull.state === "PROCESSING", "Silence mit Transcript → PROCESSING");
  const speakingNova = reduceVoiceSession(waitingFull, { type: "NOVA_SPEAKING" });
  assert(speakingNova.state === "NOVA_SPEAKING", "PROCESSING → NOVA_SPEAKING");
  const barged = reduceVoiceSession(speakingNova, { type: "BARGE_IN", at: 4000 });
  assert(barged.state === "INTERRUPTED", "BARGE_IN → INTERRUPTED");
  const afterBarge = reduceVoiceSession(barged, { type: "VOICE_START", at: 4010 });
  assert(afterBarge.state === "USER_SPEAKING", "Nach Barge-In weiter USER_SPEAKING");

  const vad = new VoiceActivityDetector();
  vad.reset(0);
  let last = vad.push(makeNoiseFrame(0));
  for (let t = 20; t <= 400; t += 20) last = vad.push(makeNoiseFrame(t));
  assert(last.event === "SILENCE", `Warmup/Noise darf keine Stimme sein, war ${last.event}`);
  let started = false;
  for (let t = 420; t <= 900; t += 20) {
    last = vad.push(makeSpeechFrame(t));
    if (last.event === "VOICE_START") started = true;
  }
  assert(started, "VAD muss VOICE_START bei Sprache erkennen.");

  const ring = new PcmSlicer(16000, 2);
  const block = new Float32Array(1600);
  for (let i = 0; i < block.length; i += 1) block[i] = i % 2 === 0 ? 0.5 : -0.5;
  ring.appendMono(block, 16000, 1000);
  const sliced = ring.slice(1000, 1100);
  assert(sliced.length >= 1400 && sliced.length <= 1800, `PCM-Slice Länge, war ${sliced.length}`);
  const wav = encodeWavPcm16(sliced, 16000);
  assert(wav.type === "audio/wav", "WAV MIME");

  const clock = new FakeClock();
  const capture = new FakeCapture();
  const turns: VoiceTurn[] = [];
  const transcripts: string[] = ["Hallo NOVA, gib mir den Status.", "Nächster Beitrag ohne Klick.", "Dritter Beitrag ohne Klick."];
  let transcribeCalls = 0;
  const controller = new VoiceSessionController({
    clock,
    createCapture: () => capture,
    transcribeUtterance: async () => {
      const text = transcripts[transcribeCalls] ?? "";
      transcribeCalls += 1;
      return text;
    },
  });
  controller.setListener({ onTurn: (turn) => turns.push(turn) });

  await controller.start();
  assert(controller.getSnapshot().state === "LISTENING", `Start muss LISTENING sein, war ${controller.getSnapshot().state}`);
  assert(capture.started, "Capture muss laufen.");

  clock.advance(30_000);
  assert(turns.length === 0, "Ohne Sprache keinen Turn.");

  pump(capture, clock, 400, "noise");
  pump(capture, clock, 500, "speech");
  assert(controller.getSnapshot().state === "USER_SPEAKING", `Sprache muss USER_SPEAKING sein, war ${controller.getSnapshot().state}`);
  pump(capture, clock, 320, "noise");
  assert(controller.getSnapshot().state === "SILENCE_WAIT", `Nach Stimme Ende SILENCE_WAIT, war ${controller.getSnapshot().state}`);
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 1, `Nach Transkript genau ein Turn, war ${turns.length}`);
  assert(turns[0]?.transcript === "Hallo NOVA, gib mir den Status.", turns[0]?.transcript ?? "kein Turn");
  assert(turns[0]?.sttEngine === "whisper", String(turns[0]?.sttEngine));
  assert(controller.getSnapshot().state === "PROCESSING", "Nach Turn: PROCESSING");
  assert(!capture.collecting, "Capture während PROCESSING pausiert.");
  assert(capture.slices >= 1, "Utterance muss geschnitten werden.");

  controller.notifyNovaSpeaking();
  assert(controller.getSnapshot().state === "NOVA_SPEAKING", "NOVA_SPEAKING");
  assert(capture.collecting, "Mit Barge-In bleibt das Mikrofon während TTS offen.");
  const interrupts: number[] = [];
  controller.setListener({
    onTurn: (turn) => turns.push(turn),
    onInterruptNova: () => interrupts.push(clock.nowMs),
  });
  pump(capture, clock, 500, "speech");
  assert(interrupts.length === 1, `Barge-In muss NOVAs Stimme unterbrechen, war ${interrupts.length}`);
  assert(controller.getSnapshot().state === "USER_SPEAKING", `Nach Barge-In USER_SPEAKING, war ${controller.getSnapshot().state}`);
  pump(capture, clock, 320, "noise");
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 2, "Unterbrochene TTS wird ein User-Turn.");
  assert(turns[1]?.transcript.includes("Nächster Beitrag"), turns[1]?.transcript);

  controller.notifyNovaSpeaking();
  controller.notifyNovaIdle();
  clock.advance(VOICE_SESSION_CONFIG.postTtsGuardMs);
  pump(capture, clock, 400, "speech");
  pump(capture, clock, 320, "noise");
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 3, "Dritter Turn ohne erneutes Aktivieren.");

  controller.stop();
  assert(controller.getSnapshot().state === "OFF", "Manuelles Ende → OFF");
  assert(capture.stopped, "MediaStream/Capture geschlossen.");
  assert(clock.timers.size === 0, "Timer müssen geleert sein.");

  const emptyClock = new FakeClock();
  const emptyCapture = new FakeCapture();
  const emptyTurns: VoiceTurn[] = [];
  const emptyController = new VoiceSessionController({
    clock: emptyClock,
    createCapture: () => emptyCapture,
    transcribeUtterance: async () => "",
  });
  emptyController.setListener({ onTurn: (turn) => emptyTurns.push(turn) });
  await emptyController.start();
  pump(emptyCapture, emptyClock, 400, "noise");
  pump(emptyCapture, emptyClock, 400, "speech");
  pump(emptyCapture, emptyClock, 320, "noise");
  emptyClock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(emptyTurns.length === 0, "Leeres Transkript darf keinen Turn senden.");
  assert(emptyController.getSnapshot().state === "LISTENING", "Nach leerem Slice bleibt LISTENING.");
  emptyController.stop();

  const quietClock = new FakeClock();
  const quietCapture = new FakeCapture();
  const quietTurns: VoiceTurn[] = [];
  let quietInterrupts = 0;
  const quietController = new VoiceSessionController({
    clock: quietClock,
    createCapture: () => quietCapture,
    transcribeUtterance: async () => "sollte nicht kommen",
    config: { ...VOICE_SESSION_CONFIG, bargeInEnabled: false },
  });
  quietController.setListener({
    onTurn: (turn) => quietTurns.push(turn),
    onInterruptNova: () => {
      quietInterrupts += 1;
    },
  });
  await quietController.start();
  quietClock.advance(30_000);
  pump(quietCapture, quietClock, 400, "noise");
  pump(quietCapture, quietClock, 500, "speech");
  pump(quietCapture, quietClock, 320, "noise");
  quietClock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(quietTurns.length === 1, `Ohne Barge-In zuerst ein Turn, war ${quietTurns.length}`);
  quietController.notifyNovaSpeaking();
  assert(quietController.getSnapshot().state === "NOVA_SPEAKING", "Ohne Barge-In NOVA_SPEAKING");
  assert(!quietCapture.collecting, "Ohne Barge-In pausiert Capture während TTS.");
  pump(quietCapture, quietClock, 500, "speech");
  assert(quietInterrupts === 0, "Ohne Barge-In keine Unterbrechung.");
  assert(quietTurns.length === 1, `Ohne Barge-In keinen Extra-Turn während TTS, war ${quietTurns.length}`);
  assert(quietController.getSnapshot().state === "NOVA_SPEAKING", "Ohne Barge-In bleibt NOVA_SPEAKING");
  quietController.stop();

  return {
    ok: true,
    silenceTimeoutMs: VOICE_SESSION_CONFIG.silenceTimeoutMs,
    bargeInEnabled: VOICE_SESSION_CONFIG.bargeInEnabled,
    engine: "whisper",
    turns: turns.map((turn) => turn.transcript),
  };
}

if (process.argv[1]?.endsWith("verify-voice-session.ts")) {
  void runVoiceSessionChecks().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
