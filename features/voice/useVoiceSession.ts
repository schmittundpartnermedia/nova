"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isVoiceCaptureSupported } from "@/features/voice/capture";
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
    () => isVoiceCaptureSupported(),
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
    void fetch("/api/nova/transcribe", { method: "GET", cache: "no-store" }).catch(() => undefined);
    void fetch("/api/nova/speech", { method: "GET", cache: "no-store" }).catch(() => undefined);
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
