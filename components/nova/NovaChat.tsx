"use client";

import { useEffect, useRef, useState } from "react";
import { HudMarkdown } from "@/lib/hud-markdown";
import type { ChatKarte, ChatNachricht } from "@/services/chat";

/** Live-Zeilen der laufenden Anfrage, bis sie gespeichert im Verlauf stehen. */
export type LiveZeile = { id: string; rolle: "user" | "assistant"; text: string; wartet?: boolean };

function uhrzeit(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_TEXT: Record<string, string> = {
  draft: "Entwurf – noch nicht gesendet",
  sent: "Gesendet",
  superseded: "Ersetzt",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  wartet_auf_freigabe: "Wartet auf Freigabe",
  laeuft: "Läuft",
  fertig: "Fertig",
  abgebrochen: "Abgebrochen",
};

function Karte({ karte, onSend, busy }: { karte: ChatKarte; onSend: (text: string) => void; busy: boolean }) {
  if (karte.typ === "entwurf") {
    return (
      <div className={`nova-chat-karte status-${karte.status}`}>
        <div className="nova-chat-karte-kopf">
          <span>Mail-Entwurf</span>
          <span className="nova-chat-karte-status">{STATUS_TEXT[karte.status] ?? karte.status}</span>
        </div>
        <dl className="nova-chat-karte-meta">
          <dt>Von</dt>
          <dd>{karte.absender}</dd>
          <dt>An</dt>
          <dd>{karte.an}</dd>
          <dt>Betreff</dt>
          <dd>{karte.betreff}</dd>
        </dl>
        <pre className="nova-chat-karte-text">{karte.text}</pre>
        {karte.status === "draft" && !karte.teilVonKampagne ? (
          <div className="nova-chat-karte-aktionen">
            <button type="button" disabled={busy} onClick={() => onSend("Senden.")}>
              Freigeben &amp; senden
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`nova-chat-karte status-${karte.status}`}>
      <div className="nova-chat-karte-kopf">
        <span>Kampagne</span>
        <span className="nova-chat-karte-status">{STATUS_TEXT[karte.status] ?? karte.status}</span>
      </div>
      <p className="nova-chat-karte-zeile">
        {karte.name} · {karte.gesendet}/{karte.gesamt} gesendet
      </p>
      {karte.status === "wartet_auf_freigabe" ? (
        <div className="nova-chat-karte-aktionen">
          <button type="button" disabled={busy} onClick={() => onSend("Ja, los.")}>
            Kampagne freigeben
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function NovaChat({
  version,
  live,
  busy,
  onSend,
}: {
  version: number;
  live: LiveZeile[];
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [nachrichten, setNachrichten] = useState<ChatNachricht[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let abgebrochen = false;
    void (async () => {
      try {
        const response = await fetch("/api/nova/chat", { cache: "no-store" });
        const data = (await response.json()) as { ok: boolean; nachrichten?: ChatNachricht[]; error?: string };
        if (abgebrochen) return;
        if (!data.ok) {
          setFehler(data.error ?? "Verlauf nicht ladbar.");
          return;
        }
        setFehler(null);
        setNachrichten(data.nachrichten ?? []);
      } catch {
        if (!abgebrochen) setFehler("Verlauf nicht ladbar.");
      }
    })();
    return () => {
      abgebrochen = true;
    };
  }, [version]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [nachrichten, live]);

  return (
    <aside className="nova-chat" aria-label="Gespräch mit NOVA">
      <div className="nova-chat-kopf">Gespräch</div>
      <div className="nova-chat-verlauf" ref={scroller}>
        {fehler ? <p className="nova-chat-hinweis">{fehler}</p> : null}
        {!fehler && nachrichten.length === 0 && live.length === 0 ? (
          <p className="nova-chat-hinweis">Noch nichts gesagt. Taste halten oder unten tippen.</p>
        ) : null}
        {nachrichten.map((nachricht) => (
          <section key={nachricht.id} className={`nova-chat-msg ${nachricht.rolle} ${nachricht.meldung ? "meldung" : ""}`}>
            <div className="nova-chat-msg-kopf">
              <span>{nachricht.rolle === "user" ? "Du" : nachricht.meldung ? "NOVA · Meldung" : "NOVA"}</span>
              <time>{uhrzeit(nachricht.zeit)}</time>
            </div>
            {nachricht.schritte.length ? (
              <details className="nova-chat-schritte">
                <summary>
                  {nachricht.schritte.length} {nachricht.schritte.length === 1 ? "Schritt" : "Schritte"}
                </summary>
                <ol>
                  {nachricht.schritte.map((schritt, index) => (
                    <li key={index} className={schritt.ok ? (schritt.ausgefuehrt ? "ausgefuehrt" : "gelesen") : "fehler"}>
                      <span>{schritt.werkzeug}</span>
                      <em>{schritt.kurz}</em>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            <div className="nova-chat-text">
              <HudMarkdown text={nachricht.text} />
            </div>
            {nachricht.karten.map((karte) => (
              <Karte key={`${karte.typ}-${karte.id}`} karte={karte} onSend={onSend} busy={busy} />
            ))}
          </section>
        ))}
        {live.map((zeile) => (
          <section key={zeile.id} className={`nova-chat-msg ${zeile.rolle} live`}>
            <div className="nova-chat-msg-kopf">
              <span>{zeile.rolle === "user" ? "Du" : "NOVA"}</span>
            </div>
            <div className="nova-chat-text">
              {zeile.text ? <HudMarkdown text={zeile.text} /> : <p className="nova-chat-wartet">{zeile.wartet ? "arbeitet …" : ""}</p>}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
