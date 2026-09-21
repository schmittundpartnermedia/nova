import type { CSSProperties } from "react";

export function NovaJaw({
  intensity,
  speaking,
}: {
  intensity: number;
  speaking: boolean;
}) {
  const drop = speaking ? Math.min(2.8, Math.max(0, intensity) * 2.8) : 0;
  return (
    <div
      className="nova-jaw"
      data-speaking={speaking ? "true" : "false"}
      style={{ "--nova-jaw-drop": `${drop.toFixed(2)}px` } as CSSProperties}
    >
      <span className="nova-jaw-hint" />
    </div>
  );
}
