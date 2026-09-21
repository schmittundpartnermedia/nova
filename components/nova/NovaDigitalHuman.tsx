"use client";

import { useEffect, useRef, useState } from "react";
import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaFacialFrame } from "@/types/avatar";
import { DigitalHumanRuntime, type DigitalHumanStatus } from "@/features/avatar/runtime";

export function NovaDigitalHuman({
  state,
  isSpeaking,
  speechIntensity,
  emotion,
  onRuntime,
}: {
  state: OrbState;
  isSpeaking: boolean;
  speechIntensity: number;
  emotion: NovaAvatarEmotion;
  facialFrame?: NovaFacialFrame | null;
  onRuntime?: (runtime: DigitalHumanRuntime | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<DigitalHumanRuntime | null>(null);
  const onRuntimeRef = useRef(onRuntime);
  const [status, setStatus] = useState<DigitalHumanStatus>("loading");
  const [error, setError] = useState("");
  const [developmentRig, setDevelopmentRig] = useState(false);

  useEffect(() => {
    onRuntimeRef.current = onRuntime;
  }, [onRuntime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const runtime = new DigitalHumanRuntime(canvas);
    runtimeRef.current = runtime;
    const unsubscribe = runtime.subscribe(() => {
      setStatus(runtime.getStatus());
      setError(runtime.getError());
      setDevelopmentRig(Boolean(runtime.getRigInfo()?.isDevelopmentRig));
    });
    onRuntimeRef.current?.(runtime);
    void (async () => {
      try {
        await runtime.initialize();
        if (cancelled) return;
        await runtime.loadRig();
      } catch {
        // Status sits on the runtime.
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
      onRuntimeRef.current?.(null);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setState(state, isSpeaking, speechIntensity, emotion);
  }, [state, isSpeaking, speechIntensity, emotion]);

  return (
    <div className="nova-digital-human" data-status={status} data-renderer="three-webgl">
      <canvas ref={canvasRef} className="nova-digital-human-canvas" aria-hidden="true" />
      {status === "loading" ? <p className="nova-avatar-boot">NOVA wird initialisiert …</p> : null}
      {status === "error" ? (
        <p className="nova-avatar-error" role="alert">
          {error || "3D-Avatar konnte nicht geladen werden."}
        </p>
      ) : null}
      {status === "ready" && developmentRig ? <p className="nova-dev-rig-badge">DEVELOPMENT RIG</p> : null}
    </div>
  );
}
