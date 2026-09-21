/**
 * Protokoll zwischen NOVA Web App und dem Avatar Animation Service.
 *
 * Audio2Face-3D NIM spricht gRPC, nicht den Browser:
 *   A2FControllerService.ProcessAudioStream
 *   Input: PCM 16-bit mono, typisch 16 kHz
 *   Output: SkelAnimationHeader.blend_shapes + FloatArrayWithTimeCode
 *
 * Quelle: NVIDIA ACE Audio2Face-3D Microservice Doku (v2.0 / latest).
 */

export type AvatarAnimationHealth = {
  ok: boolean;
  provider: "heuristic" | "nvidia-audio2face";
  a2fConfigured: boolean;
  a2fReachable: boolean;
  message: string;
};

export type AvatarAnimationRequest = {
  sampleRate: number;
  channelCount: 1;
  bitsPerSample: 16;
  audioBase64?: string;
};

export type AvatarAnimationFrameDto = {
  timeCode: number;
  blendShapeWeights: number[];
};

export type AvatarAnimationResponse = {
  provider: "heuristic" | "nvidia-audio2face";
  blendShapeNames: string[];
  jointNames: string[];
  samples: AvatarAnimationFrameDto[];
};
