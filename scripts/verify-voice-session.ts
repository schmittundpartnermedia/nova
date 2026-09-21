import { VOICE_SESSION_CONFIG } from "@/features/voice/session-config";
import { VoiceSessionController } from "@/features/voice/session-controller";
import {
  INITIAL_VOICE_SESSION,
  reduceVoiceSession,
} from "@/features/voice/session-machine";
import type { VoiceClock, VoiceTurn } from "@/features/voice/session-types";
import { isSpeechRecognitionSupported, WebSpeechStt, type SpeechToText, type SpeechToTextListener } from "@/features/voice/stt";
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

  async start() {
    this.started = true;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    this.started = false;
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

class FakeStt implements SpeechToText {
  supported = true;
  engine = "web-speech";
  paused = false;
  started = false;
  stopped = false;
  startCalls = 0;
  listener: SpeechToTextListener = {};

  start(listener: SpeechToTextListener) {
    this.listener = listener;
    this.started = true;
    this.stopped = false;
    this.paused = false;
    this.startCalls += 1;
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.started = true;
  }

  emit(transcript: string, confidence = 0.9) {
    if (this.paused || this.stopped) return;
    this.listener.onTranscript?.({ transcript, confidence, isFinal: true });
  }
}

function pump(capture: FakeCapture, clock: FakeClock, ms: number, frame: (at: number) => VadFrame) {
  const step = 20;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    clock.advance(step);
    capture.push(frame(clock.now()));
  }
}

