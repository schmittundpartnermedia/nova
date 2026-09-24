import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";
import { getTranscribeAdapter } from "@/lib/knowledge/transcribe";

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

export async function GET() {
  return Response.json({ ok: true, ready: hasOpenAIApiKey() });
}

export async function POST(request: Request) {
  const adapter = getTranscribeAdapter();
  if (!adapter.available()) {
    return Response.json({ ok: false, error: "Spracheingabe momentan nicht verfügbar." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "Ungültige Audiodaten." }, { status: 400 });
  }

  const uploaded = form.get("file");
  if (!(uploaded instanceof Blob) || uploaded.size < 200) {
    return Response.json({ ok: false, error: "Keine Sprachaufnahme." }, { status: 400 });
  }
  if (uploaded.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "Die Aufnahme ist zu lang." }, { status: 413 });
  }

  const mime = (uploaded.type || "audio/octet-stream").split(";")[0]?.trim() ?? "";
  if (mime && !ALLOWED.has(mime) && !mime.startsWith("audio/")) {
    return Response.json({ ok: false, error: "Ungültiges Audioformat." }, { status: 415 });
  }

  const filename = uploaded instanceof File && uploaded.name ? uploaded.name : "utterance.wav";

  try {
    const buffer = Buffer.from(await uploaded.arrayBuffer());
    const text = await adapter.transcribe({
      bytes: buffer,
      filename,
      mimeType: mime || "audio/wav",
    });
    return Response.json({ ok: true, text });
  } catch (error) {
    return Response.json(
      { ok: false, error: publicErrorMessage(error) || "Spracheingabe momentan nicht verfügbar." },
      { status: 503 },
    );
  }
}
