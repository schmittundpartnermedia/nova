"use client";

import { useEffect, useRef } from "react";
import type { OrbState } from "@/types";

type Palette = {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  speed: number;
  amp: number;
  glow: number;
};

const PALETTES: Record<OrbState, Palette> = {
  IDLE: { a: [126, 168, 214], b: [214, 220, 232], c: [72, 90, 120], speed: 0.55, amp: 0.045, glow: 0.42 },
  LISTENING: { a: [120, 210, 214], b: [230, 245, 250], c: [40, 120, 130], speed: 1.15, amp: 0.08, glow: 0.58 },
  THINKING: { a: [150, 140, 210], b: [220, 214, 240], c: [70, 60, 120], speed: 0.7, amp: 0.06, glow: 0.5 },
  WORKING: { a: [110, 170, 230], b: [210, 230, 255], c: [40, 80, 140], speed: 1.35, amp: 0.09, glow: 0.62 },
  WAITING_FOR_APPROVAL: { a: [220, 176, 110], b: [250, 230, 190], c: [120, 80, 30], speed: 0.85, amp: 0.05, glow: 0.55 },
  DONE: { a: [150, 200, 160], b: [230, 245, 220], c: [50, 110, 70], speed: 0.9, amp: 0.04, glow: 0.5 },
  ERROR: { a: [190, 110, 110], b: [240, 210, 210], c: [90, 40, 40], speed: 0.95, amp: 0.07, glow: 0.45 },
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function Orb({ state }: { state: OrbState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const paletteRef = useRef<Palette>({ ...PALETTES[state] });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let raf = 0;

    const resize = () => {
      const size = Math.min(440, Math.floor(window.innerWidth * 0.42));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.style.background = "transparent";
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (time: number) => {
      const size = canvas.clientWidth;
      const currentTarget = PALETTES[stateRef.current];
      paletteRef.current = {
        a: lerpColor(paletteRef.current.a, currentTarget.a, 0.04),
        b: lerpColor(paletteRef.current.b, currentTarget.b, 0.04),
        c: lerpColor(paletteRef.current.c, currentTarget.c, 0.04),
        speed: lerp(paletteRef.current.speed, currentTarget.speed, 0.04),
        amp: lerp(paletteRef.current.amp, currentTarget.amp, 0.04),
        glow: lerp(paletteRef.current.glow, currentTarget.glow, 0.04),
      };
      const p = paletteRef.current;
      const t = time * 0.001 * p.speed;
      const breath = 1 + Math.sin(t * 1.15) * p.amp;
      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.2 * breath;

      ctx.clearRect(0, 0, size, size);

      const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.85);
      glow.addColorStop(0, `rgba(${p.a[0]}, ${p.a[1]}, ${p.a[2]}, ${p.glow})`);
      glow.addColorStop(0.38, `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, 0.14)`);
      glow.addColorStop(0.72, `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, 0.04)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
      const body = ctx.createRadialGradient(
        cx - radius * 0.25,
        cy - radius * 0.3,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      body.addColorStop(0, `rgba(${p.b[0]}, ${p.b[1]}, ${p.b[2]}, 0.95)`);
      body.addColorStop(0.45, `rgba(${p.a[0]}, ${p.a[1]}, ${p.a[2]}, 0.72)`);
      body.addColorStop(1, `rgba(${p.c[0]}, ${p.c[1]}, ${p.c[2]}, 0.35)`);
      ctx.fillStyle = body;
      ctx.fill();

      for (let i = 0; i < 3; i += 1) {
        const ox = Math.cos(t * (0.7 + i * 0.33) + i) * radius * 0.22;
        const oy = Math.sin(t * (0.9 + i * 0.21) + i * 1.7) * radius * 0.18;
        const blob = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, radius * 0.55);
        blob.addColorStop(0, `rgba(${p.b[0]}, ${p.b[1]}, ${p.b[2]}, 0.28)`);
        blob.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, radius * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(cx - radius * 0.22, cy - radius * 0.28, radius * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.18 + Math.sin(t) * 0.05})`;
      ctx.fill();

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      void frame;
    };
  }, []);

  return (
    <div className="relative grid place-items-center" aria-hidden="true">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
