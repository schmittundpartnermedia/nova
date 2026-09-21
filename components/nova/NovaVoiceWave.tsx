export function NovaVoiceWave({
  listening,
  amplitude = null,
  sessionLabel = null,
}: {
  listening: boolean;
  amplitude?: number | null;
  sessionLabel?: string | null;
}) {
  const measured = typeof amplitude === "number";
  return (
    <div className={`nova-voice ${listening ? "session-on" : ""}`} aria-hidden="true">
      <span className="nova-voice-label">{sessionLabel ?? "Sprich mit mir"}</span>
      <div className={`nova-wave ${listening ? "listening" : "idle"}`}>
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            style={{
              animationDelay: `${index * 0.08}s`,
              height: measured && listening ? `${6 + amplitude * (8 + ((index * 7) % 10))}px` : `${6 + ((index * 7) % 10)}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
