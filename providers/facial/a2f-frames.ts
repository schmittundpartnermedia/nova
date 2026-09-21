import type { NvidiaA2FAnimationPayload } from "@/types/facial";
import type { NovaFacialFrame } from "@/types/avatar";

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
