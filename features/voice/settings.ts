"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "nova.voice.enabled";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("nova-voice-enabled", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("nova-voice-enabled", onStoreChange);
  };
}

function snapshot(): boolean {
  try {
    const value = window.localStorage.getItem(KEY);
    return value !== "0";
  } catch {
    return true;
  }
}

function setEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(KEY, enabled ? "1" : "0");
    window.dispatchEvent(new Event("nova-voice-enabled"));
  } catch {
    // ignore quota / private mode
  }
}

export function useVoiceEnabled() {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => true);
  const toggle = useCallback(() => {
    setEnabled(!snapshot());
  }, []);
  const set = useCallback((value: boolean) => {
    setEnabled(value);
  }, []);
  return { enabled, toggle, set };
}
