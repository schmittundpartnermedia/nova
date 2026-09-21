import type { FacialAnimationProvider } from "@/types/facial";
import { HeuristicFacialProvider } from "@/providers/facial/heuristic";
import { NvidiaAudio2FaceProvider } from "@/providers/facial/nvidia-audio2face";

export async function resolveFacialProvider(): Promise<FacialAnimationProvider> {
  const nvidia = new NvidiaAudio2FaceProvider();
  const health = await nvidia.healthCheck();
  if (health.available) return nvidia;
  // HeuristicFacialProvider ist DEVELOPMENT ONLY und kein Production-Lip-Sync.
  return new HeuristicFacialProvider();
}
