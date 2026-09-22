import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";

export type VadEvent = "VOICE_START" | "VOICE_ACTIVE" | "VOICE_END" | "SILENCE";

export type VadFrame = {
  timestampMs: number;
  rms: number;
  speechBand: number;
  rumbleBand: number;
  hissBand: number;
  zeroCrossingRate: number;
};

export type VadStatus = {
  event: VadEvent;
  inVoice: boolean;
  speechLikely: boolean;
  snrDb: number;
  level: number;
  noiseFloor: number;
};

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

export function extractVadFrame(input: {
  frequency: Uint8Array;
  time: Float32Array;
  sampleRate: number;
  fftSize: number;
  timestampMs: number;
  config?: VoiceSessionConfig;
}): VadFrame {
  const config = input.config ?? VOICE_SESSION_CONFIG;
  let sumSq = 0;
  let crossings = 0;
  let previous = input.time[0] ?? 0;
  for (let i = 0; i < input.time.length; i += 1) {
    const sample = input.time[i] ?? 0;
    sumSq += sample * sample;
    if (i > 0 && (previous >= 0) !== (sample >= 0)) crossings += 1;
    previous = sample;
  }
  const rms = input.time.length ? Math.sqrt(sumSq / input.time.length) : 0;
  return {
    timestampMs: input.timestampMs,
    rms,
    speechBand: bandEnergy(
      input.frequency,
      input.sampleRate,
      input.fftSize,
      config.speechBandLowHz,
      config.speechBandHighHz,
    ),
    rumbleBand: bandEnergy(input.frequency, input.sampleRate, input.fftSize, 20, config.rumbleHighHz),
    hissBand: bandEnergy(input.frequency, input.sampleRate, input.fftSize, config.hissLowHz, 8000),
    zeroCrossingRate: input.time.length > 1 ? crossings / (input.time.length - 1) : 0,
  };
}

function speechEnergy(frame: VadFrame): number {
  return Math.max(frame.speechBand, frame.rms * 0.85);
}

function isSpeechLike(frame: VadFrame, noiseFloor: number, config: VoiceSessionConfig): { speech: boolean; snrDb: number } {
  const energy = speechEnergy(frame);
  const snrDb = 20 * Math.log10((energy + 1e-8) / (noiseFloor + 1e-8));
  const spectralOk =
    frame.speechBand >= frame.rumbleBand * config.vadRumbleRatio &&
    frame.speechBand >= frame.hissBand * config.vadHissRatio;
  const zcrOk = frame.zeroCrossingRate >= config.vadZcrMin && frame.zeroCrossingRate <= config.vadZcrMax;
  const speech =
    energy >= config.vadMinSpeechEnergy && snrDb >= config.vadSnrDb && spectralOk && zcrOk;
  return { speech, snrDb };
}

export class VoiceActivityDetector {
  private readonly config: VoiceSessionConfig;
  private startedAt = 0;
  private noiseFloor: number;
  private inVoice = false;
  private speechRunMs = 0;
  private silenceRunMs = 0;
  private lastTs: number | null = null;

  constructor(config: VoiceSessionConfig = VOICE_SESSION_CONFIG) {
    this.config = config;
    this.noiseFloor = config.vadNoiseFloor;
  }

  reset(timestampMs = 0) {
    this.startedAt = timestampMs;
    this.noiseFloor = this.config.vadNoiseFloor;
    this.inVoice = false;
    this.speechRunMs = 0;
    this.silenceRunMs = 0;
    this.lastTs = null;
  }

  releaseUtterance() {
    this.inVoice = false;
    this.speechRunMs = 0;
    this.silenceRunMs = 0;
  }

  get level() {
    return this.noiseFloor;
  }

  push(frame: VadFrame): VadStatus {
    const dt = this.lastTs == null ? 16 : Math.max(0, Math.min(80, frame.timestampMs - this.lastTs));
    this.lastTs = frame.timestampMs;
    if (!this.startedAt) this.startedAt = frame.timestampMs;

    const energy = speechEnergy(frame);
    const warming = frame.timestampMs - this.startedAt < this.config.vadWarmupMs;
    const { speech, snrDb } = isSpeechLike(frame, this.noiseFloor, this.config);
    const energyGate =
      energy >= this.config.vadMinSpeechEnergy * this.config.vadSoftEnergyScale &&
      snrDb >= this.config.vadSoftSnrDb;
    const speechLikely = !warming && (speech || energyGate);

    const adapt = this.inVoice || speechLikely ? this.config.vadNoiseAdaptSpeech : this.config.vadNoiseAdaptSilence;
    if (!speechLikely || warming) {
      this.noiseFloor = this.noiseFloor + (energy - this.noiseFloor) * adapt;
      this.noiseFloor = Math.max(this.config.vadNoiseFloor * 0.4, Math.min(0.08, this.noiseFloor));
    }

    if (warming) {
      return {
        event: "SILENCE",
        inVoice: false,
        speechLikely: false,
        snrDb,
        level: energy,
        noiseFloor: this.noiseFloor,
      };
    }

    if (speechLikely) {
      this.speechRunMs += dt;
      this.silenceRunMs = 0;
      if (!this.inVoice && this.speechRunMs >= this.config.minSpeechDurationMs) {
        this.inVoice = true;
        return {
          event: "VOICE_START",
          inVoice: true,
          speechLikely: true,
          snrDb,
          level: energy,
          noiseFloor: this.noiseFloor,
        };
      }
      if (this.inVoice) {
        return {
          event: "VOICE_ACTIVE",
          inVoice: true,
          speechLikely: true,
          snrDb,
          level: energy,
          noiseFloor: this.noiseFloor,
        };
      }
      return {
        event: "SILENCE",
        inVoice: false,
        speechLikely: true,
        snrDb,
        level: energy,
        noiseFloor: this.noiseFloor,
      };
    }

    this.speechRunMs = 0;
    if (this.inVoice) {
      this.silenceRunMs += dt;
      if (this.silenceRunMs >= this.config.vadHangoverMs) {
        this.inVoice = false;
        this.silenceRunMs = 0;
        return {
          event: "VOICE_END",
          inVoice: false,
          speechLikely: false,
          snrDb,
          level: energy,
          noiseFloor: this.noiseFloor,
        };
      }
      return {
        event: "VOICE_ACTIVE",
        inVoice: true,
        speechLikely: false,
        snrDb,
        level: energy,
        noiseFloor: this.noiseFloor,
      };
    }

    return {
      event: "SILENCE",
      inVoice: false,
      speechLikely: false,
      snrDb,
      level: energy,
      noiseFloor: this.noiseFloor,
    };
  }
}

export function makeSpeechFrame(timestampMs: number, overrides: Partial<VadFrame> = {}): VadFrame {
  return {
    timestampMs,
    rms: 0.08,
    speechBand: 0.22,
    rumbleBand: 0.04,
    hissBand: 0.03,
    zeroCrossingRate: 0.08,
    ...overrides,
  };
}

export function makeNoiseFrame(timestampMs: number, overrides: Partial<VadFrame> = {}): VadFrame {
  return {
    timestampMs,
    rms: 0.012,
    speechBand: 0.01,
    rumbleBand: 0.02,
    hissBand: 0.018,
    zeroCrossingRate: 0.22,
    ...overrides,
  };
}
