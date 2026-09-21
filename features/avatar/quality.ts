import type { NovaRenderQuality } from "@/types/avatar";

export type QualitySettings = {
  pixelRatio: number;
  bloom: boolean;
  shadows: boolean;
  particles: boolean;
  environment: boolean;
  anisotropy: number;
};

export function detectQuality(): NovaRenderQuality {
  if (typeof navigator === "undefined") return "HIGH";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (memory && memory <= 4) return "MEDIUM";
  if (cores >= 12 && (!memory || memory >= 16)) return "ULTRA";
  if (cores <= 4) return "MEDIUM";
  return "HIGH";
}

export function qualitySettings(quality: NovaRenderQuality, reducedMotion = false): QualitySettings {
  if (reducedMotion) {
    return { pixelRatio: 1, bloom: false, shadows: false, particles: false, environment: true, anisotropy: 4 };
  }
  if (quality === "LOW") {
    return { pixelRatio: 1, bloom: false, shadows: false, particles: false, environment: true, anisotropy: 4 };
  }
  if (quality === "MEDIUM") {
    return { pixelRatio: 1.25, bloom: false, shadows: false, particles: true, environment: true, anisotropy: 8 };
  }
  if (quality === "ULTRA") {
    return { pixelRatio: 2, bloom: true, shadows: true, particles: true, environment: true, anisotropy: 16 };
  }
  return { pixelRatio: 1.75, bloom: false, shadows: true, particles: true, environment: true, anisotropy: 8 };
}
