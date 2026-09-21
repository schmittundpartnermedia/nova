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
  const open = speaking && viseme !== "REST" && viseme !== "M_B_P" && intensity > 0.04;
  return (
    <div
      className="nova-mouth"
      data-viseme={viseme}
      data-speaking={speaking ? "true" : "false"}
      data-open={open ? "true" : "false"}
    >
      <span className="nova-mouth-aperture">
        <span className="nova-mouth-cavity" />
        <span className="nova-mouth-teeth" />
        <span className="nova-mouth-lip" />
      </span>
    </div>
  );
}
