"use client";

export type AvatarMotionFrame = {
  headX: number;
  headY: number;
  headRot: number;
  gazeX: number;
  gazeY: number;
};

export type AvatarMotionListener = (frame: AvatarMotionFrame) => void;

const REST: AvatarMotionFrame = {
  headX: 0,
  headY: 0,
  headRot: 0,
  gazeX: 0,
  gazeY: 0,
};

export class AvatarMotionController {
  private raf = 0;
  private running = false;
  private startedAt = 0;
  private gazeUntil = 0;
  private gaze: { x: number; y: number } = { x: 0, y: 0 };
  private listener: AvatarMotionListener | null = null;

  setListener(listener: AvatarMotionListener | null) {
    this.listener = listener;
  }

  start() {
    this.stop();
    this.running = true;
    this.startedAt = performance.now();
    this.gazeUntil = this.startedAt + 1800;
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.listener?.(REST);
  }

  private tick = () => {
    if (!this.running) return;
    const now = performance.now();
    const t = (now - this.startedAt) / 1000;

    if (now >= this.gazeUntil) {
      const lookAway = Math.random() < 0.18;
      this.gaze = lookAway
        ? { x: (Math.random() - 0.5) * 0.9, y: (Math.random() - 0.5) * 0.5 }
        : { x: 0, y: 0 };
      this.gazeUntil = now + 1600 + Math.random() * 2800;
    }

    const headX = Math.sin(t * 0.35) * 1.6 + Math.sin(t * 0.11) * 0.5;
    const headY = Math.sin(t * 0.27 + 0.6) * 1.2;
    const headRot = Math.sin(t * 0.19) * 0.55 + Math.sin(t * 0.07) * 0.2;

    this.listener?.({
      headX,
      headY,
      headRot,
      gazeX: this.gaze.x,
      gazeY: this.gaze.y,
    });
    this.raf = requestAnimationFrame(this.tick);
  };
}
