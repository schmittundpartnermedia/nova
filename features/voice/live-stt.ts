export type LiveSttEvent =
  | { type: "speech_started" }
  | { type: "speech_stopped" }
  | { type: "delta"; delta: string }
  | { type: "completed"; transcript: string }
  | { type: "error"; message: string };

export type LiveStt = {
  start(listener: (event: LiveSttEvent) => void): Promise<void>;
  sendPcm(samples: Int16Array): void;
  setPaused(paused: boolean): void;
  stop(): void;
};

const BATCH_SAMPLES = 2400;

export class HttpLiveStt implements LiveStt {
  private sessionId = "";
  private listener: ((event: LiveSttEvent) => void) | null = null;
  private abort: AbortController | null = null;
  private paused = false;
  private pending = new Int16Array(0);
  private sending = false;

  async start(listener: (event: LiveSttEvent) => void) {
    this.stop();
    this.listener = listener;
    const started = await fetch("/api/nova/transcribe-live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const data = (await started.json().catch(() => null)) as { ok?: boolean; sessionId?: string; error?: string } | null;
    if (!started.ok || !data?.ok || !data.sessionId) {
      throw new Error(data?.error || "Spracheingabe momentan nicht verfügbar.");
    }
    this.sessionId = data.sessionId;
    this.abort = new AbortController();
    void this.listen(this.sessionId, this.abort.signal);
  }

  sendPcm(samples: Int16Array) {
    if (this.paused || !this.sessionId || samples.length === 0) return;
    const merged = new Int16Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    this.pending = merged;
    if (this.pending.length >= BATCH_SAMPLES) void this.flush();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.pending = new Int16Array(0);
    if (!this.sessionId) return;
    void post({ action: paused ? "pause" : "resume", sessionId: this.sessionId });
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.pending = new Int16Array(0);
    const sessionId = this.sessionId;
    this.sessionId = "";
    this.listener = null;
    this.paused = false;
    if (sessionId) void post({ action: "stop", sessionId });
  }

  private async flush() {
    if (this.sending || this.paused || !this.sessionId || this.pending.length === 0) return;
    this.sending = true;
    const chunk = this.pending;
    this.pending = new Int16Array(0);
    try {
      await post({ action: "audio", sessionId: this.sessionId, pcm: int16ToBase64(chunk) });
    } catch {
      this.listener?.({ type: "error", message: "Spracheingabe momentan nicht verfügbar." });
    } finally {
      this.sending = false;
      if (this.pending.length >= BATCH_SAMPLES) void this.flush();
    }
  }

  private async listen(sessionId: string, signal: AbortSignal) {
    try {
      const response = await fetch(`/api/nova/transcribe-live?sessionId=${encodeURIComponent(sessionId)}`, { signal });
      if (!response.ok || !response.body) {
        this.listener?.({ type: "error", message: "Spracheingabe momentan nicht verfügbar." });
        return;
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
          if (!line) continue;
          const event = parseEvent(line);
          if (event) this.listener?.(event);
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : "Spracheingabe momentan nicht verfügbar.";
      this.listener?.({ type: "error", message });
    }
  }
}

function parseEvent(line: string): LiveSttEvent | null {
  try {
    const payload = JSON.parse(line) as LiveSttEvent | { type: string };
    if (payload.type === "speech_started") return { type: "speech_started" };
    if (payload.type === "speech_stopped") return { type: "speech_stopped" };
    if (payload.type === "delta" && "delta" in payload) return { type: "delta", delta: payload.delta };
    if (payload.type === "completed" && "transcript" in payload) {
      return { type: "completed", transcript: payload.transcript };
    }
    if (payload.type === "error" && "message" in payload) return { type: "error", message: payload.message };
    return null;
  } catch {
    return null;
  }
}

async function post(body: Record<string, unknown>) {
  await fetch("/api/nova/transcribe-live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
