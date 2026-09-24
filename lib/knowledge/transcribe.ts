import OpenAI, { toFile } from "openai";
import { hasOpenAIApiKey } from "@/lib/secrets";

export type TranscribeAdapter = {
  id: string;
  available(): boolean;
  transcribe(input: { bytes: Buffer; filename: string; mimeType?: string }): Promise<string>;
};

const MAX_BYTES = 8_000_000;

let override: TranscribeAdapter | null = null;

const noneAdapter: TranscribeAdapter = {
  id: "none",
  available() {
    return false;
  },
  async transcribe() {
    throw new Error("Transkription ist nicht konfiguriert.");
  },
};

const openaiAdapter: TranscribeAdapter = {
  id: "openai-transcribe",
  available() {
    return hasOpenAIApiKey();
  },
  async transcribe(input) {
    if (input.bytes.length < 200) return "";
    if (input.bytes.length > MAX_BYTES) {
      throw new Error("Audiodatei ist zu groß für Transkription.");
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const filename = input.filename || "audio.wav";
    const type = input.mimeType || "audio/wav";
    try {
      const result = await client.audio.transcriptions.create({
        file: await toFile(input.bytes, filename, { type }),
        model: "gpt-4o-mini-transcribe",
        language: "de",
        prompt: "Joachim spricht Deutsch mit NOVA. Begriffe: NOVA, Joachim, rankPilot.",
      });
      return (result.text ?? "").replace(/\s+/g, " ").trim();
    } catch {
      const result = await client.audio.transcriptions.create({
        file: await toFile(input.bytes, filename, { type }),
        model: "whisper-1",
        language: "de",
        prompt: "NOVA, Joachim, rankPilot.",
      });
      return (result.text ?? "").replace(/\s+/g, " ").trim();
    }
  },
};

export function getTranscribeAdapter(): TranscribeAdapter {
  if (override) return override;
  return openaiAdapter.available() ? openaiAdapter : noneAdapter;
}

export function setTranscribeAdapterForTests(adapter: TranscribeAdapter | null): void {
  override = adapter;
}

export function canTranscribeMedia(size: number): boolean {
  return size >= 200 && size <= MAX_BYTES;
}
