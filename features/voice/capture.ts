import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";
import { extractVadFrame, type VadFrame } from "@/features/voice/vad";

export type VoiceCapture = {
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: (frame: VadFrame) => void): () => void;
};

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

export class MicrophoneCapture implements VoiceCapture {
  private readonly config: VoiceSessionConfig;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private listener: ((frame: VadFrame) => void) | null = null;
  private freq = new Uint8Array(0);
  private time = new Float32Array(0);
  private onTrackEnded: (() => void) | null = null;

  constructor(config: VoiceSessionConfig = VOICE_SESSION_CONFIG, onTrackEnded?: () => void) {
    this.config = config;
    this.onTrackEnded = onTrackEnded ?? null;
  }

  async start() {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", this.handleEnded);
    }
    const context = new AudioContext();
    this.context = context;
    if (context.state === "suspended") await context.resume();
    this.source = context.createMediaStreamSource(this.stream);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = this.config.fftSize;
    this.analyser.smoothingTimeConstant = 0.35;
    this.source.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Float32Array(this.analyser.fftSize);
    this.tick();
  }

  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) {
        track.removeEventListener("ended", this.handleEnded);
        track.stop();
      }
    }
    if (this.context && this.context.state !== "closed") {
      void this.context.close().catch(() => undefined);
    }
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
  }

  subscribe(listener: (frame: VadFrame) => void) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  private handleEnded = () => {
    this.onTrackEnded?.();
  };

  private tick = () => {
    const analyser = this.analyser;
    const context = this.context;
    if (!analyser || !context) return;
    analyser.getByteFrequencyData(this.freq);
    analyser.getFloatTimeDomainData(this.time);
    this.listener?.(
      extractVadFrame({
        frequency: this.freq,
        time: this.time,
        sampleRate: context.sampleRate,
        fftSize: analyser.fftSize,
        timestampMs: performance.now(),
        config: this.config,
      }),
    );
    this.raf = requestAnimationFrame(this.tick);
  };
}
