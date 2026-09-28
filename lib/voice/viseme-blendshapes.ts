import type { NovaBlendshapeWeights } from "@/types/avatar";
import type { SpeechViseme } from "@/types/voice";

/** Minimale Viseme→Blendshapes ohne Avatar-Feature. */
export function visemeToBlendshapes(
  viseme: SpeechViseme,
  intensity = 1,
): NovaBlendshapeWeights {
  const scale = Math.max(0, Math.min(1, intensity));
  const scaleShape = (shape: NovaBlendshapeWeights): NovaBlendshapeWeights => {
    const out: NovaBlendshapeWeights = {};
    for (const [key, value] of Object.entries(shape)) {
      if (typeof value === "number") out[key] = value * scale;
    }
    return out;
  };

  switch (viseme) {
    case "M_B_P":
      return scaleShape({ mouthClose: 0.9, jawOpen: 0 });
    case "A":
      return scaleShape({ jawOpen: 0.6 });
    case "E":
      return scaleShape({ jawOpen: 0.25, mouthStretchLeft: 0.4, mouthStretchRight: 0.4 });
    case "I":
      return scaleShape({ jawOpen: 0.15, mouthStretchLeft: 0.55, mouthStretchRight: 0.55 });
    case "O":
      return scaleShape({ jawOpen: 0.45, mouthPucker: 0.55 });
    case "U":
      return scaleShape({ jawOpen: 0.2, mouthPucker: 0.7 });
    case "F_V":
      return scaleShape({ mouthClose: 0.35, jawOpen: 0.1 });
    case "L":
      return scaleShape({ jawOpen: 0.2 });
    case "REST":
    default:
      return {};
  }
}
