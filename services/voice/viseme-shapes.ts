import type { SpeechViseme } from "@/types/voice";

export type VisemeShape = {
  width: number;
  height: number;
  radius: number;
  teeth: number;
  closed: boolean;
};

export const VISEME_SHAPES: Record<SpeechViseme, VisemeShape> = {
  REST: { width: 9.2, height: 0.35, radius: 50, teeth: 0, closed: true },
  M_B_P: { width: 8.6, height: 0.45, radius: 50, teeth: 0, closed: true },
  A: { width: 13.6, height: 5.8, radius: 42, teeth: 0.2, closed: false },
  E: { width: 14.8, height: 3.4, radius: 36, teeth: 0.12, closed: false },
  I: { width: 11.4, height: 2.6, radius: 38, teeth: 0.08, closed: false },
  O: { width: 8.4, height: 5.4, radius: 50, teeth: 0.05, closed: false },
  U: { width: 6.8, height: 4.2, radius: 50, teeth: 0, closed: false },
  W_Q: { width: 6.5, height: 3.8, radius: 50, teeth: 0, closed: false },
  F_V: { width: 13.0, height: 2.0, radius: 46, teeth: 0, closed: false },
  TH: { width: 12.2, height: 2.2, radius: 46, teeth: 0, closed: false },
  S_Z: { width: 12.0, height: 1.8, radius: 48, teeth: 0, closed: false },
  SH_CH: { width: 10.6, height: 2.4, radius: 46, teeth: 0, closed: false },
  L: { width: 11.2, height: 3.0, radius: 42, teeth: 0.08, closed: false },
  R: { width: 10.4, height: 2.8, radius: 44, teeth: 0, closed: false },
};

export function visemeGeometry(viseme: SpeechViseme, intensity: number) {
  const shape = VISEME_SHAPES[viseme] ?? VISEME_SHAPES.REST;
  const energy = Math.min(1, Math.max(0, intensity));
  if (shape.closed || energy < 0.04) {
    return {
      width: shape.width,
      height: 0.35,
      radius: shape.radius,
      teeth: 0,
      open: 0,
      jaw: 0,
    };
  }
  const open = 0.42 + energy * 0.58;
  return {
    width: shape.width * (0.88 + energy * 0.12),
    height: shape.height * open,
    radius: shape.radius,
    teeth: shape.teeth * open,
    open,
    jaw: 3.2 + energy * 7.5,
  };
}