export async function runVoiceSessionChecks() {
  assert(VOICE_SESSION_CONFIG.silenceTimeoutMs === 5000, "silenceTimeoutMs muss 5000 sein.");
  assert(VOICE_SESSION_CONFIG.bargeInEnabled === false, "Barge-In muss in dieser Architektur aus bleiben.");
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
  for (let t = 0; t <= 400; t += 20) noisy.push(makeNoiseFrame(t, { rms: 0.03, speechBand: 0.03, rumbleBand: 0.04, hissBand: 0.04 }));
  let falseStart = false;
  for (let t = 420; t <= 2000; t += 20) {
    const status = noisy.push(makeNoiseFrame(t, { rms: 0.028, speechBand: 0.025, rumbleBand: 0.04, hissBand: 0.05, zeroCrossingRate: 0.3 }));
    if (status.event === "VOICE_START") falseStart = true;
  }
  assert(!falseStart, "Umgebungsgeräusch darf den VAD nicht als Stimme werten.");

  const clock = new FakeClock();
  const capture = new FakeCapture();
  const stt = new FakeStt();
  const turns: VoiceTurn[] = [];
  const controller = new VoiceSessionController({
    clock,
    createCapture: () => capture,
    createStt: () => stt,
  });
  controller.setListener({
    onTurn: (turn) => turns.push(turn),
  });

  await controller.start();
  assert(controller.getSnapshot().state === "LISTENING", `Start muss LISTENING sein, war ${controller.getSnapshot().state}`);
  assert(capture.started, "Capture muss laufen.");
  assert(stt.started, "STT muss laufen.");
  assert(stt.startCalls === 1, "STT startet einmal mit User-Geste.");

  pump(capture, clock, 350, (at) => makeNoiseFrame(at));
  assert(controller.getSnapshot().state === "LISTENING", "Vor der ersten Sprache bleibt LISTENING.");
  clock.advance(30_000);
  assert(turns.length === 0, "30s Stille darf keinen leeren Turn senden.");
  assert(controller.getSnapshot().state === "LISTENING", "Session bleibt nach Stille aktiv.");

  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  stt.emit("Hallo NOVA, gib mir den Status meiner Projekte.");
  assert(controller.getSnapshot().state === "USER_SPEAKING", `Sprache muss USER_SPEAKING sein, war ${controller.getSnapshot().state}`);
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  assert(controller.getSnapshot().state === "SILENCE_WAIT", `Nach Stimme Ende SILENCE_WAIT, war ${controller.getSnapshot().state}`);
  clock.advance(2000);
  assert(turns.length === 0, "2s Pause darf den Turn nicht abschließen.");
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  stt.emit("und sag mir, was dort noch offen ist.");
  assert(controller.getSnapshot().state === "USER_SPEAKING", "Sprache nach kurzer Pause setzt denselben Turn fort.");
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  assert(turns.length === 1, `Nach 5s Silence genau ein Turn, war ${turns.length}`);
  assert(turns[0]?.transcript.includes("Hallo NOVA"), `Transcript muss ersten Teil enthalten: ${turns[0]?.transcript}`);
  assert(turns[0]?.transcript.includes("offen"), `Transcript muss zweiten Teil enthalten: ${turns[0]?.transcript}`);
  assert(turns[0]?.inputMode === "voice", "inputMode voice");
  assert(turns[0]?.durationMs >= 0, "durationMs");
  assert(Boolean(turns[0]?.startedAt && turns[0]?.endedAt), "startedAt/endedAt");
  assert(controller.getSnapshot().state === "PROCESSING", "Nach Turn: PROCESSING");
  assert(stt.paused, "STT muss während PROCESSING pausieren.");

  controller.notifyNovaSpeaking();
  assert(controller.getSnapshot().state === "NOVA_SPEAKING", "NOVA_SPEAKING");
  stt.emit("Ich bin NOVA und antworte jetzt.");
  assert(turns.length === 1, "NOVAs Stimme darf keinen neuen User-Turn erzeugen.");
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  assert(controller.getSnapshot().state === "NOVA_SPEAKING", "Ohne Barge-In bleibt NOVA_SPEAKING.");

  controller.notifyNovaIdle();
  clock.advance(VOICE_SESSION_CONFIG.postTtsGuardMs);
  assert(controller.getSnapshot().state === "LISTENING", `Auto Re-Listen, war ${controller.getSnapshot().state}`);
  assert(!stt.paused && stt.started, "STT nach Guard wieder aktiv.");
  assert(stt.startCalls === 1, "WKWebView: STT nach TTS per resume, ohne neuen start().");

  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  stt.emit("Nächster Beitrag ohne Klick.");
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  assert(turns.length === 2, "Zweiter Turn ohne erneutes Aktivieren.");
  assert(turns[1]?.transcript.includes("Nächster Beitrag"), turns[1]?.transcript);

  controller.notifyNovaSpeaking();
  controller.notifyNovaIdle();
  clock.advance(VOICE_SESSION_CONFIG.postTtsGuardMs);
  pump(capture, clock, 400, (at) => makeSpeechFrame(at));
  stt.emit("Dritter Beitrag ohne Klick.");
  pump(capture, clock, 400, (at) => makeNoiseFrame(at));
  clock.advance(VOICE_SESSION_CONFIG.silenceTimeoutMs);
  assert(turns.length === 3, "Dritter Turn ohne erneutes Aktivieren.");
  assert(stt.startCalls === 1, "Drei Turns teilen denselben STT-Start.");

  controller.stop();
  assert(controller.getSnapshot().state === "OFF", "Manuelles Ende → OFF");
  assert(capture.stopped, "MediaStream/Capture geschlossen.");
  assert(stt.stopped, "STT gestoppt.");
  assert(clock.timers.size === 0, "Timer müssen geleert sein.");

  const blipClock = new FakeClock();
  const blipCapture = new FakeCapture();
  const blipStt = new FakeStt();
  const blipTurns: VoiceTurn[] = [];
  const blipController = new VoiceSessionController({
    clock: blipClock,
    createCapture: () => blipCapture,
    createStt: () => blipStt,
  });
  blipController.setListener({ onTurn: (turn) => blipTurns.push(turn) });
  await blipController.start();
  pump(blipCapture, blipClock, 350, (at) => makeNoiseFrame(at));
  pump(blipCapture, blipClock, 400, (at) => makeSpeechFrame(at));
  blipStt.emit("Nur ein Satz.");
  pump(blipCapture, blipClock, 400, (at) => makeNoiseFrame(at));
  blipClock.advance(2100);
  assert(blipTurns.length === 0, "2.1s Pause ist noch kein Turn.");
  pump(blipCapture, blipClock, 200, (at) => makeSpeechFrame(at));
  pump(blipCapture, blipClock, 400, (at) => makeNoiseFrame(at));
  blipClock.advance(2600);
  assert(blipTurns.length === 1, `VAD-Blip darf den 5s-Timer nicht neu starten, war ${blipTurns.length}`);
  blipController.stop();

  const repeatClock = new FakeClock();
  const repeatCapture = new FakeCapture();
  const repeatStt = new FakeStt();
  const repeatTurns: VoiceTurn[] = [];
  const repeatController = new VoiceSessionController({
    clock: repeatClock,
    createCapture: () => repeatCapture,
    createStt: () => repeatStt,
  });
  repeatController.setListener({ onTurn: (turn) => repeatTurns.push(turn) });
  await repeatController.start();
  pump(repeatCapture, repeatClock, 350, (at) => makeNoiseFrame(at));
  pump(repeatCapture, repeatClock, 400, (at) => makeSpeechFrame(at));
  repeatStt.emit("Hallo NOVA");
  pump(repeatCapture, repeatClock, 400, (at) => makeNoiseFrame(at));
  repeatClock.advance(1000);
  repeatStt.emit("Hallo NOVA");
  repeatClock.advance(3700);
  assert(repeatTurns.length === 1, `STT-onend-Duplikat darf den 5s-Timer nicht neu starten, war ${repeatTurns.length}`);
  assert(repeatTurns[0]?.transcript === "Hallo NOVA", repeatTurns[0]?.transcript ?? "kein Turn");
  repeatController.stop();

  await runWebSpeechOnendChecks();

  return {
    ok: true,
    silenceTimeoutMs: VOICE_SESSION_CONFIG.silenceTimeoutMs,
    bargeInEnabled: VOICE_SESSION_CONFIG.bargeInEnabled,
    turns: turns.map((turn) => turn.transcript),
  };
}

