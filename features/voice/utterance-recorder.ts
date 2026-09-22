import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";

export type UtteranceRecorder = {
  attach(stream: MediaStream | null): void;
  begin(): void;
  end(): Promise<Blob | null>;
  stop(): void;
};

function preferredRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/mpeg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function isUtteranceRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined";
}

export function createUtteranceRecorder(config: VoiceSessionConfig = VOICE_SESSION_CONFIG): UtteranceRecorder {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mime = "";
  const minBytes = config.utteranceMinBytes;

  return {
    attach(next) {
      stream = next;
    },
    begin() {
      if (!stream || recorder) return;
      chunks = [];
      mime = preferredRecorderMime();
      try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mime = recorder.mimeType || mime;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        recorder.start(250);
      } catch {
        recorder = null;
        chunks = [];
      }
    },
    end() {
      const current = recorder;
      recorder = null;
      if (!current) {
        const blob = blobFrom(chunks, mime);
        chunks = [];
        return Promise.resolve(usable(blob, minBytes));
      }
      return new Promise((resolve) => {
        const finish = () => {
          const blob = blobFrom(chunks, current.mimeType || mime);
          chunks = [];
          resolve(usable(blob, minBytes));
        };
        current.onstop = finish;
        current.onerror = finish;
        try {
          if (current.state === "inactive") finish();
          else current.stop();
        } catch {
          finish();
        }
      });
    },
    stop() {
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        // already stopped
      }
      recorder = null;
      chunks = [];
      stream = null;
    },
  };
}

function blobFrom(chunks: Blob[], mime: string): Blob | null {
  if (!chunks.length) return null;
  return new Blob(chunks, { type: mime || chunks[0]?.type || "audio/webm" });
}

function usable(blob: Blob | null, minBytes: number): Blob | null {
  if (!blob || blob.size < minBytes) return null;
  return blob;
}
