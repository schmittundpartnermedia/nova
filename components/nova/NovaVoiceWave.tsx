const BALKEN = 25;
const PUNKTE = 9;

/** Wellenform unter der Eingabe: symmetrische Balken mit gepunkteten Ausläufern; beim Zuhören folgt sie dem Pegel. */
export function NovaVoiceWave({
  listening,
  amplitude = null,
  sessionLabel = null,
}: {
  listening: boolean;
  amplitude?: number | null;
  sessionLabel?: string | null;
}) {
  const mitte = (BALKEN - 1) / 2;
  const pegel = listening && typeof amplitude === "number" ? Math.min(1, amplitude * 1.6) : null;
  const punkte = (seite: "links" | "rechts") => (
    <span className={`nova-wave-punkte ${seite}`}>
      {Array.from({ length: PUNKTE }, (_, index) => (
        <i key={index} style={{ opacity: seite === "links" ? 0.15 + (index / PUNKTE) * 0.5 : 0.65 - (index / PUNKTE) * 0.5 }} />
      ))}
    </span>
  );
  return (
    <div className={`nova-voice ${listening ? "session-on" : ""}`} aria-hidden="true">
      <div className={`nova-wave ${listening ? "listening" : "idle"}`}>
        {punkte("links")}
        {Array.from({ length: BALKEN }, (_, index) => {
          const huelle = Math.pow(1 - Math.abs(index - mitte) / (mitte + 1), 1.6);
          const basis = 5 + huelle * 34;
          const hoehe = pegel == null ? basis : 4 + huelle * (10 + pegel * 40);
          return <span key={index} style={{ height: `${hoehe}px`, animationDelay: `${Math.abs(index - mitte) * 0.07}s` }} />;
        })}
        {punkte("rechts")}
      </div>
      <span className="nova-voice-label">{sessionLabel ?? "Sprich mit mir"}</span>
    </div>
  );
}
