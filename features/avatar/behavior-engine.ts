import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaVec3 } from "@/types/avatar";
import { modeFromOrbState } from "@/features/avatar/state";
import { emotionToBlendshapes } from "@/features/avatar/emotion-map";
import { EyeTargetController } from "@/features/avatar/eye-controller";
import { LIP_SYNC_SET, normalizeBlendshapes } from "@/features/avatar/contract";

export type BehaviorSample = {
  blendshapes: Record<string, number>;
  headRotation: NovaVec3;
  neckRotation: NovaVec3;
  eyeBoneRotation: NovaVec3;
  breath: number;
};

export class NovaBehaviorEngine {
  private eyes = new EyeTargetController();
  private startedAt = 0;
  private lastNow = 0;
  private microUntil = 0;
  private micro: Record<string, number> = {};

  start(now: number) {
    this.startedAt = now;
    this.lastNow = now;
    this.eyes.reset(now);
  }

  reset(now: number) {
    this.start(now);
    this.micro = {};
  }

  sample(
    now: number,
    input: {
      state: OrbState;
      emotion: NovaAvatarEmotion;
      isSpeaking: boolean;
      speechIntensity: number;
      reducedMotion?: boolean;
    },
  ): BehaviorSample {
    if (!this.startedAt) this.start(now);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const t = (now - this.startedAt) / 1000;
    const mode = modeFromOrbState(input.state);
    const reduced = Boolean(input.reducedMotion);

    const eyeMode =
      mode === "listening" || mode === "speaking" || mode === "thinking" || mode === "idle"
        ? mode
        : "other";
    const eye = this.eyes.update(now, dt, eyeMode);
    if (mode === "listening" || mode === "speaking") this.eyes.setUserTarget();
    const eyeShapes = this.eyes.toBlendshapes(eye);
    const eyeBone = this.eyes.toEyeBoneRotation(eye);

    const emotionScale = mode === "speaking" ? 0.55 : 0.85;
    const emotion = emotionToBlendshapes(input.emotion, emotionScale);
    if (input.isSpeaking) {
      for (const key of Object.keys(emotion)) {
        if (LIP_SYNC_SET.has(key)) delete emotion[key];
      }
    }

    if (!reduced && now >= this.microUntil) {
      this.microUntil = now + 2800 + Math.random() * 4200;
      this.micro =
        Math.random() < 0.28
          ? { browInnerUp: 0.04 + Math.random() * 0.05 }
          : {};
    }

    const amp = reduced ? 0 : mode === "listening" ? 0.35 : 1;
    const breath = reduced ? 0 : (Math.sin(t * 1.15) * 0.5 + 0.5) * 0.018;
    let headX = Math.sin(t * 0.23) * 0.028 * amp;
    let headY = Math.sin(t * 0.17 + 0.4) * 0.02 * amp;
    let headZ = Math.sin(t * 0.11) * 0.012 * amp;

    if (mode === "listening") {
      headX *= 0.4;
      headY -= 0.015;
    }
    if (mode === "thinking" || mode === "working") {
      headY += 0.02;
      headZ -= 0.02;
    }
    if (mode === "speaking") {
      headY += Math.sin(t * 1.4) * 0.01 * (0.35 + input.speechIntensity * 0.4);
      headX += Math.sin(t * 0.9) * 0.012;
    }
    if (mode === "approval" || mode === "error") {
      headY -= 0.01;
    }

    return {
      blendshapes: {
        ...normalizeBlendshapes(emotion),
        ...normalizeBlendshapes(this.micro),
        ...eyeShapes,
      },
      headRotation: { x: headX, y: headY, z: headZ },
      neckRotation: { x: headX * 0.45, y: headY * 0.35, z: headZ * 0.4 },
      eyeBoneRotation: eyeBone,
      breath,
    };
  }
}
