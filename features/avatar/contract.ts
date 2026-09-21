import { NOVA_BLENDSHAPE_NAMES, type NovaBlendshapeWeights } from "@/types/avatar";

export const LIP_SYNC_BLENDSHAPES = [
  "jawOpen",
  "jawForward",
  "jawLeft",
  "jawRight",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthLeft",
  "mouthRight",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "tongueOut",
] as const;

export const EYE_LOOK_BLENDSHAPES = [
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
] as const;

export const BLINK_BLENDSHAPES = ["eyeBlinkLeft", "eyeBlinkRight"] as const;

export const LIP_SYNC_SET = new Set<string>(LIP_SYNC_BLENDSHAPES);
export const EYE_LOOK_SET = new Set<string>(EYE_LOOK_BLENDSHAPES);

export function emptyBlendshapes(): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const name of NOVA_BLENDSHAPE_NAMES) weights[name] = 0;
  return weights;
}

export function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeBlendshapes(input: NovaBlendshapeWeights | undefined): Record<string, number> {
  const weights = emptyBlendshapes();
  if (!input) return weights;
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== "number") continue;
    weights[name] = clampWeight(value);
  }
  return weights;
}

export function mergeBlendshapes(
  base: NovaBlendshapeWeights,
  overlay: NovaBlendshapeWeights,
  options?: { overwriteKeys?: Set<string> },
): Record<string, number> {
  const result = normalizeBlendshapes(base);
  for (const [name, value] of Object.entries(overlay)) {
    if (typeof value !== "number") continue;
    const next = clampWeight(value);
    if (options?.overwriteKeys?.has(name)) {
      result[name] = next;
      continue;
    }
    result[name] = clampWeight(Math.max(result[name] ?? 0, next));
  }
  return result;
}
