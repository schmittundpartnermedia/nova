"use client";

import { useEffect, useRef } from "react";
import type { OrbState } from "@/types";

/**
 * NOVAs Orb: WebGL-Shader – fließendes Plasma in einer runden Kugel (schwarz-weiß) mit Leuchtrand, Glanzlicht und engem Schein.
 * Außerhalb der Kugel ist jeder Pixel durchsichtig, damit keine Zeichenfläche als Kasten sichtbar wird.
 * Helligkeit, Tempo und Energie folgen dem Zustand; beim Zuhören reagiert er auf die Mikrofon-Lautstärke.
 */

type Rgb = [number, number, number];
type Look = { a: Rgb; b: Rgb; c: Rgb; speed: number; energy: number };

const LOOKS: Record<OrbState, Look> = {
  IDLE: { a: [0.55, 0.55, 0.57], b: [1.0, 1.0, 1.0], c: [0.04, 0.04, 0.05], speed: 0.35, energy: 0.06 },
  LISTENING: { a: [0.7, 0.7, 0.72], b: [1.0, 1.0, 1.0], c: [0.06, 0.06, 0.07], speed: 0.7, energy: 0.2 },
  THINKING: { a: [0.5, 0.5, 0.52], b: [0.95, 0.95, 0.97], c: [0.03, 0.03, 0.04], speed: 1.25, energy: 0.32 },
  WORKING: { a: [0.6, 0.6, 0.62], b: [1.0, 1.0, 1.0], c: [0.04, 0.04, 0.05], speed: 1.0, energy: 0.28 },
  SPEAKING: { a: [0.75, 0.75, 0.77], b: [1.0, 1.0, 1.0], c: [0.07, 0.07, 0.08], speed: 0.9, energy: 0.3 },
  WAITING_FOR_APPROVAL: { a: [0.62, 0.62, 0.64], b: [1.0, 1.0, 1.0], c: [0.05, 0.05, 0.06], speed: 0.5, energy: 0.16 },
  WAITING_FOR_REVIEW: { a: [0.62, 0.62, 0.64], b: [1.0, 1.0, 1.0], c: [0.05, 0.05, 0.06], speed: 0.5, energy: 0.16 },
  DONE: { a: [0.65, 0.65, 0.67], b: [1.0, 1.0, 1.0], c: [0.05, 0.05, 0.06], speed: 0.5, energy: 0.12 },
  ERROR: { a: [0.35, 0.35, 0.36], b: [0.8, 0.8, 0.82], c: [0.02, 0.02, 0.02], speed: 0.6, energy: 0.14 },
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

float stern(vec2 p, float dichte) {
  vec2 zelle = floor(p * dichte);
  vec2 lokal = fract(p * dichte) - 0.5;
  float h = fract(sin(dot(zelle, vec2(12.9898, 78.233))) * 43758.5453);
  if (h < 0.965) return 0.0;
  return smoothstep(0.18, 0.0, length(lokal)) * (h - 0.965) * 28.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;
  float r = length(uv);

  // Runde Kugel, atmet nur leicht.
  float edge = 0.3 + 0.006 * sin(t * 1.3) + 0.018 * uEnergy;
  float d = r / edge;

  // Leuchtender Saum direkt an der Kugel; ab 1,3 × Radius exakt nichts.
  float glow = exp(-max(r - edge, 0.0) * 30.0) * (0.55 + 0.4 * uEnergy);
  glow *= 1.0 - smoothstep(edge * 1.12, edge * 1.3, r);
  vec3 col = uB * glow;

  if (d < 1.0) {
    float z = sqrt(1.0 - d * d);
    vec3 n = normalize(vec3(uv / edge, z));
    vec3 p = n * 0.95 + vec3(0.0, 0.0, t * 0.2);
    float f1 = fbm(p + vec3(t * 0.15, -t * 0.1, 0.0));
    float f2 = fbm(p * 1.3 + f1 * 2.2 + vec3(-t * 0.18, t * 0.08, t * 0.04));
    // Weicher Rauch: großflächige helle Wolken auf dunklem Grund, dazu wenige zarte Fäden.
    float rauch = smoothstep(-0.05, 0.6, f2 + 0.4 * f1);
    float faeden = pow(max(0.0, 1.0 - abs(f2 - 0.1) * 5.0), 3.0) * 0.28;
    vec3 inner = mix(uC, uA * 1.05, rauch * 0.9) + uB * faeden * (0.8 + uEnergy);
    inner *= 0.55 + 0.45 * z;
    // Überlagerte Blase unten links, nur als feiner Rand.
    vec2 blase = uv / edge - vec2(-0.42, -0.28);
    float blasenRand = exp(-pow((length(blase) - 0.42) * 55.0, 2.0)) * 0.16;
    inner += uB * blasenRand;
    // Feine Sterne im Inneren.
    inner += uB * stern(uv / edge + vec2(t * 0.01, 0.0), 26.0) * (0.35 + 0.3 * z);
    // Heller Rand und Glanzlicht oben links.
    float fresnel = pow(1.0 - z, 3.0);
    inner += uB * fresnel * 1.8;
    inner += uB * pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 22.0) * 0.9;
    float innen = smoothstep(1.0, 0.985, d);
    float glowAlpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    vec3 glowFarbe = glowAlpha > 0.002 ? col / glowAlpha : vec3(0.0);
    gl_FragColor = vec4(mix(glowFarbe, min(inner, vec3(1.0)), innen), mix(glowAlpha, 1.0, innen));
    return;
  }

  float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  // Straight alpha: Farbe unabhängig von der Deckkraft, damit kein Hof entsteht.
  gl_FragColor = alpha > 0.002 ? vec4(col / alpha, alpha) : vec4(0.0);
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
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
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
      const size = Math.max(260, Math.min(560, Math.floor(window.innerWidth * 0.38)));
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
      <svg className="nova-orb-bahnen" viewBox="-100 -100 200 200" aria-hidden="true">
        <g className="nova-orb-bahn a">
          <ellipse cx="0" cy="0" rx="92" ry="80" transform="rotate(-18)" />
          <circle cx="-62" cy="-62" r="1.6" className="punkt" />
        </g>
        <g className="nova-orb-bahn b">
          <ellipse cx="0" cy="0" rx="80" ry="84" transform="rotate(12)" className="gepunktet" />
          <circle cx="58" cy="58" r="1.3" className="punkt" />
        </g>
        <g className="nova-orb-bahn c">
          <ellipse cx="0" cy="0" rx="98" ry="70" transform="rotate(28)" />
          <circle cx="92" cy="12" r="1.4" className="punkt" />
        </g>
      </svg>
    </div>
  );
}
