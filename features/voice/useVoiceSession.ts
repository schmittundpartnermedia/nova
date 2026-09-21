"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VoiceSessionController } from "@/features/voice/session-controller";
import {
  IDLE_VOICE_SNAPSHOT,
  type VoiceSessionSnapshot,
  type VoiceTurn,
} from "@/features/voice/session-types";

export function useVoiceSession(onTurn: (turn: VoiceTurn) => void) {
  const controllerRef = useRef<VoiceSessionController | null>(null);
  const onTurnRef = useRef(onTurn);
  const interruptRef = useRef<() => void>(() => undefined);
  const browserSupported = useSyncExternalStore(
    () => () => undefined,
    () => {
      const g = globalThis as typeof globalThis & {
        SpeechRecognition?: unknown;
        webkitSpeechRecognition?: unknown;
        window?: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
      };
      return Boolean(
        g.SpeechRecognition ||
          g.webkitSpeechRecognition ||
          g.window?.SpeechRecognition ||
          g.window?.webkitSpeechRecognition,
      );
    },
    () => false,
  );
  const [snapshot, setSnapshot] = useState<VoiceSessionSnapshot>(IDLE_VOICE_SNAPSHOT);

  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  useEffect(() => {
    const controller = new VoiceSessionController();
    controllerRef.current = controller;
    controller.setListener({
      onSnapshot: (next) => setSnapshot(next),
      onTurn: (turn) => onTurnRef.current(turn),
      onInterruptNova: () => interruptRef.current(),
    });
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    void controllerRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    void controllerRef.current?.toggle();
  }, []);

  const notifyProcessing = useCallback(() => {
    controllerRef.current?.notifyProcessing();
  }, []);

  const notifyNovaSpeaking = useCallback(() => {
    controllerRef.current?.notifyNovaSpeaking();
  }, []);

  const notifyNovaIdle = useCallback(() => {
    controllerRef.current?.notifyNovaIdle();
  }, []);

  const fail = useCallback((message: string) => {
    controllerRef.current?.fail(message);
  }, []);

  const bindInterrupt = useCallback((handler: () => void) => {
    interruptRef.current = handler;
  }, []);

  const supported = snapshot.supported || browserSupported;

  return {
    snapshot: { ...snapshot, supported },
    supported,
    start,
    stop,
    toggle,
    notifyProcessing,
    notifyNovaSpeaking,
    notifyNovaIdle,
    fail,
    bindInterrupt,
  };
}
