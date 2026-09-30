"use client";

import { useEffect, useRef } from "react";
import type { OrbState } from "@/types";

/**
 * NOVAs Orb: WebGL-Shader – fließendes Plasma in einer Kugel mit Leuchtrand, Glanzlicht, Halo und Orbit-Ring.
 * Farbe, Tempo und Energie folgen dem Zustand; beim Zuhören reagiert er auf die Mikrofon-Lautstärke.
 */

type Rgb = [number, number, number];
type Look = { a: Rgb; b: Rgb; c: Rgb; speed: number; energy: number };

const LOOKS: Record<OrbState, Look> = {
  IDLE: { a: [0.36, 0.3, 0.95], b: [0.3, 0.85, 1.0], c: [0.05, 0.03, 0.2], speed: 0.35, energy: 0.06 },
  LISTENING: { a: [0.2, 0.75, 1.0], b: [0.55, 1.0, 0.9], c: [0.02, 0.08, 0.25], speed: 0.7, energy: 0.18 },
  THINKING: { a: [0.6, 0.3, 1.0], b: [1.0, 0.4, 0.85], c: [0.08, 0.02, 0.2], speed: 1.25, energy: 0.35 },
  WORKING: { a: [0.25, 0.55, 1.0], b: [0.62, 0.42, 1.0], c: [0.02, 0.04, 0.18], speed: 1.0, energy: 0.3 },
  SPEAKING: { a: [1.0, 0.35, 0.65], b: [1.0, 0.78, 0.45], c: [0.2, 0.03, 0.25], speed: 0.9, energy: 0.3 },
  WAITING_FOR_APPROVAL: { a: [1.0, 0.62, 0.22], b: [1.0, 0.9, 0.6], c: [0.2, 0.08, 0.02], speed: 0.5, energy: 0.16 },
  WAITING_FOR_REVIEW: { a: [1.0, 0.62, 0.22], b: [1.0, 0.9, 0.6], c: [0.2, 0.08, 0.02], speed: 0.5, energy: 0.16 },
  DONE: { a: [0.25, 0.95, 0.65], b: [0.7, 1.0, 0.9], c: [0.02, 0.15, 0.1], speed: 0.5, energy: 0.12 },
  ERROR: { a: [1.0, 0.25, 0.3], b: [1.0, 0.55, 0.45], c: [0.2, 0.02, 0.04], speed: 0.6, energy: 0.16 },
};

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uEnergy;

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
        mix(dot(hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)), dot(hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(dot(hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)), dot(hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
        mix(dot(hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)), dot(hash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);

  float radius = 0.29 + 0.01 * sin(t * 1.3) + 0.035 * uEnergy;
  float wobble = (0.010 * sin(ang * 3.0 + t * 1.7) + 0.008 * sin(ang * 5.0 - t * 2.3) + 0.006 * sin(ang * 7.0 + t * 3.1)) * (0.5 + uEnergy * 2.5);
  float edge = radius + wobble;
  float d = r / edge;

  vec3 haloTint = mix(uA, uB, 0.5 + 0.5 * sin(ang * 1.0 + t * 0.6));
  float halo = exp(-max(r - edge, 0.0) * 8.0) * (0.28 + 0.6 * uEnergy);
  vec3 col = haloTint * halo;

  if (d < 1.0) {
    float z = sqrt(1.0 - d * d);
    vec3 n = normalize(vec3(uv / edge, z));
    vec3 p = n * 1.55 + vec3(0.0, 0.0, t * 0.3);
    float f1 = fbm(p + vec3(t * 0.22, -t * 0.16, 0.0));
    float f2 = fbm(p * 1.7 + f1 * 1.6 + vec3(-t * 0.27, t * 0.12, t * 0.06));
    vec3 base = mix(uC, uA, smoothstep(-0.35, 0.45, f2));
    base = mix(base, uB, smoothstep(0.2, 0.85, f1 + f2 * 0.6));
    float fresnel = pow(1.0 - z, 2.4);
    vec3 rim = mix(uB, vec3(1.0), 0.35) * fresnel * 1.5;
    float spec = pow(max(dot(n, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 32.0) * 0.6;
    vec3 inner = base * (0.5 + 0.5 * z) + rim + spec;
    inner += uB * 0.22 * exp(-d * d * 3.0) * (0.5 + uEnergy);
    col = mix(col, inner, smoothstep(1.0, 0.975, d));
  }

  float ring = exp(-pow((r - edge * 1.3) * 70.0, 2.0)) * (0.12 + 0.5 * uEnergy);
  col += haloTint * ring;

  // Zum Rand der Zeichenfläche hin weich auf null, damit kein Viereck sichtbar wird.
  col *= smoothstep(0.5, 0.36, r);
  float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

function mischen(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shader(gl: WebGLRenderingContext, typ: number, quelle: string): WebGLShader | null {
  const s = gl.createShader(typ);
  if (!s) return null;
  gl.shaderSource(s, quelle);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Orb-Shader:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function Orb({ state, level = null }: { state: OrbState; level?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef<number | null>(level);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return;

    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Orb-Programm:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(program, "uRes"),
      time: gl.getUniformLocation(program, "uTime"),
      a: gl.getUniformLocation(program, "uA"),
      b: gl.getUniformLocation(program, "uB"),
      c: gl.getUniformLocation(program, "uC"),
      energy: gl.getUniformLocation(program, "uEnergy"),
    };

    const resize = () => {
      const size = Math.max(220, Math.min(520, Math.floor(window.innerWidth * 0.36)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const reduziert = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const aktuell: Look = { ...LOOKS[stateRef.current] };
    let phase = 0;
    let letzte = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - letzte) / 1000);
      letzte = now;
      const ziel = LOOKS[stateRef.current];
      const k = 1 - Math.exp(-dt * 3);
      aktuell.a = mischen(aktuell.a, ziel.a, k);
      aktuell.b = mischen(aktuell.b, ziel.b, k);
      aktuell.c = mischen(aktuell.c, ziel.c, k);
      aktuell.speed += (ziel.speed - aktuell.speed) * k;
      let zielEnergie = ziel.energy;
      if (stateRef.current === "LISTENING" && levelRef.current != null) zielEnergie += Math.min(1, levelRef.current * 2.2) * 0.6;
      if (stateRef.current === "SPEAKING") zielEnergie += 0.18 * (0.5 + 0.5 * Math.sin(now * 0.012)) + 0.1 * Math.sin(now * 0.031);
      aktuell.energy += (zielEnergie - aktuell.energy) * Math.min(1, dt * 8);
      phase += dt * aktuell.speed * (reduziert ? 0.3 : 1);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, phase);
      gl.uniform3fv(u.a, aktuell.a);
      gl.uniform3fv(u.b, aktuell.b);
      gl.uniform3fv(u.c, aktuell.c);
      gl.uniform1f(u.energy, Math.max(0, aktuell.energy));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <div className="nova-orb" data-orb-state={state} aria-label={`NOVA-Zustand ${state}`} role="img">
      <span className="nova-ax-label">{`NOVA-Zustand ${state}`}</span>
      <canvas ref={canvasRef} className="nova-orb-canvas" />
    </div>
  );
}
