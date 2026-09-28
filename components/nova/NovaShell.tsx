"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NovaBackground } from "@/components/nova/NovaBackground";
import { NovaAvatar } from "@/components/nova/NovaAvatar";
import { NovaCommandBar } from "@/components/nova/NovaCommandBar";
import { NovaCommunicationLayer, type CommunicationLine } from "@/components/nova/NovaCommunicationLayer";
import { NovaStatus } from "@/components/nova/NovaStatus";
import { NovaVoiceWave } from "@/components/nova/NovaVoiceWave";
import { NovaSidebar, type NovaSection } from "@/components/nova/NovaSidebar";
import { NovaContextPanel, type NovaJobSummary, type NovaStandingPolicy, type NovaWorld } from "@/components/nova/NovaContextPanel";
import { ApprovalCard } from "@/components/nova/ApprovalCard";
import { NovaUpload, type NovaUploadHandle } from "@/components/nova/NovaUpload";
import { ArchivePanel, type ArchiveItem } from "@/components/archive/ArchivePanel";
import { performanceForState } from "@/components/nova/avatar-performance";
import { useVoiceSession } from "@/features/voice/useVoiceSession";
import { useNovaVoice } from "@/features/voice/useNovaVoice";
import type { VoiceTurn } from "@/features/voice/session-types";
import type { OrbState } from "@/types";
import type { ProviderMode } from "@/types/ai";
import { CONTEXT_WINDOW_SIZE } from "@/types/conversation";

const IDLE_STATUS = "Bereit für deine Anfrage";
const COMM_HIDE_MS = 14000;
const CONTEXT_WINDOW = CONTEXT_WINDOW_SIZE;

type InteractionMode = "voice" | "text" | "hybrid";

type Approval = {
  id: string;
  description: string;
  status: string;
  actionType?: string;
};

type ResumableComputer = {
  id: string;
  status: string;
  goal: string;
  remainingSteps: number;
  humanRequired: string | null;
};

type WatchAlert = {
  fingerprint: string;
  speak: boolean;
  message: string;
  overdue: number;
  soon: number;
};

