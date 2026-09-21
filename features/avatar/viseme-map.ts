import type { SpeechViseme } from "@/types/voice";
import type { NovaBlendshapeWeights } from "@/types/avatar";
import { clampWeight } from "@/features/avatar/contract";

type Shape = NovaBlendshapeWeights;

const REST: Shape = {};

const SHAPES: Record<SpeechViseme, Shape> = {
  REST,
  M_B_P: {
    mouthClose: 0.92,
    mouthPressLeft: 0.42,
    mouthPressRight: 0.42,
    jawOpen: 0,
  },
  A: {
    jawOpen: 0.62,
    mouthLowerDownLeft: 0.28,
    mouthLowerDownRight: 0.28,
    mouthClose: 0,
  },
  E: {
    jawOpen: 0.24,
    mouthStretchLeft: 0.48,
    mouthStretchRight: 0.48,
    mouthSmileLeft: 0.08,
    mouthSmileRight: 0.08,
  },
  I: {
    jawOpen: 0.14,
    mouthStretchLeft: 0.58,
    mouthStretchRight: 0.58,
  },
  O: {
    jawOpen: 0.42,
    mouthFunnel: 0.58,
    mouthPucker: 0.18,
  },
  U: {
    jawOpen: 0.22,
    mouthPucker: 0.72,
    mouthFunnel: 0.32,
  },
  W_Q: {
    jawOpen: 0.14,
    mouthPucker: 0.68,
    mouthFunnel: 0.42,
  },
  F_V: {
    jawOpen: 0.1,
    mouthUpperUpLeft: 0.28,
    mouthUpperUpRight: 0.28,
    mouthLowerDownLeft: 0.16,
    mouthLowerDownRight: 0.16,
    mouthPressLeft: 0.12,
    mouthPressRight: 0.12,
  },
  TH: {
    jawOpen: 0.16,
    tongueOut: 0.38,
    mouthLowerDownLeft: 0.14,
    mouthLowerDownRight: 0.14,
  },
  L: {
    jawOpen: 0.26,
    tongueOut: 0.28,
    mouthLowerDownLeft: 0.18,
    mouthLowerDownRight: 0.18,
  },
  S_Z: {
    jawOpen: 0.1,
    mouthStretchLeft: 0.32,
    mouthStretchRight: 0.32,
  },
  SH_CH: {
    jawOpen: 0.14,
    mouthFunnel: 0.36,
    mouthPucker: 0.22,
  },
  R: {
    jawOpen: 0.2,
    mouthFunnel: 0.24,
    tongueOut: 0.08,
  },
};

export function visemeToBlendshapes(viseme: SpeechViseme, intensity: number): Record<string, number> {
  const shape = SHAPES[viseme] ?? REST;
  const energy = clampWeight(intensity);
  const weights: Record<string, number> = {};
  if (viseme === "REST" || energy < 0.03) return weights;
  const closed = viseme === "M_B_P";
  const scale = closed ? 1 : 0.38 + energy * 0.62;
  for (const [name, value] of Object.entries(shape)) {
    if (typeof value !== "number") continue;
    weights[name] = clampWeight(value * scale);
  }
  return weights;
}

export { SHAPES as VISEME_BLENDSHAPES };
