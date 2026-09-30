"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NovaBackground } from "@/components/nova/NovaBackground";
import { Orb } from "@/components/nova/Orb";
import { NovaCommandBar } from "@/components/nova/NovaCommandBar";
import { NovaChat, type LiveZeile } from "@/components/nova/NovaChat";
import { NovaStatus } from "@/components/nova/NovaStatus";
import { NovaVoiceWave } from "@/components/nova/NovaVoiceWave";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { useNovaVoice } from "@/features/voice/useNovaVoice";
import { anApp, useNovaApp, useSchmal } from "@/features/app/bruecke";
import type { VoiceTurn } from "@/features/voice/session-types";
import type { OrbState } from "@/types";
import type { ProviderMode } from "@/types/ai";

const IDLE_STATUS = "Bereit für deine Anfrage";

function humanStatus(state: OrbState, text: string): string {
  if (state === "LISTENING") return text || "Zuhören";
  if (state === "WAITING_FOR_APPROVAL") return "Rückfrage";
  if (state === "THINKING") return text || "Ich denke nach …";
  if (state === "ERROR") return text?.trim() ? text : "Fehler";
  if (state === "WORKING") {
    const cleaned = text
      .replace(/\b[\w.]*Agent[\w.]*\b/gi, "")
      .replace(/\.execute\(\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned || cleaned.length < 4) return "Ich arbeite daran …";
    return cleaned;
  }
  if (state === "SPEAKING") return "NOVA spricht";
  return text;
}

async function readSse(
  response: Response,
  onEvent: (payload: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Keine Antwort vom Server.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .filter((item) => item.startsWith("data:"))
        .map((item) => item.slice(5).trim())
        .join("");
      if (!line || line === "[DONE]") continue;
      try {
        onEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

export function NovaShell() {
  const [orbState, setOrbState] = useState<OrbState>("IDLE");
  const [status, setStatus] = useState(IDLE_STATUS);
  const [busy, setBusy] = useState(false);
  const [, setProviderMode] = useState<ProviderMode | null>(null);
  const [liveZeilen, setLiveZeilen] = useState<LiveZeile[]>([]);
  const [chatVersion, setChatVersion] = useState(0);
  const idleTimer = useRef<number | null>(null);
  const interruptedRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const sendVoiceTurnRef = useRef<(turn: VoiceTurn) => void>(() => undefined);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const goIdleSoon = useCallback(
    (delay = 1800) => {
      clearIdleTimer();
      idleTimer.current = window.setTimeout(() => {
        if (sessionActiveRef.current) {
          setOrbState((current) => (current === "WAITING_FOR_APPROVAL" ? current : "LISTENING"));
          setStatus("Zuhören");
          return;
        }
        setOrbState((current) => (current === "LISTENING" ? current : "IDLE"));
        setStatus((current) => (current === "Ich höre dir zu …" || current === "Zuhören" ? current : IDLE_STATUS));
      }, delay);
    },
    [clearIdleTimer],
  );

  const {
    enabled: voiceEnabled,
    toggleEnabled,
    speaking: speechPlaying,
    unavailableHint,
    clearHint,
    beginTurn,
    ingest,
    flush,
    stop: stopVoice,
    setAfterSpeech,
  } = useNovaVoice();

  const voiceSession = useVoiceSession((turn) => {
    sendVoiceTurnRef.current(turn);
  });
  const {
    snapshot: sessionSnap,
    supported: voiceSupported,
    start: startVoiceSession,
    stop: stopVoiceSession,
    pressPushToTalk,
    releasePushToTalk,
    notifyProcessing,
    notifyNovaSpeaking,
    notifyNovaIdle,
    bindInterrupt,
  } = voiceSession;

  useEffect(() => {
    sessionActiveRef.current =
      sessionSnap.active || sessionSnap.state === "PROCESSING";
  }, [sessionSnap.active, sessionSnap.state]);

  useEffect(() => {
    const onPtt = (event: Event) => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      if (phase === "down") {
        clearIdleTimer();
        setOrbState("LISTENING");
        setStatus("Höre");
        pressPushToTalk();
      } else if (phase === "up") {
        releasePushToTalk();
      }
    };
    window.addEventListener("nova-ptt", onPtt as EventListener);
    return () => window.removeEventListener("nova-ptt", onPtt as EventListener);
  }, [clearIdleTimer, pressPushToTalk, releasePushToTalk]);

  useEffect(() => {
    setAfterSpeech((next) => {
      if (sessionActiveRef.current) {
        notifyNovaIdle();
        setOrbState((current) => (current === "WAITING_FOR_APPROVAL" ? current : "LISTENING"));
        setStatus("Zuhören");
        return;
      }
      if (next === "listen") return;
      setOrbState((current) => {
        if (current === "LISTENING" || current === "WAITING_FOR_APPROVAL") return current;
        if (next === "idle") return "IDLE";
        return "DONE";
      });
      if (next === "idle") {
        setStatus((current) => (current === "Ich höre dir zu …" || current === "Zuhören" ? current : IDLE_STATUS));
        return;
      }
      goIdleSoon(1600);
    });
  }, [goIdleSoon, notifyNovaIdle, setAfterSpeech]);

  useEffect(() => {
    if (speechPlaying && sessionActiveRef.current) {
      notifyNovaSpeaking();
    }
  }, [notifyNovaSpeaking, speechPlaying]);

  useEffect(() => {
    bindInterrupt(() => {
      interruptedRef.current = true;
      stopVoice("idle");
    });
  }, [bindInterrupt, stopVoice]);

  const sendMessage = useCallback(async (
    message: string,
    inputMode: "text" | "voice" = "text",
    voiceTurn?: VoiceTurn,
  ) => {
    interruptedRef.current = false;
    stopVoice("idle");
    clearIdleTimer();
    if (sessionActiveRef.current) notifyProcessing();
    setBusy(true);
    setOrbState("THINKING");
    setStatus("Ich denke nach …");
    clearHint();
    if (voiceEnabled) beginTurn("");

    setLiveZeilen([
      { id: `user-${Date.now()}`, rolle: "user", text: message },
      { id: `nova-${Date.now()}`, rolle: "assistant", text: "", wartet: true },
    ]);
    const zeigeAntwort = (text: string) =>
      setLiveZeilen((current) => current.map((zeile) => (zeile.rolle === "assistant" ? { ...zeile, text, wartet: false } : zeile)));

    let accumulated = "";
    // Gesprochen wird: Sofort-Ansage (falls NOVA nachschauen muss) + Antwort.
    let ansage = "";
    const gesprochen = () => (ansage ? `${ansage} ${accumulated}` : accumulated);
    try {
      const response = await fetch("/api/nova/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          message,
          inputMode,
          ...(voiceTurn
            ? {
                voice: {
                  startedAt: voiceTurn.startedAt,
                  endedAt: voiceTurn.endedAt,
                  durationMs: voiceTurn.durationMs,
                  confidence: voiceTurn.confidence,
                  sttEngine: voiceTurn.sttEngine,
                },
              }
            : {}),
        }),
      });
      if (!response.ok && !response.body) {
        setOrbState("ERROR");
        setProviderMode("error");
        setStatus("Etwas ist schiefgelaufen.");
        if (sessionActiveRef.current) notifyNovaIdle();
        return;
      }
      await readSse(response, (payload) => {
        const type = String(payload.type ?? "");
        if (type === "status") {
          setOrbState((payload.orbState as OrbState) ?? "THINKING");
          if (typeof payload.statusMessage === "string") setStatus(payload.statusMessage);
        }
        if (type === "provider") {
          setProviderMode((payload.providerMode as ProviderMode) ?? null);
        }
        if (type === "delta" && typeof payload.delta === "string") {
          accumulated += payload.delta;
          zeigeAntwort(accumulated);
          if (voiceEnabled && !interruptedRef.current) ingest(gesprochen());
        }
        if (type === "ansage" && typeof payload.text === "string") {
          ansage = payload.text;
          zeigeAntwort(ansage);
          if (voiceEnabled && !interruptedRef.current) ingest(`${ansage} `);
        }
        if (type === "done") {
          if (typeof payload.reply === "string" && payload.reply) {
            accumulated = payload.reply;
            zeigeAntwort(accumulated);
          }
          setProviderMode((payload.providerMode as ProviderMode) ?? null);
          const nextState = (payload.orbState as OrbState) ?? "DONE";
          if (typeof payload.statusMessage === "string") setStatus(payload.statusMessage);
          if (interruptedRef.current) {
            return;
          }
          if (voiceEnabled && accumulated.trim()) {
            flush(gesprochen());
            if (nextState === "WAITING_FOR_APPROVAL") {
              setOrbState("WAITING_FOR_APPROVAL");
            } else if (nextState === "ERROR") {
              setOrbState("ERROR");
            }
          } else {
            if (sessionActiveRef.current) {
              notifyNovaIdle();
              if (nextState === "WAITING_FOR_APPROVAL") {
                setOrbState("WAITING_FOR_APPROVAL");
              } else if (nextState === "ERROR") {
                setOrbState("ERROR");
              } else {
                setOrbState("LISTENING");
                setStatus("Zuhören");
              }
            } else {
              setOrbState(nextState);
              if (nextState === "DONE") goIdleSoon(1800);
              if (nextState === "ERROR") goIdleSoon(4200);
            }
          }
        }
        if (type === "error") {
          setOrbState("ERROR");
          setProviderMode("error");
          setStatus(String(payload.statusMessage ?? "Etwas ist schiefgelaufen."));
          if (sessionActiveRef.current) notifyNovaIdle();
          zeigeAntwort(String(payload.error ?? "Etwas ist schiefgelaufen."));
        }
      });
    } catch {
      setOrbState("ERROR");
      setProviderMode("error");
      setStatus("Etwas ist schiefgelaufen.");
      if (sessionActiveRef.current) notifyNovaIdle();
    } finally {
      setBusy(false);
      // Die Anfrage ist gespeichert: Verlauf neu laden (mit Schritten und Karten), Live-Zeilen weg.
      setChatVersion((current) => current + 1);
      setLiveZeilen([]);
    }
  }, [
    beginTurn,
    clearHint,
    clearIdleTimer,
    flush,
    goIdleSoon,
    ingest,
    stopVoice,
    voiceEnabled,
    notifyNovaIdle,
    notifyProcessing,
  ]);

  const [kampagnenZeile, setKampagnenZeile] = useState<string | null>(null);
  const meldungRef = useRef({ busy: false, speaking: false, voiceEnabled: false, beginTurn, flush });
  useEffect(() => {
    meldungRef.current = { busy, speaking: speechPlaying, voiceEnabled, beginTurn, flush };
  }, [beginTurn, busy, flush, speechPlaying, voiceEnabled]);

  // Meldungen aus dem Hintergrund (Kampagne fertig, Antwort eingegangen, Neustart) und Kampagnen-Fortschritt.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/nova/status", { cache: "no-store" });
        const data = (await response.json()) as {
          meldungen?: Array<{ id: string; text: string }>;
          kampagnen?: Array<{ name: string; gesamt: number; gesendet: number }>;
          arbeit?: string[];
        };
        if (stopped) return;
        const zeilen = [
          ...(data.kampagnen ?? []).map((k) => `arbeite: Kampagne ${k.gesendet}/${k.gesamt}`),
          ...(data.arbeit ?? []),
        ];
        setKampagnenZeile(zeilen.length ? zeilen.join(" · ") : null);
        const meldungen = data.meldungen ?? [];
        if (!meldungen.length) return;
        const ui = meldungRef.current;
        setChatVersion((current) => current + 1);
        const text = meldungen.map((meldung) => meldung.text).join("\n\n");
        if (ui.voiceEnabled && !ui.busy && !ui.speaking) {
          ui.beginTurn(text, "idle");
          ui.flush(text);
        }
      } catch {
        // Statusabfrage ist optional; der nächste Durchlauf versucht es wieder.
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 15_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    sendVoiceTurnRef.current = (turn) => {
      void sendMessage(turn.transcript, "voice", turn);
    };
  }, [sendMessage]);

  const stopSpeech = useCallback(() => {
    interruptedRef.current = true;
    stopVoice("idle");
    if (sessionActiveRef.current) {
      notifyNovaIdle();
      setOrbState("LISTENING");
      setStatus("Zuhören");
      return;
    }
    setOrbState("IDLE");
    setStatus(IDLE_STATUS);
  }, [notifyNovaIdle, stopVoice]);

  const handleMic = useCallback(() => {
    if (sessionSnap.active || sessionSnap.state === "STARTING") {
      interruptedRef.current = true;
      stopVoice("idle");
      stopVoiceSession();
      setOrbState("IDLE");
      setStatus(IDLE_STATUS);
      return;
    }
    if (speechPlaying) {
      interruptedRef.current = true;
      stopVoice("idle");
    }
    clearIdleTimer();
    setOrbState("LISTENING");
    setStatus("Zuhören");
    startVoiceSession();
  }, [
    clearIdleTimer,
    sessionSnap.active,
    sessionSnap.state,
    speechPlaying,
    startVoiceSession,
    stopVoice,
    stopVoiceSession,
  ]);

  const app = useNovaApp();
  const ecke = useSchmal();

  let uiState: OrbState = orbState;
  if (speechPlaying) {
    uiState = "SPEAKING";
  } else if (orbState !== "WAITING_FOR_APPROVAL" && orbState !== "WORKING") {
    if (sessionSnap.state === "ERROR") uiState = "ERROR";
    else if (sessionSnap.state === "PROCESSING") uiState = "THINKING";
    else if (sessionSnap.capturing || sessionSnap.state === "STARTING") uiState = "LISTENING";
  }
  const shownStatus =
    sessionSnap.state === "ERROR"
      ? sessionSnap.error ?? "Voice Session fehlgeschlagen."
      : speechPlaying
        ? "NOVA spricht"
        : sessionSnap.state === "USER_SPEAKING" || sessionSnap.state === "INTERRUPTED"
          ? "Ich höre zu"
          : sessionSnap.state === "LISTENING" || sessionSnap.state === "SILENCE_WAIT" || sessionSnap.state === "STARTING"
            ? "Zuhören"
            : uiState === "IDLE" && kampagnenZeile
              ? kampagnenZeile
              : uiState === "IDLE" && app && !app.tasteUeberall
                ? "Sprechtaste braucht Freigabe"
                : humanStatus(uiState, status);

  if (ecke) {
    return (
      <div className="nova-stage nova-ecke" data-state={uiState}>
        <div className="nova-ecke-orb">
          <Orb state={uiState} level={sessionSnap.capturing ? sessionSnap.level : null} />
        </div>
        <NovaStatus text={shownStatus} />
        <div className="nova-ecke-knoepfe">
          {app ? (
            <button type="button" className="nova-ecke-knopf" onClick={() => anApp({ art: "einstellungen" })} aria-label="Einstellungen">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={`nova-ecke-knopf mic${sessionSnap.capturing ? " an" : ""}`}
            onPointerDown={pressPushToTalk}
            onPointerUp={releasePushToTalk}
            onPointerLeave={() => sessionSnap.capturing && releasePushToTalk()}
            aria-label={app ? `Halten und sprechen (oder ${app.taste} halten)` : "Halten und sprechen"}
            title={app ? `Halten und sprechen – oder ${app.taste} halten` : "Halten und sprechen"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </button>
          {speechPlaying ? (
            <button type="button" className="nova-ecke-knopf" onClick={stopSpeech} aria-label="Stopp">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : null}
          {app ? (
            <button type="button" className="nova-ecke-knopf" onClick={() => anApp({ art: "modus", modus: "chat" })} aria-label="Chat öffnen">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5H4.5z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="nova-stage" data-state={uiState}>
      <NovaBackground />
      <div className="nova-shell">
        <main className="nova-center">
          <div className="nova-hero">
            <div className="nova-hero-stage">
              <Orb state={uiState} level={sessionSnap.capturing ? sessionSnap.level : null} />
            </div>
          </div>

          <div className="nova-command-dock">
            {unavailableHint ? <p className="nova-voice-hint">{unavailableHint}</p> : null}
            <NovaStatus text={shownStatus} />
            <NovaCommandBar
              disabled={busy}
              listening={sessionSnap.capturing}
              speaking={speechPlaying}
              voiceSupported={voiceSupported}
              voiceEnabled={voiceEnabled}
              sessionActive={sessionSnap.active}
              sessionState={sessionSnap.state}
              silenceRemainingMs={sessionSnap.silenceRemainingMs}
              silenceTimeoutMs={sessionSnap.silenceTimeoutMs}
              dictation={sessionSnap.transcript}
              onSubmit={(value) => void sendMessage(value, "text")}
              onMic={handleMic}
              onMicDown={pressPushToTalk}
              onMicUp={releasePushToTalk}
              onStopSpeech={stopSpeech}
              onToggleVoice={toggleEnabled}
            />
            <NovaVoiceWave
              listening={sessionSnap.capturing}
              amplitude={sessionSnap.capturing ? sessionSnap.level : null}
              sessionLabel={sessionSnap.label}
            />
          </div>
          <div className="nova-horizont" aria-hidden="true" />
        </main>

        <NovaChat
          version={chatVersion}
          live={liveZeilen}
          busy={busy}
          onSend={(text) => void sendMessage(text, "text")}
          onEcke={app ? () => anApp({ art: "modus", modus: "ecke" }) : undefined}
        />
      </div>
    </div>
  );
}
