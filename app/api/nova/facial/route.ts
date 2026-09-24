import { resolveFacialProvider } from "@/providers/facial/registry";
import { getAvatarAnimationHealth, audio2FaceArchitectureNote } from "@/services/avatar-animation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const [provider, animation] = await Promise.all([resolveFacialProvider(), getAvatarAnimationHealth()]);
  const health = await provider.healthCheck();
  return Response.json({
    ok: true,
    provider: health.provider,
    available: health.available,
    message: health.message,
    playback: "heuristic-in-browser",
    honesty:
      health.provider === "nvidia-audio2face"
        ? "Audio2Face ist erreichbar. Die Browser-Wiedergabe bleibt Heuristik, bis Frames vom Dienst kommen."
        : "Kein Audio2Face. Lippen im Browser kommen von HeuristicFacialProvider (DEVELOPMENT ONLY). Keine Webcam, kein Gesicht des Nutzers.",
    animation,
    architecture: audio2FaceArchitectureNote(),
  });
}
