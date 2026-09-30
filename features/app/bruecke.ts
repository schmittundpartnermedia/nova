"use client";

import { useEffect, useState } from "react";

/**
 * Brücke zu NOVA.app (macOS-Launcher): Die App setzt window.__novaApp und meldet Änderungen mit „nova-app“;
 * die Seite schickt Wünsche über webkit.messageHandlers.nova. Im normalen Browser gibt es beides nicht –
 * dann folgt die Ansicht nur der Fensterbreite.
 */

export type AppZustand = {
  modus: "ecke" | "chat";
  taste: string;
  tasteUeberall: boolean;
};

type AppFenster = Window & {
  __novaApp?: AppZustand;
  webkit?: { messageHandlers?: { nova?: { postMessage: (nachricht: unknown) => void } } };
};

export function useNovaApp(): AppZustand | null {
  const [zustand, setZustand] = useState<AppZustand | null>(null);
  useEffect(() => {
    const lies = () => setZustand((window as AppFenster).__novaApp ?? null);
    lies();
    window.addEventListener("nova-app", lies);
    return () => window.removeEventListener("nova-app", lies);
  }, []);
  return zustand;
}

export function anApp(nachricht: { art: "modus"; modus: "ecke" | "chat" } | { art: "einstellungen" }): void {
  (window as AppFenster).webkit?.messageHandlers?.nova?.postMessage(nachricht);
}

/** Schmales Fenster = Ecke (nur Orb, Statuszeile, Knöpfe). */
export function useSchmal(grenze = 560): boolean {
  const [schmal, setSchmal] = useState(false);
  useEffect(() => {
    const abfrage = window.matchMedia(`(max-width: ${grenze - 1}px)`);
    const lies = () => setSchmal(abfrage.matches);
    lies();
    abfrage.addEventListener("change", lies);
    return () => abfrage.removeEventListener("change", lies);
  }, [grenze]);
  return schmal;
}
