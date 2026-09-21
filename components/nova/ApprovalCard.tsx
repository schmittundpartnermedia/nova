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
    <div className="w-full max-w-[480px] rounded-2xl border border-white/10 bg-white/4 px-5 py-4 text-center backdrop-blur-md">
      <p className="text-[13px] leading-5 text-white/70">{description}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="rounded-full px-4 py-1.5 text-[12px] text-white/50 transition hover:bg-white/8 hover:text-white/80"
        >
          Nicht jetzt
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="rounded-full bg-white/12 px-4 py-1.5 text-[12px] text-white/85 transition hover:bg-white/18"
        >
          Freigeben
        </button>
      </div>
    </div>
  );
}
