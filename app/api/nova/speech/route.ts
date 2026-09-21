import { z } from "zod";
import { resolveVoiceProvider } from "@/providers/voice/registry";
import { NOVA_VOICE_CONFIG } from "@/providers/voice/config";
import { prepareTextForSpeech } from "@/services/voice/prepare-text";
import { publicErrorMessage, redactSecrets } from "@/lib/secrets";
import { VoiceUnavailableError } from "@/types/voice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
});

export async function GET() {
  const provider = resolveVoiceProvider();
  const health = await provider.healthCheck();
  return Response.json({
    ok: health.ok,
    provider: health.provider,
    model: health.model,
    voice: health.voice,
    language: NOVA_VOICE_CONFIG.language,
    message: health.ok ? "Sprachausgabe bereit." : "Sprachausgabe momentan nicht verfügbar.",
  });
}

export async function POST(request: Request) {
  let parsed: { text: string };
  try {
    const json = await request.json();
    parsed = bodySchema.parse(json);
  } catch {
    return Response.json(
      { ok: false, error: "Ungültige Anfrage." },
      { status: 400 },
    );
  }

  const spoken = prepareTextForSpeech(redactSecrets(parsed.text), { finalize: true });
  if (!spoken) {
    return Response.json(
      { ok: false, error: "Kein sprechbarer Text." },
      { status: 422 },
    );
  }

  const provider = resolveVoiceProvider();
  try {
    const result = await provider.synthesize({
      text: spoken,
      language: NOVA_VOICE_CONFIG.language,
      signal: request.signal,
    });
    const bytes = new Uint8Array(result.audio);
    return new Response(bytes, {
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "no-store",
        "X-Nova-Voice-Provider": result.provider,
        "X-Nova-Voice-Model": result.model,
        "X-Nova-Voice-Name": result.voice,
      },
    });
  } catch (error) {
    const message =
      error instanceof VoiceUnavailableError
        ? error.message
        : publicErrorMessage(error);
    return Response.json(
      { ok: false, error: message || "Sprachausgabe momentan nicht verfügbar." },
      { status: 503 },
    );
  }
}
