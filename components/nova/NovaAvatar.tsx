import type { OrbState } from "@/types";
import { NovaFace } from "@/components/nova/NovaFace";
import { NovaEyes } from "@/components/nova/NovaEyes";
import { NovaJaw } from "@/components/nova/NovaJaw";
import { NovaMouth } from "@/components/nova/NovaMouth";
import { NovaHud } from "@/components/nova/NovaHud";
import { NovaParticles } from "@/components/nova/NovaParticles";
import {
  IDLE_PERFORMANCE,
  modeFromOrbState,
  type NovaAvatarPerformance,
} from "@/components/nova/avatar-performance";

export function NovaAvatar({
  state,
  performance = IDLE_PERFORMANCE,
  stageRef,
}: {
  state: OrbState;
  performance?: NovaAvatarPerformance;
  stageRef?: (node: HTMLDivElement | null) => void;
}) {
  const mode = modeFromOrbState(state);
  const intensity = Math.min(1, Math.max(0, performance.speechIntensity));
  const viseme = performance.viseme ?? "REST";

  return (
    <div
      ref={stageRef}
      className="nova-avatar-stage"
      data-state={state}
      data-mode={mode}
      data-speaking={performance.isSpeaking ? "true" : "false"}
      data-viseme={viseme}
      data-emotion={performance.emotion}
      data-gaze={performance.gazeTarget}
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
          <div className="nova-face-stack">
            <div className="nova-layer nova-layer-face">
              <NovaFace region="upper" />
            </div>
            <div className="nova-layer nova-layer-jaw">
              <NovaJaw intensity={intensity} speaking={performance.isSpeaking} />
            </div>
          </div>
          <div className="nova-layer nova-layer-mouth">
            <NovaMouth viseme={viseme} intensity={intensity} speaking={performance.isSpeaking} />
          </div>
          <div className="nova-layer nova-layer-eyes">
            <NovaEyes
              intensity={state === "THINKING" || state === "LISTENING" || state === "SPEAKING" ? 1 : 0.7}
              speaking={performance.isSpeaking}
            />
          </div>
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
