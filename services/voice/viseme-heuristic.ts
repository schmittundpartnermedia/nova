import type { SpectralBands, SpeechViseme } from "@/types/voice";

export const SILENCE_RMS = 0.02;
export const MIN_VISEME_MS = 70;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function classifyVisemeFromBands(input: {
  rms: number;
  bands: SpectralBands;
  previous: SpeechViseme;
  intensity: number;
}): SpeechViseme {
  const rms = input.rms;
  if (rms < SILENCE_RMS) return "REST";

  const { bass, low, mid, high, sibilant } = input.bands;
  const total = bass + low + mid + high + sibilant + 1e-6;
  const sRatio = sibilant / total;
  const bassR = bass / total;
  const lowR = low / total;
  const midR = mid / total;
  const highR = high / total;

  if (sRatio > 0.3) {
    return high > sibilant * 0.55 ? "S_Z" : "SH_CH";
  }
  if (highR > 0.24 && rms < 0.32) {
    return midR > 0.22 ? "TH" : "F_V";
  }
  if (rms < 0.11 && input.previous !== "REST" && bassR < 0.22) {
    return "M_B_P";
  }
  if (bassR > 0.4 && rms > 0.34) return "A";
  if (bassR > 0.3 && lowR > 0.22 && midR < 0.28) {
    return rms > 0.26 ? "O" : "U";
  }
  if (midR > 0.38 && highR > 0.16) return "I";
  if (midR > 0.34) return "E";
  if (lowR > 0.3 && rms < 0.24) return "W_Q";
  if (midR > 0.28 && bassR < 0.22) return "L";
  if (lowR > 0.28 && midR > 0.22) return "R";
  if (rms < 0.13) return "M_B_P";
  return input.intensity > 0.55 ? "A" : "E";
}

export function smoothIntensity(current: number, target: number): number {
  const attack = 0.38;
  const release = 0.16;
  const rate = target > current ? attack : release;
  return current + (target - current) * rate;
}
