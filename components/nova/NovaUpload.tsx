"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ImportPhase = "idle" | "running" | "done" | "error";

type StatusPayload = {
  ok?: boolean;
  running?: boolean;
  finished?: boolean;
  kind?: "upload" | "chatgpt";
  jobId?: string;
  percent?: number;
  error?: string | null;
  filesTotal?: number;
  filesSuccess?: number;
  filesSkipped?: number;
  items?: number;
  conversations?: number;
  messages?: number;
  decisions?: number;
  entities?: number;
  contradictions?: number;
};

export function NovaUpload({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StatusPayload | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((data: StatusPayload) => {
    if (data.running) {
      setPhase("running");
      setPercent(typeof data.percent === "number" ? data.percent : 0);
      if (typeof data.jobId === "string") jobIdRef.current = data.jobId;
      setStatus(data);
      return true;
    }
    if (data.finished && data.ok === false) {
      setPhase("error");
      setError(data.error || "Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.");
      stopPoll();
      return true;
    }
    if (data.finished && data.ok) {
      setPhase("done");
      setPercent(100);
      setStatus(data);
      stopPoll();
      return true;
    }
    return false;
  }, [stopPoll]);

  const poll = useCallback(
    async (nextJobId?: string) => {
      const id = nextJobId ?? jobIdRef.current;
      const query = id ? `?jobId=${encodeURIComponent(id)}` : "";
      const response = await fetch(`/api/import${query}`);
      const data = (await response.json()) as StatusPayload;
      applyStatus(data);
    },
    [applyStatus],
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/import");
        const data = (await response.json()) as StatusPayload;
        if (data.running) applyStatus(data);
      } catch {
        // idle
      }
    })();
  }, [applyStatus]);

  useEffect(() => {
    if (phase !== "running") {
      stopPoll();
      return;
    }
    stopPoll();
    pollRef.current = window.setInterval(() => {
      void poll();
    }, 900);
    return stopPoll;
  }, [phase, poll, stopPoll]);

  const reset = useCallback(() => {
    stopPoll();
    setPhase("idle");
    setFiles([]);
    setPercent(0);
    setError("");
    setStatus(null);
    jobIdRef.current = null;
  }, [stopPoll]);

  const startImport = useCallback(
    async (nextFiles: File[]) => {
      if (!nextFiles.length) return;
      setFiles(nextFiles);
      setPhase("running");
      setPercent(1);
      setError("");
      setStatus(null);
      try {
        const body = new FormData();
        for (const file of nextFiles) body.append("file", file);
        const response = await fetch("/api/import", { method: "POST", body });
        const data = (await response.json()) as StatusPayload & { started?: boolean; error?: string };
        if (!response.ok || data.ok === false) {
          setPhase("error");
          setError(data.error || "Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.");
          return;
        }
        if (typeof data.jobId === "string") jobIdRef.current = data.jobId;
        setPercent(2);
        void poll(data.jobId);
      } catch {
        setPhase("error");
        setError("Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.");
      }
    },
    [poll],
  );

  const visible = open || phase === "running" || phase === "done" || phase === "error";
  if (!visible) {
    return (
      <input
        ref={fileRef}
        id="nova-upload-input"
        type="file"
        multiple
        className="nova-file-input"
        onChange={(event) => {
          const next = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (next.length) void startImport(next);
        }}
      />
    );
  }

  const chatgpt = status?.kind === "chatgpt" || (status?.conversations ?? 0) > 0;
  const runningLabel = chatgpt ? "ChatGPT-Verlauf wird importiert …" : "Dateien werden übernommen …";
  const doneLabel = chatgpt ? "ChatGPT-Verlauf importiert." : "Dateien übernommen.";

  return (
    <div className="nova-card nova-panel nova-import-card">
      <input
        ref={fileRef}
        id="nova-upload-input"
        type="file"
        multiple
        className="nova-file-input"
        onChange={(event) => {
          const next = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (next.length) void startImport(next);
        }}
      />

      {phase === "idle" ? (
        <>
          <h3>Hochladen</h3>
          <p>PDF, Text, ChatGPT-ZIP, Audio, Video und andere Dateien. NOVA ordnet sie zu und hebt sie für später auf.</p>
          <div className="nova-import-actions">
            <label htmlFor="nova-upload-input" className="nova-chip nova-import-action" style={{ cursor: "pointer" }}>
              Dateien wählen
            </label>
            <button
              type="button"
              className="nova-chip"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Schließen
            </button>
          </div>
        </>
      ) : null}

      {phase === "running" ? (
        <>
          <p>{runningLabel}</p>
          <p className="nova-import-percent">{Math.max(0, Math.min(100, Math.round(percent)))}%</p>
          {files[0] ? <p className="nova-import-file">{files.map((file) => file.name).join(", ")}</p> : null}
        </>
      ) : null}

      {phase === "done" && status ? (
        <>
          <p>{doneLabel}</p>
          <dl className="nova-import-stats">
            <div><dt>Dateien</dt><dd>{status.filesSuccess ?? files.length}</dd></div>
            <div><dt>Wissenseinträge</dt><dd>{status.items ?? 0}</dd></div>
            {chatgpt ? (
              <>
                <div><dt>Gespräche</dt><dd>{status.conversations ?? 0}</dd></div>
                <div><dt>Nachrichten</dt><dd>{status.messages ?? 0}</dd></div>
                <div><dt>Entscheidungen</dt><dd>{status.decisions ?? 0}</dd></div>
                <div><dt>erkannte Projekte/Firmen</dt><dd>{status.entities ?? 0}</dd></div>
                <div><dt>erkannte Widersprüche</dt><dd>{status.contradictions ?? 0}</dd></div>
              </>
            ) : null}
          </dl>
          <button
            type="button"
            className="nova-chip"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Schließen
          </button>
        </>
      ) : null}

      {phase === "error" ? (
        <>
          <p className="nova-import-error">{error}</p>
          <div className="nova-import-actions">
            <label htmlFor="nova-upload-input" className="nova-chip nova-import-action" style={{ cursor: "pointer" }}>
              Erneut starten
            </label>
            <button
              type="button"
              className="nova-chip"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Schließen
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
