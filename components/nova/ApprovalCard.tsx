"use client";

export function ApprovalCard({
  description,
  busy,
  onApprove,
  onReject,
}: {
  description: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="nova-card nova-panel" style={{ width: "min(92%, 480px)", textAlign: "center", marginBottom: 12 }}>
      <h3>Freigabe erforderlich</h3>
      <p className="nova-quote">{description}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="nova-chip"
        >
          Nicht jetzt
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="nova-chip"
          style={{ background: "rgba(227, 154, 78, 0.18)", color: "#f3d2aa" }}
        >
          Freigeben
        </button>
      </div>
    </div>
  );
}
