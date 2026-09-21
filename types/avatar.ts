import type { OrbState } from "@/types";

export const NOVA_BLENDSHAPE_NAMES = [
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
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "eyeSquintLeft",
  "eyeSquintRight",
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
  "eyeWideLeft",
  "eyeWideRight",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft",
  "cheekSquintRight",
  "noseSneerLeft",
  "noseSneerRight",
  "tongueOut",
] as const;

export type NovaBlendshapeName = (typeof NOVA_BLENDSHAPE_NAMES)[number];

export type NovaBlendshapeWeights = Partial<Record<string, number>>;

export type NovaVec3 = { x: number; y: number; z: number };

export type NovaAvatarEmotion =
  | "neutral"
  | "warm"
  | "positive"
  | "focused"
  | "concerned"
  | "confident";

export type NovaGazeTarget = "user" | "ui" | "away";

export type NovaAvatarMode =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "approval"
  | "done"
  | "error";

export type NovaRenderQuality = "HIGH" | "MEDIUM" | "LOW";

export type NovaFacialFrame = {
  timestampMs: number;
  blendshapes: NovaBlendshapeWeights;
  headRotation?: NovaVec3;
  headPosition?: NovaVec3;
  eyeTarget?: NovaVec3;
  emotion?: NovaAvatarEmotion;
  confidence?: number;
};

export type NovaBonePose = {
  rotation: NovaVec3;
  position?: NovaVec3;
};

export type NovaRigInfo = {
  isDevelopmentRig: boolean;
  sourceUrl: string;
  morphTargets: string[];
  bones: string[];
  mappedBlendshapes: string[];
  unmappedBlendshapes: string[];
};

export type AvatarTimelineSample = {
  audioTimeMs: number;
  frame: NovaFacialFrame | null;
};

export type NovaAvatarPerformance = {
  isSpeaking: boolean;
  speechIntensity: number;
  viseme: string;
  emotion: NovaAvatarEmotion;
  gazeTarget: NovaGazeTarget;
};

export { type OrbState };
