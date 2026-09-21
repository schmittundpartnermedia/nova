import type { NovaFacialFrame } from "@/types/avatar";
import { emptyBlendshapes, clampWeight } from "@/features/avatar/contract";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateFrames(a: NovaFacialFrame, b: NovaFacialFrame, t: number): NovaFacialFrame {
  const blendshapes = emptyBlendshapes();
  const keys = new Set([...Object.keys(a.blendshapes), ...Object.keys(b.blendshapes)]);
  for (const key of keys) {
    blendshapes[key] = clampWeight(lerp(a.blendshapes[key] ?? 0, b.blendshapes[key] ?? 0, t));
  }
  return {
    timestampMs: lerp(a.timestampMs, b.timestampMs, t),
    blendshapes,
    emotion: t < 0.5 ? a.emotion : b.emotion,
    confidence: lerp(a.confidence ?? 1, b.confidence ?? 1, t),
    headRotation:
      a.headRotation && b.headRotation
        ? {
            x: lerp(a.headRotation.x, b.headRotation.x, t),
            y: lerp(a.headRotation.y, b.headRotation.y, t),
            z: lerp(a.headRotation.z, b.headRotation.z, t),
          }
        : b.headRotation ?? a.headRotation,
    eyeTarget:
      a.eyeTarget && b.eyeTarget
        ? {
            x: lerp(a.eyeTarget.x, b.eyeTarget.x, t),
            y: lerp(a.eyeTarget.y, b.eyeTarget.y, t),
            z: lerp(a.eyeTarget.z, b.eyeTarget.z, t),
          }
        : b.eyeTarget ?? a.eyeTarget,
  };
}

export class AvatarTimelineController {
  private frames: NovaFacialFrame[] = [];
  private live: NovaFacialFrame | null = null;
  private getAudioTimeMs: () => number = () => 0;
  private playing = false;

  attachClock(getAudioTimeMs: () => number) {
    this.getAudioTimeMs = getAudioTimeMs;
  }

  load(frames: NovaFacialFrame[]) {
    this.frames = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
    this.live = null;
  }

  pushLive(frame: NovaFacialFrame) {
    this.live = frame;
  }

  clear() {
    this.frames = [];
    this.live = null;
  }

  start() {
    this.playing = true;
  }

  stop() {
    this.playing = false;
    this.live = null;
  }

  get audioTimeMs(): number {
    return Math.max(0, this.getAudioTimeMs());
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  sample(atMs = this.audioTimeMs): NovaFacialFrame | null {
    if (this.live && Math.abs((this.live.timestampMs ?? atMs) - atMs) <= 80) {
      return this.live;
    }
    if (this.frames.length === 0) return this.live;
    if (atMs <= (this.frames[0]?.timestampMs ?? 0)) return this.frames[0] ?? null;
    const last = this.frames[this.frames.length - 1];
    if (!last) return this.live;
    if (atMs >= last.timestampMs) return last;

    let low = 0;
    let high = this.frames.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const frame = this.frames[mid];
      if (!frame) break;
      if (frame.timestampMs <= atMs) low = mid + 1;
      else high = mid - 1;
    }
    const next = this.frames[low];
    const prev = this.frames[high];
    if (!prev) return next ?? this.live;
    if (!next) return prev;
    const span = next.timestampMs - prev.timestampMs;
    const t = span <= 0 ? 0 : (atMs - prev.timestampMs) / span;
    return interpolateFrames(prev, next, t);
  }
}
