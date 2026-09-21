export type CommunicationLine = {
  id: string;
  speaker: "JOACHIM" | "NOVA";
  text: string;
  pending?: boolean;
};

export function NovaCommunicationLayer({
  open,
  lines,
  onReopen,
}: {
  open: boolean;
  lines: CommunicationLine[];
  onReopen: () => void;
}) {
  return (
    <>
      <aside className={`nova-comm ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="nova-comm-inner">
          {lines.map((line, index) => (
            <section
              key={line.id}
              className={`nova-comm-line ${line.pending ? "pending" : ""} ${index < lines.length - 2 ? "prior" : ""}`}
            >
              <span className="nova-comm-speaker">{line.speaker}</span>
              <p>{line.text || (line.pending ? "…" : "")}</p>
            </section>
          ))}
        </div>
      </aside>
      <button
        type="button"
        className={`nova-comm-reopen ${open ? "hidden" : ""}`}
        onClick={onReopen}
        aria-label="Aktuelles Gespräch öffnen"
      >
        Verlauf
      </button>
    </>
  );
}
