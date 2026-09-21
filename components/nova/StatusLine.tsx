"use client";

export function StatusLine({ text }: { text: string }) {
  return (
    <p className="min-h-6 text-center text-[13px] tracking-[0.01em] text-white/45">{text}</p>
  );
}
