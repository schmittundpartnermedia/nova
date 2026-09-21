import type { NovaFacialFrame } from "@/types/avatar";
import type { FacialAnimationProvider, FacialProviderHealth, NvidiaA2FAnimationPayload } from "@/types/facial";
import { visemeToBlendshapes } from "@/features/avatar/viseme-map";
import {
  classifyVisemeFromBands,
  clamp01,
  MIN_VISEME_MS,
  SILENCE_RMS,
  smoothIntensity,
} from "@/services/voice/viseme-heuristic";
import type { SpeechViseme } from "@/types/voice";

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

export class HeuristicFacialProvider implements FacialAnimationProvider {
  id = "heuristic" as const;
  name = "HeuristicFacialProvider";
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private raf = 0;
  private peak = 0.08;
  private intensity = 0;
  private viseme: SpeechViseme = "REST";
  private visemeSince = 0;
  private running = false;
  private getAudioTimeMs: () => number = () => 0;
  private listener: ((frame: NovaFacialFrame) => void) | null = null;

  get currentViseme(): SpeechViseme {
    return this.viseme;
  }

  get currentIntensity(): number {
    return this.intensity;
  }

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<FacialProviderHealth> {
    return {
      ok: true,
      provider: this.id,
      available: true,
      message: "Lokaler Spektral-Provider. Kein Audio2Face. Erzeugt zeitgestempelte Blendshape-Frames.",
    };
  }

  setListener(listener: ((frame: NovaFacialFrame) => void) | null) {
    this.listener = listener;
  }

  startLive(analyser: AnalyserNode, getAudioTimeMs: () => number) {
    this.stopLive();
    this.analyser = analyser;
    this.getAudioTimeMs = getAudioTimeMs;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
    this.peak = 0.08;
    this.intensity = 0;
    this.viseme = "REST";
    this.visemeSince = performance.now();
    this.running = true;
    this.tick();
  }

  stopLive() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.analyser = null;
    this.intensity = 0;
    this.viseme = "REST";
    this.emit("REST", 0);
  }

  dispose() {
    this.stopLive();
    this.listener = null;
  }

  private emit(viseme: SpeechViseme, intensity: number) {
    this.listener?.({
      timestampMs: this.getAudioTimeMs(),
      blendshapes: visemeToBlendshapes(viseme, intensity),
      confidence: 0.45 + Math.min(0.4, intensity * 0.4),
    });
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

    this.emit(this.viseme, this.intensity);
    this.raf = requestAnimationFrame(this.tick);
  };
}

export function nvidiaAnimationToFrames(payload: NvidiaA2FAnimationPayload): NovaFacialFrame[] {
  return payload.samples.map((sample) => {
    const blendshapes: Record<string, number> = {};
    payload.blendShapeNames.forEach((name, index) => {
      const value = sample.blendShapeWeights[index];
      if (typeof value === "number") blendshapes[name] = value;
    });
    return {
      timestampMs: sample.timeCode * 1000,
      blendshapes,
      confidence: 1,
    };
  });
}
