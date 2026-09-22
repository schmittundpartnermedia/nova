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
  sliceCalls: Array<{ fromMs: number; toMs: number }> = [];
  blob = new Blob([new Uint8Array(1200)], { type: "audio/wav" });

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

  async sliceUtterance(fromMs: number, toMs: number) {
    this.sliceCalls.push({ fromMs, toMs });
    return this.blob;
  }

  subscribe(listener: (frame: VadFrame) => void) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  push(frame: VadFrame) {
    this.listener?.(frame);
  }
}

function pump(capture: FakeCapture, clock: FakeClock, ms: number, frame: (at: number) => VadFrame) {
  const step = 20;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    clock.advance(step);
    capture.push(frame(clock.now()));
  }
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function replies(texts: string[]) {
  let i = 0;
  return async () => texts[i++] ?? "";
}

export async function runVoiceSessionChecks() {
  assert(VOICE_SESSION_CONFIG.silenceTimeoutMs === 5000, "silenceTimeoutMs muss 5000 sein.");
  assert(VOICE_SESSION_CONFIG.bargeInEnabled === false, "Barge-In muss in dieser Architektur aus bleiben.");
  assert(VOICE_SESSION_CONFIG.minSpeechDurationMs > 0, "minSpeechDurationMs zentral");
  assert(VOICE_SESSION_CONFIG.postTtsGuardMs > 0, "postTtsGuardMs zentral");
  assert(VOICE_SESSION_CONFIG.pcmSampleRate === 16000, "PCM muss 16 kHz sein.");

  const listening = reduceVoiceSession(INITIAL_VOICE_SESSION, { type: "START_REQUESTED" });
  assert(listening.state === "STARTING", "START_REQUESTED → STARTING");
  const ready = reduceVoiceSession(listening, { type: "START_READY" });
  assert(ready.state === "LISTENING", "START_READY → LISTENING");
  const speaking = reduceVoiceSession(ready, { type: "VOICE_START", at: 1000 });
  assert(speaking.state === "USER_SPEAKING", "VOICE_START → USER_SPEAKING");
  const waiting = reduceVoiceSession(speaking, { type: "VOICE_END", at: 2000 });
  assert(waiting.state === "SILENCE_WAIT", "VOICE_END → SILENCE_WAIT");
  const continued = reduceVoiceSession(waiting, { type: "VOICE_START", at: 3500 });
  assert(continued.state === "USER_SPEAKING", "Pause <5s setzt denselben Turn fort.");
  const waitingAgain = reduceVoiceSession(continued, { type: "VOICE_END", at: 5000 });
  const empty = reduceVoiceSession(waitingAgain, { type: "SILENCE_TIMEOUT", hasTranscript: false });
  assert(empty.state === "LISTENING", "Leerer Silence-Timeout bleibt LISTENING.");
  const waitingFull = reduceVoiceSession(waitingAgain, { type: "SILENCE_TIMEOUT", hasTranscript: true });
  assert(waitingFull.state === "PROCESSING", "Silence mit Transcript → PROCESSING");
  const fromSpeaking = reduceVoiceSession(speaking, { type: "SILENCE_TIMEOUT", hasTranscript: true });
  assert(fromSpeaking.state === "PROCESSING", "5s-Timeout darf auch aus USER_SPEAKING finalisieren.");
  const novaTalks = reduceVoiceSession(waitingFull, { type: "NOVA_SPEAKING" });
  assert(novaTalks.state === "NOVA_SPEAKING", "NOVA_SPEAKING");
  const listenAgain = reduceVoiceSession(novaTalks, { type: "NOVA_IDLE" });
  assert(listenAgain.state === "LISTENING", "Auto Re-Listen nach NOVA_IDLE");
  const stopped = reduceVoiceSession(novaTalks, { type: "STOP" });
  assert(stopped.state === "OFF", "STOP → OFF");

  const vad = new VoiceActivityDetector();
  vad.reset(0);
  let last = vad.push(makeNoiseFrame(0));
  for (let t = 20; t <= 400; t += 20) {
    last = vad.push(makeNoiseFrame(t));
  }
  assert(last.event === "SILENCE", `Warmup/Noise darf keine Stimme sein, war ${last.event}`);

  let started = false;
  for (let t = 420; t <= 900; t += 20) {
    last = vad.push(makeSpeechFrame(t));
    if (last.event === "VOICE_START") started = true;
  }
  assert(started, "VAD muss VOICE_START bei Sprache erkennen.");

  let ended = false;
  for (let t = 920; t <= 1600; t += 20) {
    last = vad.push(makeNoiseFrame(t));
    if (last.event === "VOICE_END") ended = true;
  }
  assert(ended, "VAD muss VOICE_END nach Stille erkennen.");

  const noisy = new VoiceActivityDetector();
  noisy.reset(0);
  for (let t = 0; t <= 400; t += 20) noisy.push(makeNoiseFrame(t, { rms: 0.03, peak: 0.03 }));
  let falseStart = false;
  for (let t = 420; t <= 2000; t += 20) {
    const status = noisy.push(makeNoiseFrame(t, { rms: 0.028, peak: 0.03 }));
    if (status.event === "VOICE_START") falseStart = true;
  }
  assert(!falseStart, "Umgebungsgeräusch darf den VAD nicht als Stimme werten.");

  const ring = new PcmSlicer(16000, 2);
  const block = new Float32Array(1600);
  for (let i = 0; i < block.length; i += 1) block[i] = i % 2 === 0 ? 0.5 : -0.5;
  ring.appendMono(block, 16000, 1000);
  const sliced = ring.slice(1000, 1100);
  assert(sliced.length >= 1400 && sliced.length <= 1800, `PCM-Slice Länge, war ${sliced.length}`);
  const wav = encodeWavPcm16(sliced, 16000);
  assert(wav.type === "audio/wav", "WAV MIME");
  assert(wav.size === 44 + sliced.length * 2, "WAV Header + PCM");

  const clock = new FakeClock();
  const capture = new FakeCapture();
  const turns: VoiceTurn[] = [];
  const controller = new VoiceSessionController({
    clock,
    createCapture: () => capture,
    transcribeUtterance: replies([
      "Hallo NOVA, gib mir den Status meiner Projekte und sag mir, was dort noch offen ist.",
      "Nächster Beitrag ohne Klick.",
      "Dritter Beitrag ohne Klick.",
    ]),
  });
  controller.setListener({
    onTurn: (turn) => turns.push(turn),
  });

  await controller.start();
  assert(controller.getSnapshot().state === "LISTENING", `Start muss LISTENING sein, war ${controller.getSnapshot().state}`);
  assert(capture.started, "Capture muss laufen.");
  assert(capture.collecting, "PCM muss ab Session-Start sammeln.");

  pump(capture, clock, 350, (at) => makeNoiseFrame(at));
  assert(controller.getSnapshot().state === "LISTENING", "Vor der ersten Sprache bleibt LISTENING.");
  clock.advance(30_000);
  assert(turns.length === 0, "30s Stille darf keinen leeren Turn senden.");
  assert(controller.getSnapshot().state === "LISTENING", "Session bleibt nach Stille aktiv.");

  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  assert(controller.getSnapshot().state === "USER_SPEAKING", `Sprache muss USER_SPEAKING sein, war ${controller.getSnapshot().state}`);
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  assert(controller.getSnapshot().state === "SILENCE_WAIT", `Nach Stimme Ende SILENCE_WAIT, war ${controller.getSnapshot().state}`);
  clock.advance(2000);
  assert(turns.length === 0, "2s Pause darf den Turn nicht abschließen.");
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  assert(controller.getSnapshot().state === "USER_SPEAKING", "Sprache nach kurzer Pause setzt denselben Turn fort.");
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 1, `Nach 5s Silence genau ein Turn, war ${turns.length}`);
  assert(turns[0]?.transcript.includes("Hallo NOVA"), `Transcript muss ersten Teil enthalten: ${turns[0]?.transcript}`);
  assert(turns[0]?.transcript.includes("offen"), `Transcript muss zweiten Teil enthalten: ${turns[0]?.transcript}`);
  assert(turns[0]?.sttEngine === "whisper", String(turns[0]?.sttEngine));
  assert(turns[0]?.inputMode === "voice", "inputMode voice");
  assert(turns[0]?.durationMs >= 0, "durationMs");
  assert(Boolean(turns[0]?.startedAt && turns[0]?.endedAt), "startedAt/endedAt");
  assert(capture.sliceCalls.length === 1, "Ein Whisper-Slice pro Turn.");
  assert(controller.getSnapshot().state === "PROCESSING", "Nach Turn: PROCESSING");
  assert(!capture.collecting, "PCM während PROCESSING pausiert, damit TTS nicht mitgeschnitten wird.");

  controller.notifyNovaSpeaking();
  assert(controller.getSnapshot().state === "NOVA_SPEAKING", "NOVA_SPEAKING");
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  assert(controller.getSnapshot().state === "NOVA_SPEAKING", "Ohne Barge-In bleibt NOVA_SPEAKING.");
  assert(turns.length === 1, "NOVAs Stimme darf keinen neuen User-Turn erzeugen.");

  controller.notifyNovaIdle();
  clock.advance(VOICE_SESSION_CONFIG.postTtsGuardMs);
  assert(controller.getSnapshot().state === "LISTENING", `Auto Re-Listen, war ${controller.getSnapshot().state}`);
  assert(capture.collecting, "PCM nach Guard wieder aktiv.");

  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 2, "Zweiter Turn ohne erneutes Aktivieren.");
  assert(turns[1]?.transcript.includes("Nächster Beitrag"), turns[1]?.transcript);

  controller.notifyNovaSpeaking();
  controller.notifyNovaIdle();
  clock.advance(VOICE_SESSION_CONFIG.postTtsGuardMs);
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(turns.length === 3, "Dritter Turn ohne erneutes Aktivieren.");

  controller.stop();
  assert(controller.getSnapshot().state === "OFF", "Manuelles Ende → OFF");
  assert(capture.stopped, "MediaStream/Capture geschlossen.");
  assert(clock.timers.size === 0, "Timer müssen geleert sein.");

  const blipClock = new FakeClock();
  const blipCapture = new FakeCapture();
  const blipTurns: VoiceTurn[] = [];
  const blipController = new VoiceSessionController({
    clock: blipClock,
    createCapture: () => blipCapture,
    transcribeUtterance: async () => "Nur ein Satz.",
  });
  blipController.setListener({ onTurn: (turn) => blipTurns.push(turn) });
  await blipController.start();
  pump(blipCapture, blipClock, 350, (at) => makeNoiseFrame(at));
  pump(blipCapture, blipClock, 400, (at) => makeSpeechFrame(at));
  pump(blipCapture, blipClock, 400, (at) => makeNoiseFrame(at));
  blipClock.advance(2100);
  assert(blipTurns.length === 0, "2.1s Pause ist noch kein Turn.");
  pump(blipCapture, blipClock, 200, (at) => makeSpeechFrame(at));
  pump(blipCapture, blipClock, 400, (at) => makeNoiseFrame(at));
  blipClock.advance(2600);
  await flush();
  assert(blipTurns.length === 1, `VAD-Blip darf den 5s-Timer nicht neu starten, war ${blipTurns.length}`);
  blipController.stop();

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
  pump(emptyCapture, emptyClock, 350, (at) => makeNoiseFrame(at));
  pump(emptyCapture, emptyClock, 400, (at) => makeSpeechFrame(at));
  pump(emptyCapture, emptyClock, 400, (at) => makeNoiseFrame(at));
  emptyClock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  await flush();
  assert(emptyTurns.length === 0, "Leeres Whisper-Ergebnis darf keinen Turn senden.");
  assert(emptyController.getSnapshot().state === "LISTENING", "Nach leerem Slice bleibt LISTENING.");
  assert(emptyCapture.collecting, "Nach leerem Slice weiter aufnehmen.");
  emptyController.stop();

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