async function runWebSpeechOnendChecks() {
  class FakeRecognition {
    static starts = 0;
    static constructs = 0;
    static last: FakeRecognition | null = null;
    lang = "";
    interimResults = false;
    continuous = false;
    onresult: ((event: { resultIndex?: number; results: ArrayLike<{ 0?: { transcript?: string; confidence?: number }; isFinal?: boolean }> }) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;

    constructor() {
      FakeRecognition.constructs += 1;
      FakeRecognition.last = this;
    }

    start() {
      FakeRecognition.starts += 1;
    }

    stop() {}
    abort() {}
  }

  const g = globalThis as typeof globalThis & { SpeechRecognition?: new () => FakeRecognition };
  const previous = g.SpeechRecognition;
  g.SpeechRecognition = FakeRecognition;
  assert(isSpeechRecognitionSupported(), "Fake SpeechRecognition muss erkannt werden.");

  const clock = new FakeClock();
  const texts: string[] = [];
  const stt = new WebSpeechStt(VOICE_SESSION_CONFIG, clock);
  stt.start({
    onTranscript: (input) => texts.push(input.transcript),
  });
  assert(FakeRecognition.starts === 1, "STT bootet einmal.");
  const rec = FakeRecognition.last;
  if (!rec) throw new Error("SpeechRecognition-Instanz fehlt.");
  rec.onresult?.({
    resultIndex: 0,
    results: Object.assign([{ 0: { transcript: "Hallo NOVA", confidence: 0.9 }, isFinal: false, length: 1 }], { length: 1 }),
  });
  rec.onend?.();
  assert(FakeRecognition.constructs === 1, "onend muss dieselbe SpeechRecognition-Instanz weiterverwenden.");
  assert(FakeRecognition.starts === 2, "onend muss STT sofort neu starten, ohne den Turn zu beenden.");
  assert(texts.some((text) => text.includes("Hallo NOVA")), "Interim muss beim onend committed werden.");

  stt.pause();
  const startsAfterPause = FakeRecognition.starts;
  FakeRecognition.last?.onresult?.({
    resultIndex: 0,
    results: Object.assign([{ 0: { transcript: "NOVA spricht", confidence: 0.9 }, isFinal: true, length: 1 }], { length: 1 }),
  });
  assert(texts.every((text) => !text.includes("NOVA spricht")), "Pausiertes STT darf TTS nicht als User-Text übernehmen.");
  FakeRecognition.last?.onend?.();
  assert(FakeRecognition.starts > startsAfterPause, "Auch während pause bleibt die Engine am Leben.");
  stt.resume();
  stt.stop();
  g.SpeechRecognition = previous;
}

if (process.argv[1]?.endsWith("verify-voice-session.ts")) {
  void runVoiceSessionChecks().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
