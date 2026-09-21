import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaAvatarMode, NovaAvatarPerformance, NovaGazeTarget } from "@/types/avatar";
import { modeFromOrbState } from "@/features/avatar/state";

export type { NovaAvatarMode, NovaAvatarEmotion, NovaGazeTarget, NovaAvatarPerformance };

export const IDLE_PERFORMANCE: NovaAvatarPerformance = {
  isSpeaking: false,
  speechIntensity: 0,
  viseme: "REST",
  emotion: "neutral",
  gazeTarget: "user",
};

export { modeFromOrbState };

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
  if (state === "DONE") {
    return { isSpeaking: false, speechIntensity: 0, viseme: "REST", emotion: "warm", gazeTarget: "user" };
  }
  return IDLE_PERFORMANCE;
}
