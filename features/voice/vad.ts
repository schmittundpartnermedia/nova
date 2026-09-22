import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";

export type VadEvent = "VOICE_START" | "VOICE_ACTIVE" | "VOICE_END" | "SILENCE";

export type VadFrame = {
  timestampMs: number;
  rms: number;
  peak: number;
};

export type VadStatus = {
  event: VadEvent;
  inVoice: boolean;
  speechLikely: boolean;
  snrDb: number;
  level: number;
  noiseFloor: number;
};

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

  wake(timestampMs: number) {
    this.startedAt = timestampMs - this.config.vadWarmupMs;
    this.noiseFloor = this.config.vadNoiseFloor;
    this.inVoice = false;
    this.speechRunMs = 0;
    this.silenceRunMs = 0;
    this.lastTs = timestampMs;
  }

  push(frame: VadFrame): VadStatus {
    const dt = this.lastTs == null ? 16 : Math.max(0, Math.min(80, frame.timestampMs - this.lastTs));
    this.lastTs = frame.timestampMs;
    if (!this.startedAt) this.startedAt = frame.timestampMs;

    const energy = Math.max(frame.rms, frame.peak * 0.45);
    const threshold = Math.max(this.config.vadMinSpeechRms, this.noiseFloor * this.config.vadNoiseMultiplier);
    const speech = energy >= threshold || frame.peak >= this.config.vadMinSpeechPeak;
    const snrDb = 20 * Math.log10((energy + 1e-8) / (this.noiseFloor + 1e-8));
    const warming = frame.timestampMs - this.startedAt < this.config.vadWarmupMs;
    const speechLikely = !warming && speech;

    const adapt = this.inVoice || speechLikely ? this.config.vadNoiseAdaptSpeech : this.config.vadNoiseAdaptSilence;
    if (!speechLikely || warming) {
      this.noiseFloor = this.noiseFloor + (energy - this.noiseFloor) * adapt;
      this.noiseFloor = Math.max(this.config.vadNoiseFloor * 0.4, Math.min(this.config.vadNoiseCeiling, this.noiseFloor));
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
    peak: 0.22,
    ...overrides,
  };
}

export function makeNoiseFrame(timestampMs: number, overrides: Partial<VadFrame> = {}): VadFrame {
  return {
    timestampMs,
    rms: 0.008,
    peak: 0.016,
    ...overrides,
  };
}

export function energyFromTimeDomain(samples: ArrayLike<number>): { rms: number; peak: number } {
  let sumSq = 0;
  let peak = 0;
  const n = samples.length;
  for (let i = 0; i < n; i += 1) {
    const sample = samples[i] ?? 0;
    const abs = sample < 0 ? -sample : sample;
    if (abs > peak) peak = abs;
    sumSq += sample * sample;
  }
  return { rms: n ? Math.sqrt(sumSq / n) : 0, peak };
}
