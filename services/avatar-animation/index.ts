import { probeAudio2Face, AUDIO2FACE_RUNTIME } from "@/services/avatar-animation/nvidia-a2f";
import type { AvatarAnimationHealth } from "@/services/avatar-animation/protocol";

export { AUDIO2FACE_RUNTIME, probeAudio2Face, getAudio2FaceGrpcTarget } from "@/services/avatar-animation/nvidia-a2f";
export type {
  AvatarAnimationHealth,
  AvatarAnimationRequest,
  AvatarAnimationResponse,
} from "@/services/avatar-animation/protocol";

export async function getAvatarAnimationHealth(): Promise<AvatarAnimationHealth> {
  const a2f = await probeAudio2Face();
  if (a2f.configured && a2f.reachable) {
    return {
      ok: true,
      provider: "nvidia-audio2face",
      a2fConfigured: true,
      a2fReachable: true,
      message: a2f.message,
    };
  }
  return {
    ok: true,
    provider: "heuristic",
    a2fConfigured: a2f.configured,
    a2fReachable: a2f.reachable,
    message: a2f.message,
  };
}

export function audio2FaceArchitectureNote(): string {
  return [
    "NOVA WEB APP → Voice Audio → Avatar Animation Service → Audio2Face-3D NIM (gRPC) → Facial Frames → Browser Avatar Runtime.",
    `Service: ${AUDIO2FACE_RUNTIME.service}.${AUDIO2FACE_RUNTIME.rpc}`,
    `Input: ${AUDIO2FACE_RUNTIME.input}; Output: ${AUDIO2FACE_RUNTIME.output}`,
  ].join(" ");
}
