"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

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

export type NovaUploadHandle = {
  pick: () => void;
  importFiles: (nextFiles: File[]) => void;
};

function filesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((item) => item.size >= 0 && item.name);
}

export const NovaUpload = forwardRef<NovaUploadHandle, { open: boolean; onClose: () => void }>(
  function NovaUpload({ open, onClose }, ref) {
    const fileRef = useRef<HTMLInputElement | null>(null);
    const pollRef = useRef<number | null>(null);
    const jobIdRef = useRef<string | null>(null);
    const [phase, setPhase] = useState<ImportPhase>("idle");
    const [files, setFiles] = useState<File[]>([]);
    const [percent, setPercent] = useState(0);
    const [error, setError] = useState("");
    const [status, setStatus] = useState<StatusPayload | null>(null);
    const [dragging, setDragging] = useState(false);

    const stopPoll = useCallback(() => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, []);

    const applyStatus = useCallback(
      (data: StatusPayload) => {
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
      },
      [stopPoll],
    );

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
      setDragging(false);
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

    const pick = useCallback(() => {
      fileRef.current?.click();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        pick,
        importFiles: (nextFiles: File[]) => {
          const next = filesFromList(nextFiles);
          if (next.length) void startImport(next);
        },
      }),
      [pick, startImport],
    );

    const onDragEnter = (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer.types.includes("Files")) setDragging(true);
    };

    const onDragOver = (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (event.dataTransfer.types.includes("Files")) setDragging(true);
    };

    const onDragLeave = (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setDragging(false);
    };

    const onDrop = (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      const next = filesFromList(event.dataTransfer.files);
      if (next.length) void startImport(next);
    };

    const fileInput = (
      <input
        ref={fileRef}
        id="nova-upload-input"
        type="file"
        multiple
        className="nova-file-input"
        onChange={(event) => {
          const next = filesFromList(event.target.files);
          event.target.value = "";
          if (next.length) void startImport(next);
        }}
      />
    );

    const visible = open || phase === "running" || phase === "done" || phase === "error";
    const chatgpt = status?.kind === "chatgpt" || (status?.conversations ?? 0) > 0;
    const runningLabel = chatgpt ? "ChatGPT-Verlauf wird importiert …" : "Dateien werden übernommen …";
    const doneLabel = chatgpt ? "ChatGPT-Verlauf importiert." : "Dateien übernommen.";

    return (
      <>
        {fileInput}
        {visible ? (
      <div
        className={`nova-card nova-panel nova-import-card ${dragging ? "drop-active" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {phase === "idle" ? (
          <>
            <h3>Dateien hochladen</h3>
            <p>PDF, Text, ChatGPT-ZIP, Office, Audio, Video oder Bilder. Ziehen oder wählen — NOVA legt sie lokal ab.</p>
            <div className="nova-import-drop" data-active={dragging ? "true" : "false"}>
              {dragging ? "Jetzt ablegen" : "Dateien hierher ziehen"}
            </div>
            <div className="nova-import-actions">
              <button type="button" className="nova-chip nova-import-action" onClick={pick}>
                Dateien wählen
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
              <div>
                <dt>Dateien</dt>
                <dd>{status.filesSuccess ?? files.length}</dd>
              </div>
              <div>
                <dt>Wissenseinträge</dt>
                <dd>{status.items ?? 0}</dd>
              </div>
              {chatgpt ? (
                <>
                  <div>
                    <dt>Gespräche</dt>
                    <dd>{status.conversations ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Nachrichten</dt>
                    <dd>{status.messages ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Entscheidungen</dt>
                    <dd>{status.decisions ?? 0}</dd>
                  </div>
                  <div>
                    <dt>erkannte Projekte/Firmen</dt>
                    <dd>{status.entities ?? 0}</dd>
                  </div>
                  <div>
                    <dt>erkannte Widersprüche</dt>
                    <dd>{status.contradictions ?? 0}</dd>
                  </div>
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
              <button type="button" className="nova-chip nova-import-action" onClick={pick}>
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
        ) : null}
      </>
    );
  },
);
