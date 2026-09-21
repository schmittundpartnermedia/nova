"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NovaBackground } from "@/components/nova/NovaBackground";
import { NovaAvatar } from "@/components/nova/NovaAvatar";
import { NovaCommandBar } from "@/components/nova/NovaCommandBar";
import { NovaCommunicationLayer, type CommunicationLine } from "@/components/nova/NovaCommunicationLayer";
import { NovaStatus } from "@/components/nova/NovaStatus";
import { NovaVoiceWave } from "@/components/nova/NovaVoiceWave";
import { NovaSidebar, type NovaSection } from "@/components/nova/NovaSidebar";
import { NovaContextPanel, type NovaJobSummary } from "@/components/nova/NovaContextPanel";
import { ApprovalCard } from "@/components/nova/ApprovalCard";
import { ArchivePanel, type ArchiveItem } from "@/components/archive/ArchivePanel";
import { performanceForState } from "@/components/nova/avatar-performance";
import { useVoiceInput } from "@/features/voice/useVoiceInput";
import { useNovaVoice } from "@/features/voice/useNovaVoice";
import type { OrbState } from "@/types";
import type { ProviderMode } from "@/types/ai";

const IDLE_STATUS = "Bereit für deine Anfrage";
const COMM_HIDE_MS = 14000;
const CONTEXT_WINDOW = 4;

type InteractionMode = "voice" | "text" | "hybrid";

type Approval = {
  id: string;
  description: string;
  status: string;
};

