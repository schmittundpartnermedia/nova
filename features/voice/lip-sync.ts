"use client";

import type { SpeechViseme } from "@/types/voice";
import {
  classifyVisemeFromBands,
  clamp01,
  MIN_VISEME_MS,
  SILENCE_RMS,
  smoothIntensity,
} from "@/services/voice/viseme-heuristic";

export type LipSyncFrame = {
  viseme: SpeechViseme;
  intensity: number;
};

export type LipSyncListener = (frame: LipSyncFrame) => void;

function bandEnergy(spectrum: Uint8Array, sampleRate: number, fftSize: number, fromHz: number, toHz: number): number {
  const binHz = sampleRate / fftSize;
  const start = Math.max(0, Math.floor(fromHz / binHz));
  const end = Math.min(spectrum.length - 1, Math.ceil(toHz / binHz));
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    sum += spectrum[i] ?? 0;
    count += 1;
  }
  return count ? sum / count / 255 : 0;
}

export class LipSyncController {
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private raf = 0;
  private peak = 0.08;
  private intensity = 0;
  private viseme: SpeechViseme = "REST";
  private visemeSince = 0;
  private listener: LipSyncListener | null = null;
  private running = false;

  setListener(listener: LipSyncListener | null) {
    this.listener = listener;
  }

  start(analyser: AnalyserNode) {
    this.stop();
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
    this.peak = 0.08;
    this.intensity = 0;
    this.viseme = "REST";
    this.visemeSince = performance.now();
    this.running = true;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.analyser = null;
    this.intensity = 0;
    this.viseme = "REST";
    this.listener?.({ viseme: "REST", intensity: 0 });
  }

  getFrame(): LipSyncFrame {
    return { viseme: this.viseme, intensity: this.intensity };
  }

  private tick = () => {
    if (!this.running || !this.analyser) return;
    const analyser = this.analyser;
    analyser.getByteFrequencyData(this.freq);
    analyser.getFloatTimeDomainData(this.time);

    let sumSq = 0;
    for (let i = 0; i < this.time.length; i += 1) {
      const sample = this.time[i] ?? 0;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, this.time.length));
    this.peak = Math.max(rms, this.peak * 0.992);
    const gated = rms < SILENCE_RMS ? 0 : rms;
    const target = clamp01(gated / Math.max(this.peak, 0.08));
    this.intensity = smoothIntensity(this.intensity, target);

    const sampleRate = analyser.context.sampleRate;
    const fftSize = analyser.fftSize;
    const bands = {
      bass: bandEnergy(this.freq, sampleRate, fftSize, 80, 280),
      low: bandEnergy(this.freq, sampleRate, fftSize, 280, 700),
      mid: bandEnergy(this.freq, sampleRate, fftSize, 700, 1800),
      high: bandEnergy(this.freq, sampleRate, fftSize, 1800, 3800),
      sibilant: bandEnergy(this.freq, sampleRate, fftSize, 3800, 8000),
    };

    const next = classifyVisemeFromBands({
      rms,
      bands,
      previous: this.viseme,
      intensity: this.intensity,
    });
    const now = performance.now();
    if (next !== this.viseme && now - this.visemeSince >= MIN_VISEME_MS) {
      this.viseme = next;
      this.visemeSince = now;
    }

    this.listener?.({ viseme: this.viseme, intensity: this.intensity });
    this.raf = requestAnimationFrame(this.tick);
  };
}
