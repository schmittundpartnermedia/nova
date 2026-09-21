"use client";

import { useEffect, useRef, useState } from "react";
import { DigitalHumanRuntime } from "@/features/avatar/runtime";
import { visemeToBlendshapes } from "@/features/avatar/viseme-map";
import { emptyIdentityCompare, IDENTITY_COMPARE_POINTS, REFERENCE_IMAGE_URL } from "@/features/avatar/visual-compare";
import type { OrbState } from "@/types";
import type { NovaAvatarEmotion } from "@/types/avatar";
import type { SpeechViseme } from "@/types/voice";

const STATES: OrbState[] = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "WORKING",
  "SPEAKING",
  "WAITING_FOR_APPROVAL",
  "DONE",
  "ERROR",
];

const EMOTIONS: NovaAvatarEmotion[] = ["neutral", "warm", "positive", "focused", "concerned", "confident"];

const VISEME_SEQUENCE: SpeechViseme[] = ["M_B_P", "A", "E", "I", "O", "U", "F_V", "L", "S_Z", "SH_CH", "R", "W_Q"];

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label} {value.toFixed(2)}
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function AvatarLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<DigitalHumanRuntime | null>(null);
  const [status, setStatus] = useState("lädt");
  const [state, setState] = useState<OrbState>("IDLE");
  const [emotion, setEmotion] = useState<NovaAvatarEmotion>("neutral");
  const [jaw, setJaw] = useState(0);
  const [blinkLeft, setBlinkLeft] = useState(0);
  const [blinkRight, setBlinkRight] = useState(0);
  const [eyeLookX, setEyeLookX] = useState(0.5);
  const [eyeLookY, setEyeLookY] = useState(0.5);
  const [smile, setSmile] = useState(0);
  const [frown, setFrown] = useState(0);
  const [brow, setBrow] = useState(0);
  const [funnel, setFunnel] = useState(0);
  const [pucker, setPucker] = useState(0);
  const [headYaw, setHeadYaw] = useState(0.5);
  const [headPitch, setHeadPitch] = useState(0.5);
  const [lighting, setLighting] = useState<"portrait" | "flat">("portrait");
  const [camera, setCamera] = useState<"portrait" | "wide">("portrait");
  const [snapshot, setSnapshot] = useState("");
  const [capture, setCapture] = useState("");
  const [compare, setCompare] = useState(emptyIdentityCompare());
  const [visemeLabel, setVisemeLabel] = useState("—");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new DigitalHumanRuntime(canvas, { forceDevelopmentRig: true });
    runtimeRef.current = runtime;
    const unsub = runtime.subscribe(() => setStatus(runtime.getStatus()));
    void runtime.initialize().then(() => runtime.loadRig());
    return () => {
      unsub();
      runtime.dispose();
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setState(state, state === "SPEAKING", jaw, emotion);
  }, [state, jaw, emotion]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.debugSetBlendshape("jawOpen", jaw);
    runtime.debugSetBlendshape("eyeBlinkLeft", blinkLeft);
    runtime.debugSetBlendshape("eyeBlinkRight", blinkRight);
    runtime.debugSetBlendshape("mouthSmileLeft", smile);
    runtime.debugSetBlendshape("mouthSmileRight", smile);
    runtime.debugSetBlendshape("mouthFrownLeft", frown);
    runtime.debugSetBlendshape("mouthFrownRight", frown);
    runtime.debugSetBlendshape("browInnerUp", brow);
    runtime.debugSetBlendshape("mouthFunnel", funnel);
    runtime.debugSetBlendshape("mouthPucker", pucker);
    const lookX = eyeLookX * 2 - 1;
    const lookY = eyeLookY * 2 - 1;
    runtime.debugSetBlendshape("eyeLookOutLeft", Math.max(0, -lookX));
    runtime.debugSetBlendshape("eyeLookInLeft", Math.max(0, lookX));
    runtime.debugSetBlendshape("eyeLookOutRight", Math.max(0, lookX));
    runtime.debugSetBlendshape("eyeLookInRight", Math.max(0, -lookX));
    runtime.debugSetBlendshape("eyeLookUpLeft", Math.max(0, lookY));
    runtime.debugSetBlendshape("eyeLookUpRight", Math.max(0, lookY));
    runtime.debugSetBlendshape("eyeLookDownLeft", Math.max(0, -lookY));
    runtime.debugSetBlendshape("eyeLookDownRight", Math.max(0, -lookY));
    runtime.debugSetHeadPose({
      x: (headPitch - 0.5) * 0.35,
      y: (headYaw - 0.5) * 0.5,
      z: 0,
    });
  }, [jaw, blinkLeft, blinkRight, smile, frown, brow, funnel, pucker, eyeLookX, eyeLookY, headYaw, headPitch]);

  useEffect(() => {
    runtimeRef.current?.setLightingPreset(lighting);
  }, [lighting]);

  useEffect(() => {
    runtimeRef.current?.setCameraPreset(camera);
  }, [camera]);

  const runVisemes = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    let index = 0;
    const tick = () => {
      const viseme = VISEME_SEQUENCE[index];
      if (!viseme) {
        setVisemeLabel("REST");
        runtime.engine.resetFace();
        return;
      }
      setVisemeLabel(viseme);
      runtime.engine.resetFace();
      runtime.engine.setBlendshapes(visemeToBlendshapes(viseme, 1));
      index += 1;
      window.setTimeout(tick, 320);
    };
    tick();
  };

  return (
    <main className="nova-voice-lab nova-avatar-lab">
      <h1>NOVA Avatar Lab</h1>
      <p>Development-Labor. Die weiße Figur ist die DEVELOPMENT RIG, nicht NOVA. Das Referenzbild dient nur dem Identitätsvergleich.</p>
      <p>Status: {status}</p>
      <div className="nova-avatar-lab-stage">
        <div className="nova-avatar-stage" style={{ height: 480, width: "100%" }}>
          <canvas ref={canvasRef} className="nova-digital-human-canvas" style={{ width: "100%", height: 480 }} />
        </div>
        <figure className="nova-identity-compare">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={REFERENCE_IMAGE_URL} alt="NOVA Identitätsreferenz, nicht das Runtime-Gesicht" />
          <figcaption>Referenz – nicht das gerenderte Gesicht</figcaption>
        </figure>
      </div>
      <div className="nova-avatar-lab-grid">
        <label>
          Zustand
          <select value={state} onChange={(event) => setState(event.target.value as OrbState)}>
            {STATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Emotion
          <select value={emotion} onChange={(event) => setEmotion(event.target.value as NovaAvatarEmotion)}>
            {EMOTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lighting
          <select value={lighting} onChange={(event) => setLighting(event.target.value as "portrait" | "flat")}>
            <option value="portrait">portrait</option>
            <option value="flat">flat debug</option>
          </select>
        </label>
        <label>
          Camera
          <select value={camera} onChange={(event) => setCamera(event.target.value as "portrait" | "wide")}>
            <option value="portrait">portrait</option>
            <option value="wide">wide</option>
          </select>
        </label>
      </div>
      <Slider label="jawOpen" value={jaw} onChange={setJaw} />
      <Slider label="blinkLeft" value={blinkLeft} onChange={setBlinkLeft} />
      <Slider label="blinkRight" value={blinkRight} onChange={setBlinkRight} />
      <Slider label="eyeLook X" value={eyeLookX} onChange={setEyeLookX} />
      <Slider label="eyeLook Y" value={eyeLookY} onChange={setEyeLookY} />
      <Slider label="smile" value={smile} onChange={setSmile} />
      <Slider label="frown" value={frown} onChange={setFrown} />
      <Slider label="brow" value={brow} onChange={setBrow} />
      <Slider label="mouthFunnel" value={funnel} onChange={setFunnel} />
      <Slider label="mouthPucker" value={pucker} onChange={setPucker} />
      <Slider label="head yaw" value={headYaw} onChange={setHeadYaw} />
      <Slider label="head pitch" value={headPitch} onChange={setHeadPitch} />
      <div className="nova-voice-lab-actions">
        <button type="button" onClick={runVisemes}>
          Viseme-Sequenz {visemeLabel}
        </button>
        <button type="button" onClick={() => setSnapshot(JSON.stringify(runtimeRef.current?.getDebugSnapshot(), null, 2))}>
          Snapshot
        </button>
        <button type="button" onClick={() => setCapture(runtimeRef.current?.capturePng() ?? "")}>
          Capture 3D View
        </button>
      </div>
      {capture ? (
        <figure className="nova-identity-compare">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capture} alt="Aktuelle 3D-Ansicht, kein Identitätsbeweis" />
          <figcaption>3D Capture – manueller Vergleich, keine automatische Identität</figcaption>
        </figure>
      ) : null}
      <section>
        <h2>Visual identity review</h2>
        <p>Keine automatische „identisch“-Aussage. Nur manuelle Prüfung gegen die Referenz.</p>
        {IDENTITY_COMPARE_POINTS.map((point) => (
          <label key={point.id}>
            {point.label}
            <select
              value={compare[point.id]}
              onChange={(event) =>
                setCompare((current) => ({
                  ...current,
                  [point.id]: event.target.value as (typeof current)[typeof point.id],
                }))
              }
            >
              <option value="unreviewed">unreviewed</option>
              <option value="match">match</option>
              <option value="mismatch">mismatch</option>
            </select>
          </label>
        ))}
      </section>
      <pre className="nova-voice-lab-status">{snapshot}</pre>
    </main>
  );
}
