"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ImportPhase = "idle" | "ready" | "running" | "done" | "error";

type ImportReport = {
  conversations: number;
  messages: number;
  items: number;
  decisions: number;
  entities: number;
  contradictions: number;
};

type StatusPayload = {
  ok?: boolean;
  running?: boolean;
  finished?: boolean;
  jobId?: string;
  importId?: string;
  percent?: number;
  error?: string | null;
  conversations?: number;
  messages?: number;
  items?: number;
  decisions?: number;
  entities?: number;
  contradictions?: number;
};

function reportFromStatus(data: StatusPayload): ImportReport {
  return {
    conversations: data.conversations ?? 0,
    messages: data.messages ?? 0,
    items: data.items ?? 0,
    decisions: data.decisions ?? 0,
    entities: data.entities ?? 0,
    contradictions: data.contradictions ?? 0,
  };
}

export function NovaChatGptImport({
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
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);

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
      setReport(reportFromStatus(data));
      stopPoll();
      return true;
    }
    return false;
  }, [stopPoll]);

  const poll = useCallback(
    async (nextJobId?: string) => {
      const id = nextJobId ?? jobIdRef.current;
      const query = id ? `?jobId=${encodeURIComponent(id)}` : "";
      const response = await fetch(`/api/import/chatgpt${query}`);
      const data = (await response.json()) as StatusPayload;
      applyStatus(data);
    },
    [applyStatus],
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/import/chatgpt");
        const data = (await response.json()) as StatusPayload;
        if (data.running) applyStatus(data);
      } catch {
        // UI bleibt im Ruhezustand
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
    setFile(null);
    setPercent(0);
    setError("");
    setReport(null);
    jobIdRef.current = null;
  }, [stopPoll]);

  const startImport = useCallback(async (nextFile: File) => {
    setPhase("running");
    setPercent(1);
    setError("");
    setReport(null);
    try {
      const body = new FormData();
      body.append("file", nextFile);
      const response = await fetch("/api/import/chatgpt", { method: "POST", body });
      const data = (await response.json()) as StatusPayload & { started?: boolean; error?: string };
      if (!response.ok || data.ok === false) {
        setPhase("error");
        setError(data.error || "Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.");
        return;
      }
      if (typeof data.jobId === "string") jobIdRef.current = data.jobId;
      setPercent(typeof data.percent === "number" ? data.percent : 2);
      void poll(data.jobId);
    } catch {
      setPhase("error");
      setError("Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.");
    }
  }, [poll]);

  const visible = open || phase === "running" || phase === "done" || phase === "error" || phase === "ready";
  if (!visible) return null;

  return (
    <div className="nova-card nova-panel nova-import-card">
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="nova-file-input"
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          setFile(next);
          setPhase("ready");
          setError("");
        }}
      />

      {phase === "idle" ? (
        <>
          <h3>Einstellungen</h3>
          <p>ChatGPT-Verlauf importieren</p>
          <div className="nova-import-actions">
            <button type="button" className="nova-chip nova-import-action" onClick={() => fileRef.current?.click()}>
              ZIP-Datei wählen
            </button>
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

      {phase === "ready" && file ? (
        <>
          <h3>ChatGPT-Verlauf importieren</h3>
          <p className="nova-import-file">{file.name}</p>
          <div className="nova-import-actions">
            <button type="button" className="nova-chip" onClick={() => fileRef.current?.click()}>
              Andere Datei
            </button>
            <button type="button" className="nova-chip nova-import-action" onClick={() => void startImport(file)}>
              Import starten
            </button>
          </div>
        </>
      ) : null}

      {phase === "running" ? (
        <>
          <p>ChatGPT-Verlauf wird importiert …</p>
          <p className="nova-import-percent">{Math.max(0, Math.min(100, Math.round(percent)))}%</p>
        </>
      ) : null}

      {phase === "done" && report ? (
        <>
          <p>ChatGPT-Verlauf importiert.</p>
          <dl className="nova-import-stats">
            <div><dt>Gespräche</dt><dd>{report.conversations}</dd></div>
            <div><dt>Nachrichten</dt><dd>{report.messages}</dd></div>
            <div><dt>Wissenseinträge</dt><dd>{report.items}</dd></div>
            <div><dt>Entscheidungen</dt><dd>{report.decisions}</dd></div>
            <div><dt>erkannte Projekte/Firmen</dt><dd>{report.entities}</dd></div>
            <div><dt>erkannte Widersprüche</dt><dd>{report.contradictions}</dd></div>
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
            <button
              type="button"
              className="nova-chip nova-import-action"
              onClick={() => {
                if (file) void startImport(file);
                else fileRef.current?.click();
              }}
            >
              Erneut starten
            </button>
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
