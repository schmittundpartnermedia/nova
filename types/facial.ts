import type { NovaAvatarEmotion, NovaFacialFrame, NovaVec3 } from "@/types/avatar";

export type FacialProviderId =
  | "heuristic"
  | "nvidia-audio2face"
  | "azure-viseme"
  | "local-facial-model";

export type FacialProviderHealth = {
  ok: boolean;
  provider: FacialProviderId;
  available: boolean;
  message: string;
};

export type FacialAnalyzeInput = {
  audio: ArrayBuffer | Float32Array;
  sampleRate: number;
  mimeType?: string;
  signal?: AbortSignal;
};

export interface FacialAnimationProvider {
  id: FacialProviderId;
  name: string;
  initialize(): Promise<void>;
  healthCheck(): Promise<FacialProviderHealth>;
  /**
   * Offline / burst path: audio in, timestamped facial frames out.
   * Used by Audio2Face-3D and similar services.
   */
  analyze?(input: FacialAnalyzeInput): Promise<NovaFacialFrame[]>;
  /**
   * Live path: analyser is already clocked to playing audio.
   */
  startLive?(analyser: AnalyserNode, getAudioTimeMs: () => number): void;
  stopLive?(): void;
  setEmotion?(emotion: NovaAvatarEmotion): void;
  setListener?(listener: (frame: NovaFacialFrame) => void): void;
  dispose(): void;
}

export type NvidiaA2FSkelSample = {
  timeCode: number;
  blendShapeWeights: number[];
  jointRotations?: NovaVec3[];
};

export type NvidiaA2FAnimationPayload = {
  blendShapeNames: string[];
  jointNames?: string[];
  samples: NvidiaA2FSkelSample[];
};
