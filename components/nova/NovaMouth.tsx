import type { CSSProperties } from "react";
import type { SpeechViseme } from "@/types/voice";

export function NovaMouth({
  viseme,
  intensity,
  speaking,
}: {
  viseme: SpeechViseme;
  intensity: number;
  speaking: boolean;
}) {
  const open = speaking && viseme !== "REST" && viseme !== "M_B_P";
  return (
    <div
      className="nova-mouth"
      data-viseme={viseme}
      data-speaking={speaking ? "true" : "false"}
      data-open={open ? "true" : "false"}
      style={{ "--nova-mouth-energy": String(Math.min(1, Math.max(0, intensity))) } as CSSProperties}
    >
      <span className="nova-mouth-aperture">
        <span className="nova-mouth-cavity" />
        <span className="nova-mouth-teeth" />
      </span>
    </div>
  );
}
