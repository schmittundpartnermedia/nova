import type { NovaVec3 } from "@/types/avatar";

export type EyeControllerState = {
  look: { x: number; y: number };
  blinkLeft: number;
  blinkRight: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextDelay(now: number, meanMs: number, jitterMs: number): number {
  return now + meanMs + (Math.random() * 2 - 1) * jitterMs;
}

export class EyeTargetController {
  private look = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private saccadeUntil = 0;
  private blinkUntil = 0;
  private blinking = false;
  private blinkStart = 0;
  private blinkDuration = 110;
  private doubleBlink = false;
  private nextBlinkAt = 0;

  reset(now: number) {
    this.look = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.saccadeUntil = now + 900;
    this.blinking = false;
    this.nextBlinkAt = nextDelay(now, 4200, 1800);
  }

  setUserTarget() {
    this.target = { x: 0, y: 0 };
  }

  setAwayTarget(x: number, y: number) {
    this.target = { x: clamp(x, -1, 1), y: clamp(y, -0.6, 0.6) };
  }

  update(now: number, dt: number, mode: "idle" | "listening" | "thinking" | "speaking" | "other"): EyeControllerState {
    if (this.nextBlinkAt === 0) this.reset(now);

    if (now >= this.saccadeUntil) {
      if (mode === "listening" || mode === "speaking") {
        this.target = {
          x: (Math.random() - 0.5) * 0.08,
          y: (Math.random() - 0.5) * 0.05,
        };
        this.saccadeUntil = now + 900 + Math.random() * 1400;
      } else if (mode === "thinking") {
        this.target = {
          x: (Math.random() - 0.5) * 0.35,
          y: 0.08 + Math.random() * 0.12,
        };
        this.saccadeUntil = now + 700 + Math.random() * 1600;
      } else {
        const lookAway = Math.random() < 0.16;
        this.target = lookAway
          ? { x: (Math.random() - 0.5) * 0.28, y: (Math.random() - 0.5) * 0.12 }
          : { x: 0, y: 0 };
        this.saccadeUntil = now + 1400 + Math.random() * 2600;
      }
    }

    const follow = 1 - Math.exp(-dt * 9);
    this.look.x += (this.target.x - this.look.x) * follow;
    this.look.y += (this.target.y - this.look.y) * follow;

    if (!this.blinking && now >= this.nextBlinkAt) {
      this.blinking = true;
      this.blinkStart = now;
      this.blinkDuration = 90 + Math.random() * 50;
      this.doubleBlink = Math.random() < 0.12;
    }

    let blink = 0;
    if (this.blinking) {
      const t = (now - this.blinkStart) / this.blinkDuration;
      if (t >= 1) {
        this.blinking = false;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.nextBlinkAt = now + 90 + Math.random() * 80;
        } else {
          this.nextBlinkAt = nextDelay(now, 3800, 2200);
        }
      } else {
        blink = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      }
    }

    this.blinkUntil = blink;
    return {
      look: { x: this.look.x, y: this.look.y },
      blinkLeft: blink,
      blinkRight: blink,
    };
  }

  toBlendshapes(state: EyeControllerState): Record<string, number> {
    const x = state.look.x;
    const y = state.look.y;
    return {
      eyeBlinkLeft: state.blinkLeft,
      eyeBlinkRight: state.blinkRight,
      eyeLookInLeft: Math.max(0, -x),
      eyeLookOutRight: Math.max(0, -x),
      eyeLookOutLeft: Math.max(0, x),
      eyeLookInRight: Math.max(0, x),
      eyeLookUpLeft: Math.max(0, y),
      eyeLookUpRight: Math.max(0, y),
      eyeLookDownLeft: Math.max(0, -y),
      eyeLookDownRight: Math.max(0, -y),
    };
  }

  toEyeBoneRotation(state: EyeControllerState): NovaVec3 {
    return {
      x: state.look.y * 0.18,
      y: -state.look.x * 0.22,
      z: 0,
    };
  }
}
