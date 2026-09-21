/**
 * NVIDIA Audio2Face-3D Client – nur dokumentierte Schnittstellen.
 *
 * Runtime: Audio2Face-3D NIM Container, nicht Browser.
 * Docs: https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/interacting/a2f-rpc.html
 *
 * gRPC:
 *   package nvidia_ace.services.a2f_controller.v1
 *   service A2FControllerService { rpc ProcessAudioStream(...) }
 *
 * Audio:
 *   AUDIO_FORMAT_PCM, channel_count=1, bits_per_sample=16, samples_per_second z.B. 16000
 *
 * Output:
 *   SkelAnimationHeader.blend_shapes (ARKit-Namen)
 *   SkelAnimation.blend_shape_weights[].time_code (Sekunden)
 *   optionale Joint-Rotationen
 *
 * Dieser Client führt keinen erfundenen NVIDIA-SDK-Code aus.
 * Ohne NOVA_A2F_GRPC_URL bleibt der Dienst bewusst unverbunden.
 */

export type Audio2FaceRuntimeInfo = {
  runsInBrowser: false;
  protocol: "grpc";
  service: "nvidia_ace.services.a2f_controller.v1.A2FControllerService";
  rpc: "ProcessAudioStream";
  defaultPort: 52000;
  httpHealthPort: 8000;
  input: "PCM 16-bit mono";
  output: "ARKit blendshapes + optional joints, time_code in seconds";
  gpuRequired: true;
  license:
    "NVIDIA Software License Agreement / Product-Specific Terms for NVIDIA AI Products; Audio2Face models: NVIDIA Open Model License; Audio2Emotion: separate license, not for standalone emotion recognition";
};

export const AUDIO2FACE_RUNTIME: Audio2FaceRuntimeInfo = {
  runsInBrowser: false,
  protocol: "grpc",
  service: "nvidia_ace.services.a2f_controller.v1.A2FControllerService",
  rpc: "ProcessAudioStream",
  defaultPort: 52000,
  httpHealthPort: 8000,
  input: "PCM 16-bit mono",
  output: "ARKit blendshapes + optional joints, time_code in seconds",
  gpuRequired: true,
  license:
    "NVIDIA Software License Agreement / Product-Specific Terms for NVIDIA AI Products; Audio2Face models: NVIDIA Open Model License; Audio2Emotion: separate license, not for standalone emotion recognition",
};

export function getAudio2FaceGrpcTarget(): string | null {
  const value = process.env.NOVA_A2F_GRPC_URL?.trim();
  return value || null;
}

export async function probeAudio2Face(): Promise<{ configured: boolean; reachable: boolean; message: string }> {
  const target = getAudio2FaceGrpcTarget();
  if (!target) {
    return {
      configured: false,
      reachable: false,
      message: "NOVA_A2F_GRPC_URL ist nicht gesetzt. Audio2Face-3D NIM ist ein GPU-gRPC-Dienst, kein Browser-SDK.",
    };
  }
  return {
    configured: true,
    reachable: false,
    message: `gRPC-Ziel konfiguriert (${target}). Ein echter NIM-Prozess wurde in dieser Umgebung nicht angebunden.`,
  };
}
