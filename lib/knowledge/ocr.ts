import OpenAI from "openai";
import { hasOpenAIApiKey } from "@/lib/secrets";

export type OcrAdapter = {
  id: string;
  available(): boolean;
  recognize(input: { bytes: Buffer; page?: number; mimeType?: string }): Promise<string>;
};

const MAX_BYTES = 4_000_000;

let override: OcrAdapter | null = null;

export const ocrFallback: OcrAdapter = {
  id: "none",
  available() {
    return false;
  },
  async recognize() {
    throw new Error("OCR ist vorbereitet, aber nicht konfiguriert. PDFs ohne Text-Layer werden nicht blind OCRt.");
  },
};

const openaiOcr: OcrAdapter = {
  id: "openai-vision",
  available() {
    return hasOpenAIApiKey();
  },
  async recognize(input) {
    if (input.bytes.length < 32 || input.bytes.length > MAX_BYTES) return "";
    const mime = input.mimeType || sniffImageMime(input.bytes) || "image/png";
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extrahiere den gesamten sichtbaren Text wörtlich. Keine Beschreibung des Bildes, keine Erfindung. Wenn kein Text zu sehen ist, antworte leer.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${input.bytes.toString("base64")}` },
            },
          ],
        },
      ],
    });
    return (completion.choices[0]?.message?.content ?? "").replace(/\s+/g, " ").trim();
  },
};

export function getOcrAdapter(): OcrAdapter {
  if (override) return override;
  return openaiOcr.available() ? openaiOcr : ocrFallback;
}

export function setOcrAdapterForTests(adapter: OcrAdapter | null): void {
  override = adapter;
}

export function shouldRunOcr(input: { hasTextLayer: boolean; ocrRequested?: boolean }): boolean {
  return input.hasTextLayer === false && input.ocrRequested === true && getOcrAdapter().available();
}

export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function extractEmbeddedImages(bytes: Buffer): Array<{ bytes: Buffer; mimeType: string }> {
  const images: Array<{ bytes: Buffer; mimeType: string }> = [];
  for (let i = 0; i < bytes.length - 1 && images.length < 4; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
      const end = bytes.indexOf(Buffer.from([0xff, 0xd9]), i + 2);
      if (end > i) {
        const slice = bytes.subarray(i, end + 2);
        if (slice.length > 400) images.push({ bytes: Buffer.from(slice), mimeType: "image/jpeg" });
        i = end + 1;
      }
    }
  }
  return images;
}
