import OpenAI from "openai";
import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 8_000_000;
const ALLOWED = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/m4a",
  "video/webm",
  "video/mp4",
]);

export async function POST(request: Request) {
  if (!hasOpenAIApiKey()) {
    return Response.json({ ok: false, error: "Spracheingabe momentan nicht verfügbar." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "Ungültige Audiodaten." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size < 200) {
    return Response.json({ ok: false, error: "Keine Sprachaufnahme." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "Die Aufnahme ist zu lang." }, { status: 413 });
  }

  const mime = (file.type || "application/octet-stream").split(";")[0]?.trim() ?? "";
  if (mime && !ALLOWED.has(mime) && !mime.startsWith("audio/")) {
    return Response.json({ ok: false, error: "Ungültiges Audioformat." }, { status: 415 });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.audio.transcriptions.create(
      {
        file,
        model: "whisper-1",
        language: "de",
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    const text = (result.text ?? "").replace(/\s+/g, " ").trim();
    return Response.json({ ok: true, text });
  } catch (error) {
    return Response.json(
      { ok: false, error: publicErrorMessage(error) || "Spracheingabe momentan nicht verfügbar." },
      { status: 503 },
    );
  }
}
