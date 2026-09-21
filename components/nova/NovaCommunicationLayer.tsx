"use client";

import { useEffect, useRef } from "react";
import { HudMarkdown } from "@/lib/hud-markdown";

export type CommunicationLine = {
  id: string;
  speaker: "JOACHIM" | "NOVA";
  text: string;
  pending?: boolean;
};

export function NovaCommunicationLayer({
  open,
  lines,
  hasHistory,
  onReopen,
}: {
  open: boolean;
  lines: CommunicationLine[];
  hasHistory: boolean;
  onReopen: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !open) return;
    const last = node.querySelector(".nova-comm-line:last-child");
    if (last instanceof HTMLElement) {
      node.scrollTop = Math.max(0, last.offsetTop - 6);
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lines, open]);

  return (
    <div className="nova-comm-stack">
      <aside className={`nova-comm ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="nova-comm-inner" ref={scroller}>
          <span className="nova-comm-mark" aria-hidden="true" />
          {lines.map((line, index) => (
            <section
              key={line.id}
              className={`nova-comm-line ${line.speaker.toLowerCase()} ${line.pending ? "pending" : ""} ${index < lines.length - 2 ? "prior" : ""}`}
            >
              <span className="nova-comm-speaker">{line.speaker}</span>
              {line.text ? (
                <HudMarkdown text={line.text} />
              ) : (
                <p className="nova-comm-pending">{line.pending ? "…" : ""}</p>
              )}
            </section>
          ))}
        </div>
      </aside>
      <button
        type="button"
        className={`nova-comm-reopen ${open || !hasHistory ? "hidden" : ""}`}
        onClick={onReopen}
        aria-label="Aktuelles Gespräch öffnen"
      >
        Verlauf
      </button>
    </div>
  );
}
