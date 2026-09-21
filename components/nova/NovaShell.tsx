"use client";

import { useCallback, useEffect, useState } from "react";
import { Orb } from "@/components/nova/Orb";
import { Composer } from "@/components/nova/Composer";
import { StatusLine } from "@/components/nova/StatusLine";
import { ApprovalCard } from "@/components/nova/ApprovalCard";
import { ArchivePanel, type ArchiveItem } from "@/components/archive/ArchivePanel";
import { useVoiceInput } from "@/features/voice/useVoiceInput";
import type { OrbState } from "@/types";

const IDLE_STATUS = "Was soll ich erledigen?";

type Approval = {
  id: string;
  description: string;
  status: string;
};

export function NovaShell() {
  const [orbState, setOrbState] = useState<OrbState>("IDLE");
  const [status, setStatus] = useState(IDLE_STATUS);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activities, setActivities] = useState<ArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    setBusy(true);
    setOrbState("THINKING");
    setStatus("Ich denke nach …");
    setReply("");
    try {
      const thinking = window.setTimeout(() => {
        setOrbState("WORKING");
        setStatus("Ich arbeite …");
      }, 700);

      const response = await fetch("/api/nova/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      window.clearTimeout(thinking);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setOrbState("ERROR");
        setStatus("Etwas ist schiefgelaufen.");
        setReply(data.error ?? "Unbekannter Fehler");
        return;
      }
      setOrbState(data.orbState as OrbState);
      setStatus(data.statusMessage ?? IDLE_STATUS);
      setReply(data.reply ?? "");
      if (data.approvalId) {
        setApproval({
          id: data.approvalId,
          description: data.statusMessage,
          status: "pending",
        });
      } else {
        setApproval(null);
      }
      if (data.orbState === "DONE") {
        window.setTimeout(() => {
          setOrbState("IDLE");
          setStatus(IDLE_STATUS);
        }, 1800);
      }
    } catch {
      setOrbState("ERROR");
      setStatus("Etwas ist schiefgelaufen.");
    } finally {
      setBusy(false);
    }
  }, []);

  const voice = useVoiceInput((text) => {
    setOrbState("THINKING");
    void sendMessage(text);
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
      const response = await fetch("/api/nova/status");
      const data = await response.json();
      const pending = data.pendingApprovals?.[0];
      if (pending) {
        setApproval({ id: pending.id, description: pending.description, status: pending.status });
        setOrbState("WAITING_FOR_APPROVAL");
        setStatus("Ich brauche deine Freigabe, bevor etwas versendet werden könnte.");
      }
    })();
  }, []);

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
      setReply(data.message ?? "");
      window.setTimeout(() => {
        setOrbState("IDLE");
        setStatus(IDLE_STATUS);
      }, 2400);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center">
      <div className="nova-grain" />
      <div className="nova-vignette" />

      <button
        type="button"
        onClick={() => {
          setArchiveOpen(true);
          void loadArchive();
        }}
        className="absolute top-6 right-7 z-20 text-[11px] tracking-[0.22em] text-white/22 uppercase transition hover:text-white/45"
      >
        Archiv
      </button>

      <main className="relative z-10 flex w-full flex-col items-center px-6">
        <Orb state={orbState} />
        <div className="mt-2 flex w-full flex-col items-center gap-5">
          <StatusLine text={status} />
          {reply ? (
            <p className="max-w-[520px] text-center text-[13px] leading-6 text-white/40">{reply}</p>
          ) : null}
          {approval ? (
            <ApprovalCard
              description={approval.description}
              busy={busy}
              onApprove={() => void decide("approved")}
              onReject={() => void decide("rejected")}
            />
          ) : null}
          <Composer
            disabled={busy}
            listening={voice.listening}
            voiceSupported={voice.supported}
            onSubmit={(value) => void sendMessage(value)}
            onMic={() => {
              if (voice.listening) {
                voice.stop();
                setOrbState("IDLE");
                setStatus(IDLE_STATUS);
                return;
              }
              const started = voice.start();
              if (started) {
                setOrbState("LISTENING");
                setStatus("Ich höre zu …");
              } else {
                setStatus("Spracheingabe ist vorbereitet, in diesem Browser aber nicht verfügbar.");
              }
            }}
          />
        </div>
      </main>

      <ArchivePanel
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        items={activities}
        loading={archiveLoading}
        onSearch={(query, type) => void loadArchive(query, type)}
      />
    </div>
  );
}
