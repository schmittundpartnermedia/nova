import { VOICE_SESSION_CONFIG } from "@/features/voice/session-config";
import type { LiveSttEvent } from "@/features/voice/live-stt";

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const PRIMARY_MODEL = "gpt-live-transcribe";
const FALLBACK_MODEL = "gpt-4o-mini-transcribe";

export type RealtimeSttConnection = {
  sendPcmBase64(pcm: string): void;
  close(): void;
};

type OpenAISocket = WebSocket & {
  ping?: () => void;
};

export async function connectOpenAIRealtimeStt(
  onEvent: (event: LiveSttEvent) => void,
): Promise<RealtimeSttConnection> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Spracheingabe momentan nicht verfügbar.");
  }

  const ws = await openSocket(apiKey);
  let closed = false;
  let model = PRIMARY_MODEL;
  let fallbackUsed = false;

  const handleMessage = (raw: string) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(payload.type ?? "");
    if (type === "error") {
      const error = (payload.error ?? payload) as { message?: string; code?: string };
      const message = String(error.message ?? "Spracheingabe momentan nicht verfügbar.");
      if (!fallbackUsed && /model|invalid/i.test(message)) {
        fallbackUsed = true;
        model = FALLBACK_MODEL;
        configure(ws, model);
        return;
      }
      onEvent({ type: "error", message: "Spracheingabe momentan nicht verfügbar." });
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      onEvent({ type: "speech_started" });
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      onEvent({ type: "speech_stopped" });
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      const delta = String(payload.delta ?? "");
      if (delta) onEvent({ type: "delta", delta });
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(payload.transcript ?? "").replace(/\s+/g, " ").trim();
      onEvent({ type: "completed", transcript });
    }
  };

  ws.addEventListener("message", (event) => {
    const data = typeof event.data === "string" ? event.data : "";
    if (data) handleMessage(data);
  });
  ws.addEventListener("close", () => {
    if (closed) return;
    closed = true;
    onEvent({ type: "error", message: "Die Spracheingabe wurde unterbrochen." });
  });

  configure(ws, model);

  return {
    sendPcmBase64(pcm) {
      if (closed || ws.readyState !== WebSocket.OPEN || !pcm) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm }));
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}

function configure(ws: WebSocket, model: string) {
  const live = model === PRIMARY_MODEL;
  ws.send(
    JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: VOICE_SESSION_CONFIG.pcmSampleRate },
            noise_reduction: { type: "near_field" },
            transcription: live
              ? {
                  model,
                  languages: ["de"],
                  prompt: "Joachim spricht Deutsch mit NOVA. Begriffe: NOVA, Joachim, rankPilot.",
                  keywords: ["NOVA", "Joachim", "rankPilot"],
                  delay: "low",
                }
              : {
                  model,
                  language: "de",
                  prompt: "Joachim spricht Deutsch mit NOVA. Begriffe: NOVA, Joachim, rankPilot.",
                },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: VOICE_SESSION_CONFIG.silenceTimeoutMs,
            },
          },
        },
      },
    }),
  );
}

type NodeWebSocket = new (url: string, options?: { headers?: Record<string, string> }) => WebSocket;

function openSocket(apiKey: string): Promise<OpenAISocket> {
  return new Promise((resolve, reject) => {
    const ws = new (WebSocket as unknown as NodeWebSocket)(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Spracheingabe momentan nicht verfügbar."));
    }, 8000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws as OpenAISocket);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Spracheingabe momentan nicht verfügbar."));
    });
  });
}
