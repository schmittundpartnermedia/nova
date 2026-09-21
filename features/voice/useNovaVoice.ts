"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovaAvatarPerformance, NovaEmotion, NovaGazeTarget } from "@/components/nova/avatar-performance";
import { SpeechPlaybackController } from "@/features/voice/speech-playback";
import { useVoiceEnabled } from "@/features/voice/settings";
import { inferSpeechEmotion } from "@/services/voice/emotion";
import type { SpeechViseme } from "@/types/voice";

export type AfterSpeech = "idle" | "listen" | "done";

const REST_PERFORMANCE: NovaAvatarPerformance = {
  isSpeaking: false,
  speechIntensity: 0,
  viseme: "REST",
  emotion: "neutral",
  gazeTarget: "user",
};

export function useNovaVoice() {
  const { enabled, toggle, set } = useVoiceEnabled();
  const controllerRef = useRef<SpeechPlaybackController | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [unavailableHint, setUnavailableHint] = useState<string | null>(null);
  const [performance, setPerformance] = useState<NovaAvatarPerformance>(REST_PERFORMANCE);
  const emotionRef = useRef<NovaEmotion>("neutral");
  const speakingRef = useRef(false);
  const afterRef = useRef<AfterSpeech>("done");
  const onAfterRef = useRef<(next: AfterSpeech) => void>(() => undefined);
  const stageRef = useRef<HTMLElement | null>(null);

  const applyMotion = useCallback((headX: number, headY: number, headRot: number, gazeX: number, gazeY: number) => {
    const node = stageRef.current;
    if (!node) return;
    node.style.setProperty("--nova-head-x", `${headX.toFixed(2)}px`);
    node.style.setProperty("--nova-head-y", `${headY.toFixed(2)}px`);
    node.style.setProperty("--nova-head-rot", `${headRot.toFixed(2)}deg`);
    node.style.setProperty("--nova-gaze-x", `${gazeX.toFixed(2)}%`);
    node.style.setProperty("--nova-gaze-y", `${gazeY.toFixed(2)}%`);
    const gazeTarget: NovaGazeTarget = Math.abs(gazeX) + Math.abs(gazeY) > 0.35 ? "away" : "user";
    node.dataset.gaze = gazeTarget;
  }, []);

  const stop = useCallback((after: AfterSpeech = "idle") => {
    afterRef.current = after;
    controllerRef.current?.stop();
    speakingRef.current = false;
    setSpeaking(false);
    setPerformance(REST_PERFORMANCE);
    applyMotion(0, 0, 0, 0, 0);
  }, [applyMotion]);

  useEffect(() => {
    const controller = new SpeechPlaybackController();
    controllerRef.current = controller;
    controller.setListener({
      onStart: () => {
        speakingRef.current = true;
        setSpeaking(true);
        setUnavailableHint(null);
        setPerformance((current) => ({
          ...current,
          isSpeaking: true,
          emotion: emotionRef.current,
          gazeTarget: "user",
        }));
      },
      onEnd: () => {
        speakingRef.current = false;
        setSpeaking(false);
        setPerformance(REST_PERFORMANCE);
        applyMotion(0, 0, 0, 0, 0);
        onAfterRef.current(afterRef.current);
      },
      onLipSync: (frame) => {
        const node = stageRef.current;
        if (node) {
          node.style.setProperty("--nova-speech-intensity", frame.intensity.toFixed(3));
          node.dataset.viseme = frame.viseme;
          node.dataset.speaking = "true";
        }
        setPerformance((current) => {
          if (current.viseme === frame.viseme && Math.abs(current.speechIntensity - frame.intensity) < 0.04) {
            return current;
          }
          return {
            ...current,
            isSpeaking: true,
            viseme: frame.viseme as NovaAvatarPerformance["viseme"],
            speechIntensity: frame.intensity,
            emotion: emotionRef.current,
          };
        });
      },
      onMotion: (frame) => {
        applyMotion(frame.headX, frame.headY, frame.headRot, frame.gazeX, frame.gazeY);
      },
      onError: (message) => {
        speakingRef.current = false;
        setSpeaking(false);
        setPerformance(REST_PERFORMANCE);
        setUnavailableHint(message);
        applyMotion(0, 0, 0, 0, 0);
        onAfterRef.current(afterRef.current);
      },
    });
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [applyMotion]);

  useEffect(() => {
    if (!enabled && speakingRef.current) {
      stop("idle");
    }
  }, [enabled, stop]);

  const beginTurn = useCallback(
    (rawText: string, after: AfterSpeech = "done") => {
      if (!enabled) return;
      afterRef.current = after;
      emotionRef.current = inferSpeechEmotion(rawText) ?? "neutral";
      controllerRef.current?.resetStream();
      controllerRef.current?.ingest(rawText, false);
    },
    [enabled],
  );

  const ingest = useCallback(
    (rawText: string) => {
      if (!enabled) return;
      if (emotionRef.current === "neutral") {
        emotionRef.current = inferSpeechEmotion(rawText) ?? "neutral";
      }
      controllerRef.current?.ingest(rawText, false);
    },
    [enabled],
  );

  const flush = useCallback(
    (rawText?: string) => {
      if (!enabled) {
        onAfterRef.current(afterRef.current);
        return;
      }
      if (rawText) {
        if (emotionRef.current === "neutral") {
          emotionRef.current = inferSpeechEmotion(rawText) ?? "neutral";
        }
        controllerRef.current?.ingest(rawText, true);
        return;
      }
      controllerRef.current?.flush();
    },
    [enabled],
  );

  const setAfterSpeech = useCallback((handler: (next: AfterSpeech) => void) => {
    onAfterRef.current = handler;
  }, []);

  const clearHint = useCallback(() => setUnavailableHint(null), []);

  const bindStage = useCallback((node: HTMLElement | null) => {
    stageRef.current = node;
  }, []);

  const livePerformance = useMemo<NovaAvatarPerformance>(
    () => (speaking ? performance : REST_PERFORMANCE),
    [speaking, performance],
  );

  return {
    enabled,
    toggleEnabled: toggle,
    setEnabled: set,
    speaking,
    unavailableHint,
    clearHint,
    performance: livePerformance,
    viseme: (livePerformance.viseme ?? "REST") as SpeechViseme,
    beginTurn,
    ingest,
    flush,
    stop,
    setAfterSpeech,
    bindStage,
  };
}
