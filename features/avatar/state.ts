import type { OrbState } from "@/types";
import type { NovaAvatarMode } from "@/types/avatar";

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
