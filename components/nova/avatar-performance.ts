import type { OrbState } from "@/types";
import type { SpeechEmotion, SpeechViseme } from "@/types/voice";

export type NovaAvatarMode =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "approval"
  | "done"
  | "error";

export type NovaViseme = SpeechViseme;
export type NovaEmotion = SpeechEmotion;
export type NovaGazeTarget = "user" | "ui" | "away";

export type NovaAvatarPerformance = {
  isSpeaking: boolean;
  speechIntensity: number;
  viseme: NovaViseme;
  emotion: NovaEmotion;
  gazeTarget: NovaGazeTarget;
};

export const IDLE_PERFORMANCE: NovaAvatarPerformance = {
  isSpeaking: false,
  speechIntensity: 0,
  viseme: "REST",
  emotion: "neutral",
  gazeTarget: "user",
};

export function modeFromOrbState(state: OrbState): NovaAvatarMode {
  if (state === "LISTENING") return "listening";
  if (state === "THINKING") return "thinking";
  if (state === "SPEAKING") return "speaking";
  if (state === "WORKING") return "working";
  if (state === "WAITING_FOR_APPROVAL") return "approval";
  if (state === "DONE") return "done";
  if (state === "ERROR") return "error";
  return "idle";
}

export function performanceForState(state: OrbState): NovaAvatarPerformance {
  if (state === "LISTENING") {
    return { isSpeaking: false, speechIntensity: 0, viseme: "REST", emotion: "focused", gazeTarget: "user" };
  }
  if (state === "THINKING" || state === "WORKING") {
    return { isSpeaking: false, speechIntensity: 0, viseme: "REST", emotion: "focused", gazeTarget: "user" };
  }
  if (state === "SPEAKING") {
    return { isSpeaking: true, speechIntensity: 0, viseme: "REST", emotion: "neutral", gazeTarget: "user" };
  }
  if (state === "WAITING_FOR_APPROVAL" || state === "ERROR") {
    return { isSpeaking: false, speechIntensity: 0, viseme: "REST", emotion: "concerned", gazeTarget: "user" };
  }
  return IDLE_PERFORMANCE;
}
