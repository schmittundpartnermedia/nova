import OpenAI, { toFile } from "openai";
import { bucheVerbrauch } from "@/lib/kosten";
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

/** Länge einer WAV-Aufnahme aus dem Kopf (Bytes je Sekunde an Stelle 28); andere Formate: unbekannt. */
function audioSekunden(bytes: Uint8Array): number | null {
  if (bytes.length < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") return null;
  const byteRate = bytes[28]! | (bytes[29]! << 8) | (bytes[30]! << 16) | (bytes[31]! << 24);
  return byteRate > 0 ? (bytes.length - 44) / byteRate : null;
}

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
      bucheVerbrauch({ art: "spracherkennung", modell: "gpt-4o-mini-transcribe", sekunden: audioSekunden(input.bytes) ?? undefined });
      return (result.text ?? "").replace(/\s+/g, " ").trim();
    } catch {
      const result = await client.audio.transcriptions.create({
        file: await toFile(input.bytes, filename, { type }),
        model: "whisper-1",
        language: "de",
        prompt: "NOVA, Joachim, rankPilot.",
      });
      bucheVerbrauch({ art: "spracherkennung", modell: "whisper-1", sekunden: audioSekunden(input.bytes) ?? undefined });
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
