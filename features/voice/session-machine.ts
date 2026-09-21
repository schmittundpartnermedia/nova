import type { VoiceSessionState } from "@/features/voice/session-types";

export type VoiceSessionEvent =
  | { type: "START_REQUESTED" }
  | { type: "START_READY" }
  | { type: "START_FAILED"; error: string }
  | { type: "VOICE_START"; at: number }
  | { type: "VOICE_END"; at: number }
  | { type: "SILENCE_TIMEOUT"; hasTranscript: boolean }
  | { type: "EXTERNAL_PROCESS" }
  | { type: "NOVA_SPEAKING" }
  | { type: "NOVA_IDLE" }
  | { type: "BARGE_IN"; at: number }
  | { type: "STOP" }
  | { type: "ERROR"; error: string };

export type VoiceSessionModel = {
  state: VoiceSessionState;
  error: string | null;
  turnStartedAt: number | null;
  lastVoiceEndAt: number | null;
};

export const INITIAL_VOICE_SESSION: VoiceSessionModel = {
  state: "OFF",
  error: null,
  turnStartedAt: null,
  lastVoiceEndAt: null,
};

export function reduceVoiceSession(model: VoiceSessionModel, event: VoiceSessionEvent): VoiceSessionModel {
  switch (event.type) {
    case "START_REQUESTED":
      if (model.state !== "OFF" && model.state !== "ERROR") return model;
      return { state: "STARTING", error: null, turnStartedAt: null, lastVoiceEndAt: null };
    case "START_READY":
      if (model.state !== "STARTING") return model;
      return { ...model, state: "LISTENING", error: null };
    case "START_FAILED":
      if (model.state !== "STARTING") return model;
      return { state: "ERROR", error: event.error, turnStartedAt: null, lastVoiceEndAt: null };
    case "VOICE_START":
      if (model.state === "LISTENING" || model.state === "SILENCE_WAIT" || model.state === "INTERRUPTED") {
        return {
          ...model,
          state: "USER_SPEAKING",
          error: null,
          turnStartedAt: model.turnStartedAt ?? event.at,
          lastVoiceEndAt: null,
        };
      }
      return model;
    case "VOICE_END":
      if (model.state !== "USER_SPEAKING") return model;
      return { ...model, state: "SILENCE_WAIT", lastVoiceEndAt: event.at };
    case "SILENCE_TIMEOUT":
      if (model.state !== "SILENCE_WAIT") return model;
      if (!event.hasTranscript) {
        return { ...model, state: "LISTENING", turnStartedAt: null, lastVoiceEndAt: null };
      }
      return { ...model, state: "PROCESSING", lastVoiceEndAt: null };
    case "EXTERNAL_PROCESS":
      if (
        model.state !== "LISTENING" &&
        model.state !== "USER_SPEAKING" &&
        model.state !== "SILENCE_WAIT" &&
        model.state !== "INTERRUPTED" &&
        model.state !== "STARTING"
      ) {
        return model;
      }
      return { ...model, state: "PROCESSING", turnStartedAt: null, lastVoiceEndAt: null };
    case "NOVA_SPEAKING":
      if (model.state !== "PROCESSING" && model.state !== "LISTENING") return model;
      return { ...model, state: "NOVA_SPEAKING" };
    case "NOVA_IDLE":
      if (model.state !== "PROCESSING" && model.state !== "NOVA_SPEAKING" && model.state !== "INTERRUPTED") {
        return model;
      }
      return { ...model, state: "LISTENING", turnStartedAt: null, lastVoiceEndAt: null };
    case "BARGE_IN":
      if (model.state !== "NOVA_SPEAKING") return model;
      return {
        state: "INTERRUPTED",
        error: null,
        turnStartedAt: event.at,
        lastVoiceEndAt: null,
      };
    case "STOP":
      return { ...INITIAL_VOICE_SESSION };
    case "ERROR":
      if (model.state === "OFF") return model;
      return { state: "ERROR", error: event.error, turnStartedAt: null, lastVoiceEndAt: null };
    default:
      return model;
  }
}