function humanStatus(state: OrbState, text: string): string {
  if (state === "LISTENING") return text || "Zuhören";
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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activities, setActivities] = useState<ArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [, setProviderMode] = useState<ProviderMode | null>(null);
  const [section, setSection] = useState<NovaSection>("chat");
  const [userName, setUserName] = useState("Joachim");
  const [online, setOnline] = useState(true);
  const [job, setJob] = useState<NovaJobSummary | null>(null);
  const [world, setWorld] = useState<NovaWorld | null>(null);
  const [standingPolicies, setStandingPolicies] = useState<NovaStandingPolicy[]>([]);
  const [standingBusy, setStandingBusy] = useState(false);
  const [resumable, setResumable] = useState<ResumableComputer | null>(null);
  const [humanGate, setHumanGate] = useState<string | null>(null);
  const [watchBanner, setWatchBanner] = useState<string | null>(null);
  const watchFpRef = useRef<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [commOpen, setCommOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [visibleLines, setVisibleLines] = useState<CommunicationLine[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("voice");
  const [importOpen, setImportOpen] = useState(false);
  const uploadRef = useRef<NovaUploadHandle | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const interruptedRef = useRef(false);
  const commOpenRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const sendVoiceTurnRef = useRef<(turn: VoiceTurn) => void>(() => undefined);
  const watchSpeakRef = useRef({
    voiceEnabled: false,
    idle: true,
    speechPlaying: false,
    busy: false,
    beginTurn: (_text: string) => undefined as void,
    flush: (_text?: string) => undefined as void,
  });

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
    performance: speechPerformance,
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

    const textTurn = true;
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
    if (inputMode === "text") {
      setInteractionMode((current) => (current === "voice" ? "text" : current === "hybrid" ? "hybrid" : "text"));
    } else if (commOpenRef.current || sessionActiveRef.current) {
      setInteractionMode("hybrid");
    }

    let accumulated = "";
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
          const nextState = (payload.orbState as OrbState) ?? "DONE";
          if (payload.approvalId) {
            setApproval({
              id: String(payload.approvalId),
              description: String(payload.statusMessage ?? "Freigabe erforderlich"),
              status: "pending",
              actionType: typeof payload.actionType === "string" ? payload.actionType : undefined,
            });
          } else {
            setApproval(null);
          }
          if (typeof payload.humanRequired === "string" && payload.humanRequired) {
            setHumanGate(payload.humanRequired);
          } else if (nextState !== "WAITING_FOR_APPROVAL") {
            setHumanGate(null);
          }
          if (typeof payload.jobId === "string" && payload.jobId) {
            setJob({
              id: payload.jobId,
              goal: String(payload.statusMessage ?? message),
              status: String(payload.status ?? "running"),
              userRequest: message,
            });
          }
          if (payload.needsFile === "chatgpt-export") {
            setImportOpen(true);
          }
          if (typeof payload.statusMessage === "string") setStatus(payload.statusMessage);
          if (interruptedRef.current) {
            return;
          }
          if (voiceEnabled && accumulated.trim()) {
            flush(accumulated);
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
          if (textTurn || commOpenRef.current) {
            scheduleCommHide(COMM_HIDE_MS);
          }
        }
        if (type === "error") {
          setOrbState("ERROR");
          setProviderMode("error");
          setStatus(String(payload.statusMessage ?? "Etwas ist schiefgelaufen."));
          if (sessionActiveRef.current) notifyNovaIdle();
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
      if (sessionActiveRef.current) notifyNovaIdle();
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
    notifyNovaIdle,
    notifyProcessing,
  ]);

  useEffect(() => {
    sendVoiceTurnRef.current = (turn) => {
      void sendMessage(turn.transcript, "voice", turn);
    };
  }, [sendMessage]);

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
    watchSpeakRef.current = {
      voiceEnabled,
      idle: orbState === "IDLE" || orbState === "LISTENING",
      speechPlaying,
      busy,
      beginTurn,
      flush,
    };
  }, [beginTurn, busy, flush, orbState, speechPlaying, voiceEnabled]);

  const applyStatusPayload = useCallback(
    (data: {
      ok?: boolean;
      tenant?: { userName?: string };
      pendingApprovals?: Approval[];
      standingPolicies?: NovaStandingPolicy[];
      latestJob?: { id?: string; goal?: string; status?: string; userRequest?: string };
      world?: NovaWorld;
      resumableComputerJob?: ResumableComputer | null;
      watchAlert?: WatchAlert | null;
    }, options?: { speakWatch?: boolean }) => {
      setOnline(Boolean(data.ok));
      if (data.tenant?.userName) setUserName(data.tenant.userName);
      const pending = data.pendingApprovals?.[0];
      if (pending) {
        setApproval({
          id: pending.id,
          description: pending.description,
          status: pending.status,
          actionType: pending.actionType,
        });
        setOrbState("WAITING_FOR_APPROVAL");
        setStatus(/computer|löschen|freigabe/i.test(String(pending.description ?? ""))
          ? "Freigabe erforderlich"
          : "Ich brauche deine Freigabe, bevor etwas versendet werden könnte.");
      }
      if (Array.isArray(data.standingPolicies)) {
        setStandingPolicies(data.standingPolicies);
      }
      if (data.world) setWorld(data.world);
      if (data.latestJob) {
        setJob({
          id: String(data.latestJob.id),
          goal: String(data.latestJob.goal ?? ""),
          status: String(data.latestJob.status ?? ""),
          userRequest: String(data.latestJob.userRequest ?? ""),
        });
      }
      const nextResumable = data.resumableComputerJob ?? null;
      setResumable(nextResumable);
      if (nextResumable?.humanRequired) setHumanGate(nextResumable.humanRequired);
      else if (!nextResumable) setHumanGate(null);

      const alert = data.watchAlert;
      if (alert?.speak && alert.fingerprint) {
        const stored = watchFpRef.current ?? (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("nova-watch-fp") : null);
        if (stored !== alert.fingerprint) {
          watchFpRef.current = alert.fingerprint;
          try {
            sessionStorage.setItem("nova-watch-fp", alert.fingerprint);
          } catch {
            // ignore
          }
          setWatchBanner(alert.message);
          const speak = watchSpeakRef.current;
          const maySpeak =
            options?.speakWatch !== false &&
            speak.voiceEnabled &&
            speak.idle &&
            !speak.speechPlaying &&
            !speak.busy;
          if (maySpeak) {
            speak.beginTurn(alert.message);
            speak.flush(alert.message);
          }
        }
      } else if (alert && !alert.speak) {
        setWatchBanner(null);
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/nova/status");
        const data = await response.json();
        applyStatusPayload(data, { speakWatch: false });
      } catch {
        setOnline(false);
      }
      void loadArchive();
    })();
  }, [applyStatusPayload, loadArchive]);

  useEffect(() => {
    const tick = () => {
      void (async () => {
        try {
          const response = await fetch("/api/nova/status", { cache: "no-store" });
          const data = await response.json();
          applyStatusPayload(data, { speakWatch: true });
        } catch {
          setOnline(false);
        }
      })();
    };
    const id = window.setInterval(tick, 90_000);
    return () => window.clearInterval(id);
  }, [applyStatusPayload]);

  const decide = async (decision: "approved" | "rejected", standing = false) => {
    if (!approval) return;
    setBusy(true);
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, decision, standing }),
      });
      const data = await response.json();
      setApproval(null);
      setOrbState(decision === "approved" ? "DONE" : "IDLE");
      setStatus(data.message ?? IDLE_STATUS);
      const statusResponse = await fetch("/api/nova/status", { cache: "no-store" });
      const statusBody = await statusResponse.json();
      const nextPending = statusBody.pendingApprovals?.[0];
      if (nextPending) {
        setApproval({
          id: nextPending.id,
          description: nextPending.description,
          status: nextPending.status,
          actionType: nextPending.actionType,
        });
        setOrbState("WAITING_FOR_APPROVAL");
        setStatus("Freigabe erforderlich");
      }
      if (standing) {
        const policies = await fetch("/api/approvals/policies");
        const body = await policies.json();
        if (Array.isArray(body.policies)) setStandingPolicies(body.policies);
      }
      goIdleSoon(2400);
    } finally {
      setBusy(false);
    }
  };

  const grantStanding = async (actionType: "mail.send.batch" | "macos.ui.click") => {
    setStandingBusy(true);
    try {
      const response = await fetch("/api/approvals/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType }),
      });
      const data = await response.json();
      if (data.ok) {
        const policies = await fetch("/api/approvals/policies");
        const body = await policies.json();
        if (Array.isArray(body.policies)) setStandingPolicies(body.policies);
      }
    } finally {
      setStandingBusy(false);
    }
  };

  const revokeStanding = async (policyId: string) => {
    setStandingBusy(true);
    try {
      await fetch(`/api/approvals/policies?policyId=${encodeURIComponent(policyId)}`, { method: "DELETE" });
      setStandingPolicies((current) => current.filter((item) => item.id !== policyId));
    } finally {
      setStandingBusy(false);
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

  const openUpload = useCallback((pick = true) => {
    setImportOpen(true);
    if (pick) uploadRef.current?.pick();
  }, []);

  const takeDroppedFiles = useCallback((list: FileList | File[]) => {
    const next = Array.from(list).filter((item) => item.name);
    if (!next.length) return;
    setImportOpen(true);
    uploadRef.current?.importFiles(next);
  }, []);

  const resumeComputer = useCallback(() => {
    setHumanGate(null);
    setResumable(null);
    void sendMessage(humanGate ? "Ich habe es gelöst" : "mach weiter", "text");
  }, [humanGate, sendMessage]);

  const stopSpeech = useCallback(() => {
    interruptedRef.current = true;
    stopVoice("idle");
    void fetch("/api/computer/cancel", { method: "POST" });
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

  let uiState: OrbState = orbState;
  if (speechPlaying) {
    uiState = "SPEAKING";
  } else if (orbState !== "WAITING_FOR_APPROVAL" && orbState !== "WORKING") {
    if (sessionSnap.state === "ERROR") uiState = "ERROR";
    else if (sessionSnap.state === "PROCESSING") uiState = "THINKING";
    else if (sessionSnap.capturing || sessionSnap.state === "STARTING") uiState = "LISTENING";
  }
  const basePerformance = useMemo(() => performanceForState(uiState), [uiState]);
  const performance = speechPlaying
    ? {
        ...basePerformance,
        ...speechPerformance,
        isSpeaking: true,
      }
    : { ...basePerformance, isSpeaking: false, viseme: "REST" as const, speechIntensity: 0 };

  const shownStatus =
    sessionSnap.state === "ERROR"
      ? sessionSnap.error ?? "Voice Session fehlgeschlagen."
      : speechPlaying
        ? "NOVA spricht"
        : sessionSnap.state === "USER_SPEAKING" || sessionSnap.state === "INTERRUPTED"
          ? "Ich höre zu"
          : sessionSnap.state === "LISTENING" || sessionSnap.state === "SILENCE_WAIT" || sessionSnap.state === "STARTING"
            ? "Zuhören"
            : humanStatus(uiState, status);

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
        <NovaSidebar
          section={section}
          onSection={chooseSection}
          userName={userName}
          open={navOpen}
          onOpenSettings={() => openUpload(true)}
        />

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
              <NovaAvatar state={uiState} performance={performance} />
              <p className="nova-hero-copy right">
                Dein
                <br />
                Business
                <br />
                Assistant
              </p>
            </div>
          </div>

          <div
            className={`nova-command-dock ${dropActive ? "drop-active" : ""}`}
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDropActive(true);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropActive(false);
              takeDroppedFiles(event.dataTransfer.files);
            }}
          >
            {unavailableHint ? <p className="nova-voice-hint">{unavailableHint}</p> : null}
            {watchBanner ? (
              <div className="nova-card nova-panel" style={{ width: "min(92%, 480px)", textAlign: "center", marginBottom: 12 }}>
                <h3>Watch</h3>
                <p className="nova-quote">{watchBanner}</p>
                <button type="button" className="nova-chip" onClick={() => setWatchBanner(null)}>
                  Alles klar
                </button>
              </div>
            ) : null}
            {humanGate || resumable ? (
              <div className="nova-card nova-panel" style={{ width: "min(92%, 480px)", textAlign: "center", marginBottom: 12 }}>
                <h3>{humanGate ? "Du bist dran" : "Auftrag unterbrochen"}</h3>
                <p className="nova-quote">
                  {humanGate === "captcha"
                    ? "Bitte Captcha im Browser lösen, dann hier fortsetzen."
                    : humanGate === "login"
                      ? "Bitte anmelden, dann hier fortsetzen."
                      : resumable?.goal || "Ich kann am letzten Schritt weitermachen."}
                </p>
                <button type="button" disabled={busy} onClick={resumeComputer} className="nova-chip" style={{ background: "rgba(255, 255, 255, 0.14)", color: "#fff" }}>
                  {humanGate ? "Ich hab’s gelöst" : "Fortsetzen"}
                </button>
              </div>
            ) : null}
            {approval ? (
              <ApprovalCard
                description={approval.description}
                busy={busy}
                allowStanding={
                  approval.actionType === "mail.send.batch" || approval.actionType === "macos.ui.click"
                }
                onApprove={() => void decide("approved")}
                onAlwaysAllow={() => void decide("approved", true)}
                onReject={() => void decide("rejected")}
              />
            ) : null}
            <NovaUpload ref={uploadRef} open={importOpen} onClose={() => setImportOpen(false)} />
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
              onStopSpeech={stopSpeech}
              onToggleVoice={toggleEnabled}
              onDraftChange={handleDraftChange}
              onComposeStart={openTextLayer}
              onUpload={() => openUpload(true)}
            />
            <NovaVoiceWave
              listening={sessionSnap.capturing}
              amplitude={sessionSnap.capturing ? sessionSnap.level : null}
              sessionLabel={sessionSnap.label}
            />
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
          world={world}
          standingPolicies={standingPolicies}
          standingBusy={standingBusy}
          onGrantStanding={(actionType) => void grantStanding(actionType)}
          onRevokeStanding={(policyId) => void revokeStanding(policyId)}
          onUpload={() => openUpload(true)}
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
