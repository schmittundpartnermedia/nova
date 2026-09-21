"use client";

import { useEffect, useRef } from "react";
import { NovaParticles } from "@/components/nova/NovaParticles";

const SMOOTH = 0.09;

export function NovaVoiceAura({
  speaking,
  intensity,
}: {
  speaking: boolean;
  intensity: number;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ speaking, intensity });
  const currentRef = useRef(0);

  useEffect(() => {
    propsRef.current = { speaking, intensity };
  }, [speaking, intensity]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    let frame = 0;

    const tick = () => {
      const { speaking: isSpeaking, intensity: level } = propsRef.current;
      const target = isSpeaking ? Math.min(1, Math.max(0, level)) : 0;
      const next = currentRef.current + (target - currentRef.current) * SMOOTH;
      currentRef.current = next < 0.003 && target === 0 ? 0 : next;
      node.style.setProperty("--nova-aura", currentRef.current.toFixed(3));
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={nodeRef}
      className="nova-voice-aura"
      data-speaking={speaking ? "true" : "false"}
      style={{ ["--nova-aura" as string]: "0" }}
      aria-hidden="true"
    >
      <div className="nova-aura-halo" />
      <div className="nova-aura-core" />
      <div className="nova-aura-backlight" />
      <div className="nova-aura-floor" />
      <span className="nova-aura-pulse a" />
      <span className="nova-aura-pulse b" />
      <span className="nova-aura-pulse c" />
      <svg className="nova-aura-orbits" viewBox="0 0 800 800">
        <ellipse className="nova-aura-orbit a" cx="400" cy="358" rx="198" ry="238" />
        <ellipse className="nova-aura-orbit b" cx="400" cy="358" rx="236" ry="278" />
        <ellipse className="nova-aura-orbit c" cx="400" cy="358" rx="278" ry="322" />
      </svg>
      <NovaParticles />
    </div>
  );
}
