"use client";

import type { OrbState } from "@/types";
import { NovaHud } from "@/components/nova/NovaHud";
import { NovaParticles } from "@/components/nova/NovaParticles";
import { NovaDigitalHuman } from "@/components/nova/NovaDigitalHuman";
import {
  IDLE_PERFORMANCE,
  modeFromOrbState,
  type NovaAvatarPerformance,
} from "@/components/nova/avatar-performance";
import type { DigitalHumanRuntime } from "@/features/avatar/runtime";

export function NovaAvatar({
  state,
  performance = IDLE_PERFORMANCE,
  onRuntime,
}: {
  state: OrbState;
  performance?: NovaAvatarPerformance;
  onRuntime?: (runtime: DigitalHumanRuntime | null) => void;
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
        <div className="nova-layer nova-layer-glow">
          <div className="nova-glow-asset" />
          <div className="nova-floor" />
        </div>
        <div className="nova-layer nova-layer-hud">
          <NovaHud />
          <div className="nova-listen-ring" />
        </div>
        <div className="nova-avatar-live">
          <NovaDigitalHuman
            state={state}
            isSpeaking={performance.isSpeaking}
            speechIntensity={intensity}
            emotion={performance.emotion}
            onRuntime={onRuntime}
          />
          <div className="nova-layer nova-layer-effects">
            <div className="nova-lightpaths" />
            <div className="nova-sweep" />
            <span className="nova-error-pip" />
          </div>
        </div>
        <NovaParticles />
      </div>
    </div>
  );
}
