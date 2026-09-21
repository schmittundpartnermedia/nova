import type { NovaFacialFrame } from "@/types/avatar";
import type {
  FacialAnalyzeInput,
  FacialAnimationProvider,
  FacialProviderHealth,
} from "@/types/facial";
import { nvidiaAnimationToFrames } from "@/providers/facial/heuristic";

/**
 * NVIDIA Audio2Face-3D läuft nicht im Browser.
 * Dokumentierte Runtime: Audio2Face-3D NIM (gRPC ProcessAudioStream).
 * Quelle: https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/interacting/a2f-rpc.html
 *
 * Dieser Provider spricht nur den NOVA Avatar Animation Service an.
 * Ohne konfigurierten Service ist er bewusst nicht verfügbar – kein Fake-Fallback auf Bilder.
 */
export class NvidiaAudio2FaceProvider implements FacialAnimationProvider {
  id = "nvidia-audio2face" as const;
  name = "NvidiaAudio2FaceProvider";
  private endpoint: string | null;

  constructor(endpoint = process.env.NEXT_PUBLIC_NOVA_A2F_SERVICE_URL ?? process.env.NOVA_A2F_SERVICE_URL ?? "") {
    this.endpoint = endpoint.trim() || null;
  }

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<FacialProviderHealth> {
    if (!this.endpoint) {
      return {
        ok: false,
        provider: this.id,
        available: false,
        message:
          "Audio2Face-3D ist nicht konfiguriert. NIM läuft nicht im Browser; NOVA_A2F_GRPC_URL am Animation Service setzen.",
      };
    }
    try {
      const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/health`, { cache: "no-store" });
      if (!response.ok) {
        return {
          ok: false,
          provider: this.id,
          available: false,
          message: `Audio2Face-Service nicht bereit (${response.status}).`,
        };
      }
      return {
        ok: true,
        provider: this.id,
        available: true,
        message: "Audio2Face-3D Animation Service erreichbar.",
      };
    } catch {
      return {
        ok: false,
        provider: this.id,
        available: false,
        message: "Audio2Face-Service nicht erreichbar.",
      };
    }
  }

  async analyze(input: FacialAnalyzeInput): Promise<NovaFacialFrame[]> {
    if (!this.endpoint) {
      throw new Error("Audio2Face-3D ist nicht konfiguriert.");
    }
    const bytes =
      input.audio instanceof ArrayBuffer
        ? input.audio
        : (input.audio.buffer.slice(input.audio.byteOffset, input.audio.byteOffset + input.audio.byteLength) as ArrayBuffer);
    const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      headers: { "Content-Type": input.mimeType ?? "application/octet-stream" },
      body: bytes,
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error("Audio2Face-3D Analyse fehlgeschlagen.");
    }
    const payload = (await response.json()) as {
      blendShapeNames: string[];
      samples: { timeCode: number; blendShapeWeights: number[] }[];
    };
    return nvidiaAnimationToFrames(payload);
  }

  dispose() {}
}
