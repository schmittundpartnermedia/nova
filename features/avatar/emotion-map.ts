import type { NovaAvatarEmotion, NovaBlendshapeWeights } from "@/types/avatar";

export const EMOTION_BLENDSHAPES: Record<NovaAvatarEmotion, NovaBlendshapeWeights> = {
  neutral: {},
  warm: {
    mouthSmileLeft: 0.11,
    mouthSmileRight: 0.11,
    browInnerUp: 0.07,
    cheekSquintLeft: 0.05,
    cheekSquintRight: 0.05,
  },
  positive: {
    mouthSmileLeft: 0.2,
    mouthSmileRight: 0.2,
    cheekSquintLeft: 0.1,
    cheekSquintRight: 0.1,
    browInnerUp: 0.06,
    eyeSquintLeft: 0.05,
    eyeSquintRight: 0.05,
  },
  focused: {
    browDownLeft: 0.12,
    browDownRight: 0.12,
    eyeSquintLeft: 0.08,
    eyeSquintRight: 0.08,
    mouthPressLeft: 0.06,
    mouthPressRight: 0.06,
  },
  concerned: {
    browInnerUp: 0.18,
    browDownLeft: 0.08,
    browDownRight: 0.08,
    mouthFrownLeft: 0.12,
    mouthFrownRight: 0.12,
  },
  confident: {
    mouthSmileLeft: 0.09,
    mouthSmileRight: 0.09,
    browOuterUpLeft: 0.08,
    browOuterUpRight: 0.08,
    eyeWideLeft: 0.04,
    eyeWideRight: 0.04,
  },
};

export function emotionToBlendshapes(
  emotion: NovaAvatarEmotion,
  intensity = 1,
): NovaBlendshapeWeights {
  const source = EMOTION_BLENDSHAPES[emotion] ?? EMOTION_BLENDSHAPES.neutral;
  const scale = Math.min(1, Math.max(0, intensity));
  const weights: NovaBlendshapeWeights = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== "number") continue;
    weights[name] = value * scale;
  }
  return weights;
}
