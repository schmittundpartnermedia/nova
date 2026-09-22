const INT16_MIN = -0x8000;
const INT16_MAX = 0x7fff;

export function downsampleToInt16(input: Float32Array, fromRate: number, toRate: number): Int16Array {
  if (input.length === 0) return new Int16Array(0);
  if (fromRate <= 0 || toRate <= 0) return new Int16Array(0);
  if (Math.abs(fromRate - toRate) < 1) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) out[i] = floatToInt16(input[i] ?? 0);
    return out;
  }
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const n = Math.max(1, end - start);
    for (let j = start; j < end; j += 1) sum += input[j] ?? 0;
    out[i] = floatToInt16(sum / n);
  }
  return out;
}

export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i] ?? 0, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class PcmSlicer {
  private readonly sampleRate: number;
  private readonly data: Int16Array;
  private write = 0;
  private filled = 0;
  private originMs = 0;

  constructor(sampleRate: number, seconds: number) {
    this.sampleRate = sampleRate;
    this.data = new Int16Array(Math.max(1, Math.floor(sampleRate * seconds)));
  }

  clear(nowMs = 0) {
    this.write = 0;
    this.filled = 0;
    this.originMs = nowMs;
  }

  get endMs() {
    return this.originMs + (this.filled / this.sampleRate) * 1000;
  }

  appendMono(input: Float32Array, nativeRate: number, atMs: number) {
    const samples = downsampleToInt16(input, nativeRate, this.sampleRate);
    if (samples.length === 0) return;
    if (this.filled === 0) this.originMs = atMs;
    const cap = this.data.length;
    const originStep = 1000 / this.sampleRate;
    for (let i = 0; i < samples.length; i += 1) {
      this.data[this.write] = samples[i] ?? 0;
      this.write = (this.write + 1) % cap;
      if (this.filled < cap) this.filled += 1;
      else this.originMs += originStep;
    }
  }

  slice(fromMs: number, toMs: number): Int16Array {
    if (this.filled === 0) return new Int16Array(0);
    const startMs = Math.max(this.originMs, fromMs);
    const endMs = Math.min(this.endMs, Math.max(startMs, toMs));
    const startIndex = Math.floor(((startMs - this.originMs) / 1000) * this.sampleRate);
    const endIndex = Math.min(this.filled, Math.ceil(((endMs - this.originMs) / 1000) * this.sampleRate));
    const length = Math.max(0, endIndex - startIndex);
    const out = new Int16Array(length);
    const cap = this.data.length;
    const startPhysical = (this.write - this.filled + startIndex + cap * 4) % cap;
    for (let i = 0; i < length; i += 1) {
      out[i] = this.data[(startPhysical + i) % cap] ?? 0;
    }
    return out;
  }
}

function floatToInt16(sample: number): number {
  const clipped = Math.max(-1, Math.min(1, sample));
  const scaled = clipped < 0 ? clipped * -INT16_MIN : clipped * INT16_MAX;
  return Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(scaled)));
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
