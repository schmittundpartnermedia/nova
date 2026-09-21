"use client";

import { useEffect, useRef, useState } from "react";
import { DigitalHumanRuntime } from "@/features/avatar/runtime";
import type { OrbState } from "@/types";

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

export function AvatarLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<DigitalHumanRuntime | null>(null);
  const [status, setStatus] = useState("lädt");
  const [state, setState] = useState<OrbState>("IDLE");
  const [jaw, setJaw] = useState(0);
  const [blink, setBlink] = useState(0);
  const [snapshot, setSnapshot] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = new DigitalHumanRuntime(canvas);
    runtimeRef.current = runtime;
    const unsub = runtime.subscribe(() => setStatus(runtime.getStatus()));
    void runtime.initialize().then(() => runtime.loadRig());
    return () => {
      unsub();
      runtime.dispose();
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setState(state, state === "SPEAKING", jaw, "neutral");
  }, [state, jaw]);

  useEffect(() => {
    runtimeRef.current?.debugSetBlendshape("jawOpen", jaw);
    runtimeRef.current?.debugSetBlendshape("eyeBlinkLeft", blink);
    runtimeRef.current?.debugSetBlendshape("eyeBlinkRight", blink);
  }, [jaw, blink]);

  return (
    <main className="nova-voice-lab">
      <h1>NOVA Avatar Lab</h1>
      <p>Nur Development. DEVELOPMENT RIG zum Prüfen von Morph Targets und Bones.</p>
      <p>Status: {status}</p>
      <div className="nova-avatar-stage" style={{ height: 480, width: "100%" }}>
        <canvas ref={canvasRef} className="nova-digital-human-canvas" style={{ width: "100%", height: 480 }} />
      </div>
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
        jawOpen {jaw.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={jaw} onChange={(event) => setJaw(Number(event.target.value))} />
      </label>
      <label>
        eyeBlink {blink.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={blink} onChange={(event) => setBlink(Number(event.target.value))} />
      </label>
      <button
        type="button"
        onClick={() => setSnapshot(JSON.stringify(runtimeRef.current?.getDebugSnapshot(), null, 2))}
      >
        Snapshot
      </button>
      <pre className="nova-voice-lab-status">{snapshot}</pre>
    </main>
  );
}
