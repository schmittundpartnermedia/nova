import type { NovaRenderQuality } from "@/types/avatar";

export type QualitySettings = {
  pixelRatio: number;
  bloom: boolean;
  shadows: boolean;
  particles: boolean;
  environment: boolean;
};

export function detectQuality(): NovaRenderQuality {
  if (typeof navigator === "undefined") return "MEDIUM";
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (memory && memory <= 4) return "LOW";
  if (cores <= 4) return "MEDIUM";
  return "HIGH";
}

export function qualitySettings(quality: NovaRenderQuality, reducedMotion = false): QualitySettings {
  if (quality === "LOW" || reducedMotion) {
    return { pixelRatio: 1, bloom: false, shadows: false, particles: false, environment: true };
  }
  if (quality === "MEDIUM") {
    return { pixelRatio: 1.35, bloom: false, shadows: false, particles: true, environment: true };
  }
  return { pixelRatio: 1.75, bloom: false, shadows: true, particles: true, environment: true };
}
