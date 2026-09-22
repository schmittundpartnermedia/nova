import { connectOpenAIRealtimeStt, type RealtimeSttConnection } from "@/lib/voice/openai-realtime-stt";
import type { LiveSttEvent } from "@/features/voice/live-stt";

export type LiveSttServerSession = {
  id: string;
  sendPcm(pcm: string): void;
  subscribe(listener: (event: LiveSttEvent) => void): () => void;
  setPaused(paused: boolean): void;
  close(): void;
};

type Entry = {
  connection: RealtimeSttConnection;
  listeners: Set<(event: LiveSttEvent) => void>;
  paused: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const g = globalThis as typeof globalThis & { __novaLiveStt?: Map<string, Entry> };

function store(): Map<string, Entry> {
  if (!g.__novaLiveStt) g.__novaLiveStt = new Map();
  return g.__novaLiveStt;
}

export async function createLiveSttSession(): Promise<LiveSttServerSession> {
  const id = `stt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const listeners = new Set<(event: LiveSttEvent) => void>();
  const connection = await connectOpenAIRealtimeStt((event) => {
    for (const listener of listeners) listener(event);
  });
  const entry: Entry = {
    connection,
    listeners,
    paused: false,
    timer: setTimeout(() => closeLiveSttSession(id), 2 * 60 * 60 * 1000),
  };
  store().set(id, entry);
  return wrap(id, entry);
}

export function getLiveSttSession(id: string): LiveSttServerSession | null {
  const entry = store().get(id);
  return entry ? wrap(id, entry) : null;
}

export function closeLiveSttSession(id: string) {
  const sessions = store();
  const entry = sessions.get(id);
  if (!entry) return;
  sessions.delete(id);
  clearTimeout(entry.timer);
  entry.connection.close();
}

function wrap(id: string, entry: Entry): LiveSttServerSession {
  return {
    id,
    sendPcm(pcm) {
      if (entry.paused) return;
      entry.connection.sendPcmBase64(pcm);
    },
    subscribe(listener) {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    setPaused(paused) {
      entry.paused = paused;
    },
    close() {
      closeLiveSttSession(id);
    },
  };
}
