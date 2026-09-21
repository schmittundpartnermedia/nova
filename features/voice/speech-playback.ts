"use client";

import { prepareTextForSpeech } from "@/services/voice/prepare-text";
import { nextUnspokenChunks } from "@/services/voice/chunk-text";
import { HeuristicFacialProvider } from "@/providers/facial/heuristic";
import { AvatarTimelineController } from "@/features/avatar/timeline";
import type { NovaFacialFrame } from "@/types/avatar";
import type { SpeechViseme } from "@/types/voice";

export type SpeechPlaybackListener = {
  onStart?: () => void;
  onEnd?: () => void;
  onFacialFrame?: (frame: NovaFacialFrame) => void;
  onEnergy?: (input: { viseme: SpeechViseme; intensity: number }) => void;
  onError?: (message: string) => void;
};

type QueueItem = {
  id: number;
  session: number;
  text: string;
  abort: AbortController;
  buffer: AudioBuffer | null;
};

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

export class SpeechPlaybackController {
  private queue: QueueItem[] = [];
  private spokenChars = 0;
  private lastRaw = "";
  private nextId = 1;
  private session = 0;
  private playing = false;
  private stopped = false;
  private expectingMore = true;
  private started = false;
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private facial = new HeuristicFacialProvider();
  private timeline = new AvatarTimelineController();
  private listener: SpeechPlaybackListener = {};
  private chunkOriginMs = 0;
  private chunkStartedAt = 0;

  constructor() {
    this.timeline.attachClock(() => this.getAudioTimeMs());
    this.facial.setListener((frame) => {
      this.timeline.pushLive(frame);
      this.listener.onFacialFrame?.(this.timeline.sample() ?? frame);
      this.listener.onEnergy?.({
        viseme: this.facial.currentViseme,
        intensity: this.facial.currentIntensity,
      });
    });
  }

  setListener(listener: SpeechPlaybackListener) {
    this.listener = listener;
  }

  get isPlaying() {
    return this.playing;
  }

  get isBusy() {
    return this.playing || this.queue.length > 0;
  }

  getAudioTimeMs(): number {
    if (!this.playing || !this.chunkStartedAt) return this.chunkOriginMs;
    try {
      const ctx = getContext();
      return this.chunkOriginMs + Math.max(0, (ctx.currentTime - this.chunkStartedAt) * 1000);
    } catch {
      return this.chunkOriginMs;
    }
  }

  loadFacialFrames(frames: NovaFacialFrame[]) {
    this.timeline.load(frames);
  }

  resetStream() {
    this.stopInternal(false);
    this.session += 1;
    this.spokenChars = 0;
    this.lastRaw = "";
    this.stopped = false;
    this.expectingMore = true;
    this.started = false;
    this.chunkOriginMs = 0;
    this.timeline.clear();
    void this.unlock();
  }

  private async unlock() {
    try {
      const ctx = getContext();
      if (ctx.state === "suspended") await ctx.resume();
    } catch {
      // Autoplay-Unlock kann später beim Start nachgeholt werden.
    }
  }

  ingest(rawText: string, finalize = false) {
    if (this.stopped) return;
    this.lastRaw = rawText;
    this.expectingMore = !finalize;
    const prepared = prepareTextForSpeech(rawText, { finalize });
    const next = nextUnspokenChunks({
      preparedText: prepared,
      spokenChars: this.spokenChars,
      finalize,
    });
    this.spokenChars = next.spokenChars;
    for (const chunk of next.chunks) {
      this.enqueue(chunk);
    }
    if (finalize) this.notifyIfIdle();
  }

  flush(rawText?: string) {
    this.ingest(rawText ?? this.lastRaw, true);
  }

  stop() {
    this.stopInternal(true);
  }

  dispose() {
    this.stop();
    this.facial.dispose();
  }

  private stopInternal(markStopped: boolean) {
    this.stopped = markStopped;
    this.playing = false;
    this.expectingMore = false;
    this.started = false;
    for (const item of this.queue) {
      item.abort.abort();
    }
    this.queue = [];
    this.stopGraph();
    this.facial.stopLive();
    this.timeline.stop();
    this.timeline.clear();
  }

  private enqueue(text: string) {
    const item: QueueItem = {
      id: this.nextId,
      session: this.session,
      text,
      abort: new AbortController(),
      buffer: null,
    };
    this.nextId += 1;
    this.queue.push(item);
    void this.load(item);
  }

  private async load(item: QueueItem) {
    try {
      const response = await fetch("/api/nova/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: item.text }),
        signal: item.abort.signal,
      });
      if (item.session !== this.session || this.stopped) return;
      if (!response.ok) {
        let message = "Sprachausgabe momentan nicht verfügbar.";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = (await response.json()) as { error?: string };
          if (data.error) message = data.error;
        }
        this.drop(item.id);
        if (!this.started && this.queue.length === 0) {
          this.listener.onError?.(message);
        } else {
          void this.kick();
          this.notifyIfIdle();
        }
        return;
      }
      const bytes = await response.arrayBuffer();
      if (item.session !== this.session || item.abort.signal.aborted || this.stopped) return;
      const ctx = getContext();
      if (ctx.state === "suspended") await ctx.resume();
      item.buffer = await ctx.decodeAudioData(bytes.slice(0));
      void this.kick();
    } catch {
      if (item.abort.signal.aborted || item.session !== this.session) return;
      this.drop(item.id);
      if (!this.started && this.queue.length === 0) {
        this.listener.onError?.("Sprachausgabe momentan nicht verfügbar.");
      } else {
        void this.kick();
        this.notifyIfIdle();
      }
    }
  }

  private drop(id: number) {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  private async kick() {
    if (this.stopped || this.playing) return;
    const next = this.queue.find((item) => item.buffer);
    if (!next?.buffer) return;
    await this.play(next);
  }

  private async play(item: QueueItem) {
    if (this.stopped || item.session !== this.session) return;
    const buffer = item.buffer;
    if (!buffer) return;

    const ctx = getContext();
    if (ctx.state === "suspended") await ctx.resume();
    if (this.stopped || item.session !== this.session) return;

    this.playing = true;
    this.drop(item.id);

    const source = ctx.createBufferSource();
    const analyser = ctx.createAnalyser();
    const gain = ctx.createGain();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.38;
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);

    this.source = source;
    this.analyser = analyser;
    this.gain = gain;
    this.chunkStartedAt = ctx.currentTime;
    this.timeline.start();
    this.facial.startLive(analyser, () => this.getAudioTimeMs());
    if (!this.started) {
      this.started = true;
      this.listener.onStart?.();
    }

    source.onended = () => {
      if (item.session !== this.session) return;
      this.chunkOriginMs += buffer.duration * 1000;
      this.cleanupGraph();
      this.playing = false;
      this.facial.stopLive();
      if (this.stopped) return;
      if (this.queue.some((entry) => entry.buffer) || this.queue.length > 0) {
        void this.kick();
        return;
      }
      this.notifyIfIdle();
    };

    source.start(0);
  }

  private notifyIfIdle() {
    if (this.stopped || this.playing || this.queue.length > 0 || this.expectingMore) return;
    this.timeline.stop();
    this.started = false;
    this.chunkOriginMs = 0;
    this.listener.onEnd?.();
  }

  private stopGraph() {
    try {
      this.source?.stop();
    } catch {
      // already stopped
    }
    this.cleanupGraph();
  }

  private cleanupGraph() {
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.gain?.disconnect();
    } catch {
      // ignore
    }
    this.source = null;
    this.analyser = null;
    this.gain = null;
  }
}

export type { SpeechViseme, NovaFacialFrame };
