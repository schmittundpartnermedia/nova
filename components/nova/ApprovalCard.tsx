"use client";

export function ApprovalCard({
  description,
  busy,
  allowStanding,
  onApprove,
  onAlwaysAllow,
  onReject,
}: {
  description: string;
  busy: boolean;
  allowStanding?: boolean;
  onApprove: () => void;
  onAlwaysAllow?: () => void;
  onReject: () => void;
}) {
  return (
    <div className="nova-card nova-panel" style={{ width: "min(92%, 480px)", textAlign: "center", marginBottom: 12 }}>
      <h3>Freigabe erforderlich</h3>
      <p className="nova-quote">{description}</p>
      <div className="mt-4 flex justify-center gap-2" style={{ flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={onReject} className="nova-chip">
          Nicht jetzt
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="nova-chip"
          style={{ background: "rgba(255, 255, 255, 0.14)", color: "#fff" }}
        >
          Freigeben
        </button>
        {allowStanding && onAlwaysAllow ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAlwaysAllow}
            className="nova-chip"
            style={{ background: "rgba(255, 255, 255, 0.16)", color: "#fff" }}
          >
            Immer erlauben
          </button>
        ) : null}
      </div>
    </div>
  );
}
