"use client";

import type { OrbState } from "@/types";
import { NovaHud } from "@/components/nova/NovaHud";
import { NovaPortrait } from "@/components/nova/NovaPortrait";
import { NovaVoiceAura } from "@/components/nova/NovaVoiceAura";
import {
  IDLE_PERFORMANCE,
  modeFromOrbState,
  type NovaAvatarPerformance,
} from "@/components/nova/avatar-performance";

export function NovaAvatar({
  state,
  performance = IDLE_PERFORMANCE,
}: {
  state: OrbState;
  performance?: NovaAvatarPerformance;
}) {
  const mode = modeFromOrbState(state);
  const intensity = Math.min(1, Math.max(0, performance.speechIntensity));

  return (
    <div
      className="nova-avatar-stage"
      data-state={state}
      data-mode={mode}
      data-speaking={performance.isSpeaking ? "true" : "false"}
      data-emotion={performance.emotion}
      data-gaze={performance.gazeTarget}
      style={{ ["--nova-speech-intensity" as string]: intensity.toFixed(3) }}
      aria-hidden="true"
    >
      <div className="nova-avatar">
        <div className="nova-layer nova-layer-aura">
          <NovaVoiceAura speaking={performance.isSpeaking} intensity={intensity} />
          <div className="nova-lightpaths" />
          <div className="nova-sweep" />
        </div>
        <div className="nova-layer nova-layer-hud">
          <NovaHud />
          <div className="nova-listen-ring" />
          <span className="nova-error-pip" />
        </div>
        <div className="nova-layer nova-layer-portrait">
          <NovaPortrait />
        </div>
      </div>
    </div>
  );
}