function humanStatus(state: OrbState, text: string): string {
  if (state === "LISTENING") return "Ich höre dir zu …";
  if (state === "THINKING") return "Ich denke nach …";
  if (state === "WORKING") {
    const cleaned = text
      .replace(/\b[\w.]*Agent[\w.]*\b/gi, "")
      .replace(/\.execute\(\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned || cleaned.length < 4) return "Ich arbeite daran …";
    return cleaned;
  }
  if (state === "SPEAKING") return text;
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activities, setActivities] = useState<ArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [, setProviderMode] = useState<ProviderMode | null>(null);
  const [section, setSection] = useState<NovaSection>("chat");
  const [userName, setUserName] = useState("Joachim");
  const [online, setOnline] = useState(true);
  const [job, setJob] = useState<NovaJobSummary | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [commOpen, setCommOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [visibleLines, setVisibleLines] = useState<CommunicationLine[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("voice");
  const idleTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const interruptedRef = useRef(false);
  const commOpenRef = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const keepComm = useCallback(() => {
    commOpenRef.current = true;
    setCommOpen(true);
    clearHideTimer();
  }, [clearHideTimer]);

  const scheduleCommHide = useCallback(
    (delay = COMM_HIDE_MS) => {
      clearHideTimer();
      hideTimer.current = window.setTimeout(() => {
        commOpenRef.current = false;
        setCommOpen(false);
        setDraft("");
        if (interactionMode === "hybrid") setInteractionMode("voice");
      }, delay);
    },
    [clearHideTimer, interactionMode],
  );

  const openTextLayer = useCallback(() => {
    setInteractionMode((current) => (current === "voice" ? "text" : current));
    keepComm();
  }, [keepComm]);

  const clipWindow = useCallback((lines: CommunicationLine[]) => {
    if (lines.length <= CONTEXT_WINDOW) return lines;
    return lines.slice(lines.length - CONTEXT_WINDOW);
  }, []);

  const goIdleSoon = useCallback(
    (delay = 1800) => {
      clearIdleTimer();
      idleTimer.current = window.setTimeout(() => {
        setOrbState((current) => (current === "LISTENING" ? current : "IDLE"));
        setStatus((current) => (current === "Ich höre dir zu …" ? current : IDLE_STATUS));
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
    performance: speechPerformance,
    beginTurn,
    ingest,
    flush,
    stop: stopVoice,
    setAfterSpeech,
    bindFacialSink,
  } = useNovaVoice();

  useEffect(() => {
    setAfterSpeech((next) => {
      if (next === "listen") return;
      setOrbState((current) => {
        if (current === "LISTENING" || current === "WAITING_FOR_APPROVAL") return current;
        if (next === "idle") return "IDLE";
        return "DONE";
      });
      if (next === "idle") {
        setStatus((current) => (current === "Ich höre dir zu …" ? current : IDLE_STATUS));
        return;
      }
      goIdleSoon(1600);
    });
  }, [goIdleSoon, setAfterSpeech]);

  const sendMessage = useCallback(async (message: string, inputMode: "text" | "voice" = "text") => {
    interruptedRef.current = false;
    stopVoice("idle");
    clearIdleTimer();
    setBusy(true);
    setOrbState("THINKING");
    setStatus("Ich denke nach …");
    clearHint();
    if (voiceEnabled) beginTurn("");

    const textTurn = inputMode === "text";
    if (textTurn) {
      setInteractionMode((current) => (current === "voice" ? "text" : current === "hybrid" ? "hybrid" : "text"));
      keepComm();
      const userLine: CommunicationLine = { id: `user-${Date.now()}`, speaker: "JOACHIM", text: message };
      const assistantLine: CommunicationLine = {
        id: `nova-${Date.now()}`,
        speaker: "NOVA",
        text: "",
        pending: true,
      };
      setVisibleLines((current) => clipWindow([...current.filter((line) => !line.pending), userLine, assistantLine]));
      setDraft("");
    } else if (commOpenRef.current) {
      setInteractionMode("hybrid");
    }

    let accumulated = "";
    try {
      const response = await fetch("/api/nova/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message, inputMode }),
      });
      if (!response.ok && !response.body) {
        setOrbState("ERROR");
        setProviderMode("error");
        setStatus("Etwas ist schiefgelaufen.");
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
          if (textTurn) {
            setVisibleLines((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.speaker === "NOVA") {
                next[next.length - 1] = { ...last, text: accumulated, pending: false };
              }
              return clipWindow(next);
            });
          }
          if (voiceEnabled && !interruptedRef.current) ingest(accumulated);
        }
        if (type === "done") {
          if (typeof payload.reply === "string" && payload.reply) {
            accumulated = payload.reply;
            if (textTurn) {
              setVisibleLines((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (last?.speaker === "NOVA") {
                  next[next.length - 1] = { ...last, text: payload.reply as string, pending: false };
                }
                return clipWindow(next);
              });
            }
          }
          setProviderMode((payload.providerMode as ProviderMode) ?? null);
          if (payload.approvalId) {
            setApproval({
              id: String(payload.approvalId),
              description: String(payload.statusMessage ?? "Freigabe erforderlich"),
              status: "pending",
            });
          } else {
            setApproval(null);
          }
          if (typeof payload.jobId === "string" && payload.jobId) {
            setJob({
              id: payload.jobId,
              goal: String(payload.statusMessage ?? message),
              status: String(payload.status ?? "running"),
              userRequest: message,
            });
          }
          const nextState = (payload.orbState as OrbState) ?? "DONE";
          if (typeof payload.statusMessage === "string") setStatus(payload.statusMessage);
          if (interruptedRef.current) {
            return;
          }
          if (voiceEnabled && accumulated.trim()) {
            flush(accumulated);
            if (nextState === "WAITING_FOR_APPROVAL") {
              setOrbState("WAITING_FOR_APPROVAL");
            }
          } else {
            setOrbState(nextState);
            if (nextState === "DONE") goIdleSoon(1800);
          }
          if (textTurn || commOpenRef.current) {
            scheduleCommHide(COMM_HIDE_MS);
          }
        }
        if (type === "error") {
          setOrbState("ERROR");
          setProviderMode("error");
          setStatus(String(payload.statusMessage ?? "Etwas ist schiefgelaufen."));
          if (textTurn) {
            setVisibleLines((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.speaker === "NOVA") {
                next[next.length - 1] = {
                  ...last,
                  text: String(payload.error ?? "Etwas ist schiefgelaufen."),
                  pending: false,
                };
              }
              return clipWindow(next);
            });
          }
        }
      });
    } catch {
      setOrbState("ERROR");
      setProviderMode("error");
      setStatus("Etwas ist schiefgelaufen.");
    } finally {
      setBusy(false);
    }
  }, [
    beginTurn,
    clearHint,
    clearIdleTimer,
    clipWindow,
    flush,
    goIdleSoon,
    ingest,
    keepComm,
    scheduleCommHide,
    stopVoice,
    voiceEnabled,
  ]);

  const voice = useVoiceInput((text) => {
    setOrbState("THINKING");
    void sendMessage(text, "voice");
  });

  const loadArchive = useCallback(async (query = "", type = "all") => {
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (type) params.set("type", type);
      const response = await fetch(`/api/archive?${params.toString()}`);
      const data = await response.json();
      setActivities(data.activities ?? []);
    } finally {
      setArchiveLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/nova/status");
        const data = await response.json();
        setOnline(Boolean(data.ok));
        if (data.tenant?.userName) setUserName(data.tenant.userName);
        const pending = data.pendingApprovals?.[0];
        if (pending) {
          setApproval({ id: pending.id, description: pending.description, status: pending.status });
          setOrbState("WAITING_FOR_APPROVAL");
          setStatus("Ich brauche deine Freigabe, bevor etwas versendet werden könnte.");
        }
        if (data.latestJob) {
          setJob({
            id: String(data.latestJob.id),
            goal: String(data.latestJob.goal ?? ""),
            status: String(data.latestJob.status ?? ""),
            userRequest: String(data.latestJob.userRequest ?? ""),
          });
        }
      } catch {
        setOnline(false);
      }
      void loadArchive();
    })();
  }, [loadArchive]);

  const decide = async (decision: "approved" | "rejected") => {
    if (!approval) return;
    setBusy(true);
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, decision }),
      });
      const data = await response.json();
      setApproval(null);
      setOrbState(decision === "approved" ? "DONE" : "IDLE");
      setStatus(data.message ?? IDLE_STATUS);
      goIdleSoon(2400);
    } finally {
      setBusy(false);
    }
  };

  const chooseSection = (next: NovaSection) => {
    setSection(next);
    setNavOpen(false);
    if (next === "archive") {
      setArchiveOpen(true);
      void loadArchive();
      return;
    }
    setArchiveOpen(false);
    if (next !== "chat") setContextOpen(true);
  };

  const stopSpeech = useCallback(() => {
    interruptedRef.current = true;
    stopVoice("idle");
    setOrbState("IDLE");
    setStatus(IDLE_STATUS);
  }, [stopVoice]);

  const handleMic = useCallback(() => {
    if (voice.listening) {
      voice.stop();
      setOrbState("IDLE");
      setStatus(IDLE_STATUS);
      return;
    }
    if (speechPlaying) {
      interruptedRef.current = true;
      stopVoice("listen");
    }
    clearIdleTimer();
    const started = voice.start();
    if (started) {
      setOrbState("LISTENING");
      setStatus("Ich höre dir zu …");
    } else {
      setStatus("Spracheingabe ist vorbereitet, in diesem Browser aber nicht verfügbar.");
    }
  }, [clearIdleTimer, speechPlaying, stopVoice, voice]);

  const reopenConversation = useCallback(async () => {
    keepComm();
    setInteractionMode((current) => (current === "voice" ? "text" : current));
    try {
      const response = await fetch("/api/nova/conversation");
      const data = await response.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const lines: CommunicationLine[] = messages.map(
        (item: { id: string; role: string; content: string }) => ({
          id: item.id,
          speaker: item.role === "user" ? "JOACHIM" : "NOVA",
          text: String(item.content ?? ""),
        }),
      );
      if (lines.length > 0) setVisibleLines(clipWindow(lines));
    } catch {
      // HUD remains open even if the window cannot be loaded.
    }
    scheduleCommHide(COMM_HIDE_MS);
  }, [clipWindow, keepComm, scheduleCommHide]);

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      if (value.trim()) openTextLayer();
    },
    [openTextLayer],
  );

  const commLines = useMemo(() => {
    const lines = [...visibleLines];
    if (draft.trim() && !busy) {
      lines.push({ id: "draft", speaker: "JOACHIM", text: draft, pending: true });
    }
    return clipWindow(lines);
  }, [busy, clipWindow, draft, visibleLines]);

  const uiState: OrbState = speechPlaying ? "SPEAKING" : orbState;
  const basePerformance = useMemo(() => performanceForState(uiState), [uiState]);
  const performance = speechPlaying
    ? {
        ...basePerformance,
        ...speechPerformance,
        isSpeaking: true,
      }
    : { ...basePerformance, isSpeaking: false, viseme: "REST" as const, speechIntensity: 0 };

  const shownStatus = humanStatus(uiState, status);

  return (
    <div className="nova-stage" data-state={uiState}>
      <NovaBackground />
      <div
        className={`nova-scrim ${navOpen || contextOpen ? "show" : ""}`}
        onClick={() => {
          setNavOpen(false);
          setContextOpen(false);
        }}
      />

      <div className="nova-shell">
        <NovaSidebar section={section} onSection={chooseSection} userName={userName} open={navOpen} />

        <main className="nova-center">
          <div className="nova-mobile-bar">
            <button type="button" className="nova-icon-btn" onClick={() => setNavOpen(true)} aria-label="Navigation">
              ☰
            </button>
            <button type="button" className="nova-icon-btn" onClick={() => setContextOpen(true)} aria-label="Kontext">
              i
            </button>
          </div>

          <div className={`nova-hero ${commOpen && commLines.length > 0 ? "has-comm" : ""}`}>
            <div className="nova-comm-rail">
              <p className="nova-hero-copy left">
                Denken
                <br />
                Planen
                <br />
                Umsetzen
              </p>
              <NovaCommunicationLayer
                open={commOpen && commLines.length > 0}
                lines={commLines}
                hasHistory={visibleLines.length > 0}
                onReopen={() => void reopenConversation()}
              />
            </div>
            <div className="nova-hero-stage">
              <NovaAvatar
                state={uiState}
                performance={performance}
                onRuntime={(runtime) => {
                  bindFacialSink(runtime ? (frame) => runtime.applyFrame(frame) : null);
                }}
              />
              <p className="nova-hero-copy right">
                Dein
                <br />
                Business
                <br />
                Assistant
              </p>
            </div>
          </div>

          <div className="nova-command-dock">
            {unavailableHint ? <p className="nova-voice-hint">{unavailableHint}</p> : null}
            {approval ? (
              <ApprovalCard
                description={approval.description}
                busy={busy}
                onApprove={() => void decide("approved")}
                onReject={() => void decide("rejected")}
              />
            ) : null}
            <NovaStatus text={shownStatus} />
            <NovaCommandBar
              disabled={busy}
              listening={voice.listening}
              speaking={speechPlaying}
              voiceSupported={voice.supported}
              voiceEnabled={voiceEnabled}
              onSubmit={(value) => void sendMessage(value, "text")}
              onMic={handleMic}
              onStopSpeech={stopSpeech}
              onToggleVoice={toggleEnabled}
              onDraftChange={handleDraftChange}
              onComposeStart={openTextLayer}
            />
            <NovaVoiceWave listening={voice.listening} />
          </div>
        </main>

        <NovaContextPanel
          open={contextOpen}
          section={section === "archive" ? "chat" : section}
          online={online}
          statusText={shownStatus}
          job={job}
          approvalDescription={approval?.description ?? null}
          items={activities}
        />
      </div>

      <ArchivePanel
        open={archiveOpen}
        onClose={() => {
          setArchiveOpen(false);
          setSection("chat");
        }}
        items={activities}
        loading={archiveLoading}
        onSearch={(query, type) => void loadArchive(query, type)}
      />
    </div>
  );
}
