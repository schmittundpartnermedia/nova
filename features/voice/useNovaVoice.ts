"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovaAvatarPerformance, NovaAvatarEmotion } from "@/components/nova/avatar-performance";
import { SpeechPlaybackController } from "@/features/voice/speech-playback";
import { useVoiceEnabled } from "@/features/voice/settings";
import { inferSpeechEmotion } from "@/services/voice/emotion";
import type { NovaFacialFrame } from "@/types/avatar";
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
  const emotionRef = useRef<NovaAvatarEmotion>("neutral");
  const speakingRef = useRef(false);
  const afterRef = useRef<AfterSpeech>("done");
  const onAfterRef = useRef<(next: AfterSpeech) => void>(() => undefined);
  const facialSinkRef = useRef<(frame: NovaFacialFrame | null) => void>(() => undefined);
  const lastEnergyLog = useRef(0);

  const stop = useCallback((after: AfterSpeech = "idle") => {
    afterRef.current = after;
    controllerRef.current?.stop();
    speakingRef.current = false;
    setSpeaking(false);
    setPerformance(REST_PERFORMANCE);
    facialSinkRef.current(null);
  }, []);

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
        facialSinkRef.current(null);
        onAfterRef.current(afterRef.current);
      },
      onFacialFrame: (frame) => {
        facialSinkRef.current(frame);
      },
      onEnergy: (energy) => {
        if (process.env.NODE_ENV === "development") {
          const now = globalThis.performance.now();
          if (now - lastEnergyLog.current > 280) {
            lastEnergyLog.current = now;
            console.debug("[nova-avatar]", {
              isSpeaking: true,
              speechIntensity: Number(energy.intensity.toFixed(3)),
              viseme: energy.viseme,
            });
          }
        }
        setPerformance((current) => {
          if (current.viseme === energy.viseme && Math.abs(current.speechIntensity - energy.intensity) < 0.04) {
            return current;
          }
          return {
            ...current,
            isSpeaking: true,
            viseme: energy.viseme,
            speechIntensity: energy.intensity,
            emotion: emotionRef.current,
          };
        });
      },
      onError: (message) => {
        speakingRef.current = false;
        setSpeaking(false);
        setPerformance(REST_PERFORMANCE);
        setUnavailableHint(message);
        facialSinkRef.current(null);
        onAfterRef.current(afterRef.current);
      },
    });
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

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

  const bindFacialSink = useCallback((sink: ((frame: NovaFacialFrame | null) => void) | null) => {
    facialSinkRef.current = sink ?? (() => undefined);
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
    bindFacialSink,
  };
}
