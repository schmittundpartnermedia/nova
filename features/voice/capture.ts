import { encodeWavPcm16, PcmSlicer } from "@/features/voice/pcm";
import { VOICE_SESSION_CONFIG, type VoiceSessionConfig } from "@/features/voice/session-config";
import { energyFromTimeDomain, type VadFrame } from "@/features/voice/vad";

export type VoiceCapture = {
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: (frame: VadFrame) => void): () => void;
  setCollecting(on: boolean): void;
  sliceUtterance(fromMs: number, toMs: number): Promise<Blob | null>;
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

const PCM_WORKLET = `
class NovaPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor("nova-pcm-capture", NovaPcmCapture);
`;

export function isVoiceCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export class MicrophoneCapture implements VoiceCapture {
  private readonly config: VoiceSessionConfig;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private listener: ((frame: VadFrame) => void) | null = null;
  private onTrackEnded: (() => void) | null = null;
  private pcm: PcmSlicer;
  private collecting = true;
  private vadSumSq = 0;
  private vadPeak = 0;
  private vadCount = 0;
  private vadLastEmit = 0;

  constructor(config: VoiceSessionConfig = VOICE_SESSION_CONFIG, onTrackEnded?: () => void) {
    this.config = config;
    this.onTrackEnded = onTrackEnded ?? null;
    this.pcm = new PcmSlicer(config.pcmSampleRate, config.pcmBufferSeconds);
  }

  async start() {
    this.stop();
    const context = createAudioContext();
    this.context = context;
    if (context.state === "suspended") void context.resume();
    this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    if (context.state === "suspended") await context.resume();
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", this.handleEnded);
    }
    this.source = context.createMediaStreamSource(this.stream);
    this.mute = context.createGain();
    this.mute.gain.value = 0;
    this.pcm.clear(nowMs());
    this.collecting = true;
    this.resetVadWindow(nowMs());
    const hooked = (await this.connectWorklet(context)) || this.connectProcessor(context);
    if (!hooked) {
      throw new Error("Audio-Aufnahme ist in diesem WebView nicht verfügbar.");
    }
    this.mute.connect(context.destination);
  }

  stop() {
    if (this.processor) this.processor.onaudioprocess = null;
    if (this.worklet) this.worklet.port.onmessage = null;
    disconnect(this.source);
    disconnect(this.processor);
    disconnect(this.worklet);
    disconnect(this.mute);
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) {
        track.removeEventListener("ended", this.handleEnded);
        track.stop();
      }
    }
    if (this.context && this.context.state !== "closed") {
      void this.context.close().catch(() => undefined);
    }
    this.pcm.clear(0);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.processor = null;
    this.worklet = null;
    this.mute = null;
    this.collecting = false;
  }

  setCollecting(on: boolean) {
    this.collecting = on;
    if (on) {
      const at = nowMs();
      this.pcm.clear(at);
      this.resetVadWindow(at);
    }
  }

  async sliceUtterance(fromMs: number, toMs: number) {
    const samples = this.pcm.slice(fromMs, toMs);
    if (samples.length < 160) return null;
    const blob = encodeWavPcm16(samples, this.config.pcmSampleRate);
    if (blob.size < this.config.utteranceMinBytes) return null;
    return blob;
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

  private ingest = (input: Float32Array) => {
    const context = this.context;
    if (!context) return;
    const at = nowMs();
    if (!this.collecting) {
      if (at - this.vadLastEmit >= 20) {
        this.vadLastEmit = at;
        this.listener?.({ timestampMs: at, rms: 0, peak: 0 });
      }
      return;
    }
    this.pcm.appendMono(input, context.sampleRate, at);
    const energy = energyFromTimeDomain(input);
    this.vadSumSq += energy.rms * energy.rms * input.length;
    if (energy.peak > this.vadPeak) this.vadPeak = energy.peak;
    this.vadCount += input.length;
    if (at - this.vadLastEmit < 20 || this.vadCount === 0) return;
    const rms = Math.sqrt(this.vadSumSq / this.vadCount);
    this.listener?.({ timestampMs: at, rms, peak: this.vadPeak });
    this.resetVadWindow(at);
  };

  private resetVadWindow(at: number) {
    this.vadSumSq = 0;
    this.vadPeak = 0;
    this.vadCount = 0;
    this.vadLastEmit = at;
  }

  private onAudio = (event: AudioProcessingEvent) => {
    this.ingest(event.inputBuffer.getChannelData(0));
  };

  private async connectWorklet(context: AudioContext): Promise<boolean> {
    if (!this.source || !this.mute || !context.audioWorklet) return false;
    try {
      const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, "nova-pcm-capture");
      node.port.onmessage = (event) => {
        if (event.data instanceof Float32Array) this.ingest(event.data);
      };
      this.worklet = node;
      this.source.connect(node);
      node.connect(this.mute);
      return true;
    } catch {
      this.worklet = null;
      return false;
    }
  }

  private connectProcessor(context: AudioContext): boolean {
    if (!this.source || !this.mute) return false;
    const processor = createScriptProcessor(context);
    if (!processor) return false;
    this.processor = processor;
    processor.onaudioprocess = this.onAudio;
    this.source.connect(processor);
    processor.connect(this.mute);
    return true;
  }
}

function createAudioContext(): AudioContext {
  const g = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error("Audio-Aufnahme ist in diesem WebView nicht verfügbar.");
  return new Ctor();
}

function createScriptProcessor(context: AudioContext): ScriptProcessorNode | null {
  const ctor = context as AudioContext & {
    createScriptProcessor?: (bufferSize: number, input: number, output: number) => ScriptProcessorNode;
    createJavaScriptNode?: (bufferSize: number, input: number, output: number) => ScriptProcessorNode;
  };
  const create = ctor.createScriptProcessor ?? ctor.createJavaScriptNode;
  if (typeof create !== "function") return null;
  return create.call(context, 4096, 1, 1);
}

function disconnect(node: AudioNode | null) {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // already disconnected
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
