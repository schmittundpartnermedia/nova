export function NovaEyes({
  intensity = 0.7,
  speaking = false,
}: {
  intensity?: number;
  speaking?: boolean;
}) {
  return (
    <div className="nova-eyes" data-blink-ready="false" data-speaking={speaking ? "true" : "false"} aria-hidden="true">
      <span className="nova-brow-node" />
      <span className="nova-eye left" style={{ opacity: 0.45 + intensity * 0.5 }} />
      <span className="nova-eye right" style={{ opacity: 0.45 + intensity * 0.5 }} />
    </div>
  );
}
