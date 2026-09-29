"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechPlaybackController } from "@/features/voice/speech-playback";
import { useVoiceEnabled } from "@/features/voice/settings";

export type AfterSpeech = "idle" | "listen" | "done";

export function useNovaVoice() {
  const { enabled, toggle, set } = useVoiceEnabled();
  const controllerRef = useRef<SpeechPlaybackController | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [unavailableHint, setUnavailableHint] = useState<string | null>(null);
  const speakingRef = useRef(false);
  const afterRef = useRef<AfterSpeech>("done");
  const onAfterRef = useRef<(next: AfterSpeech) => void>(() => undefined);

  const stop = useCallback((after: AfterSpeech = "idle") => {
    afterRef.current = after;
    controllerRef.current?.stop();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  useEffect(() => {
    const controller = new SpeechPlaybackController();
    controllerRef.current = controller;
    controller.setListener({
      onStart: () => {
        speakingRef.current = true;
        setSpeaking(true);
        setUnavailableHint(null);
      },
      onEnd: () => {
        speakingRef.current = false;
        setSpeaking(false);
        onAfterRef.current(afterRef.current);
      },
      onError: (message) => {
        speakingRef.current = false;
        setSpeaking(false);
        setUnavailableHint(message);
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
      controllerRef.current?.resetStream();
      controllerRef.current?.ingest(rawText, false);
    },
    [enabled],
  );

  const ingest = useCallback(
    (rawText: string) => {
      if (!enabled) return;
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

  return {
    enabled,
    toggleEnabled: toggle,
    setEnabled: set,
    speaking,
    unavailableHint,
    clearHint,
    beginTurn,
    ingest,
    flush,
    stop,
    setAfterSpeech,
  };
}
