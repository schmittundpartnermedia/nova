"use client";

import { useEffect, useRef, useState } from "react";

const TEST_LINE = "Hallo Joachim. Ich bin NOVA. Was kann ich für dich tun?";
const SHAPE_LINE = "Papa, Mama, Berlin, Frankfurt, Otto, Universität.";
const FALLBACK_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

type SpeechMeta = {
  ok: boolean;
  voice: string;
  speed: number;
  voices: string[];
  message: string;
};

export function VoiceLab() {
  const [meta, setMeta] = useState<SpeechMeta | null>(null);
  const [voice, setVoice] = useState("marin");
  const [speed, setSpeed] = useState(1.2);
  const [text, setText] = useState(TEST_LINE);
  const [status, setStatus] = useState("Bereit.");
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/nova/speech")
      .then((response) => response.json() as Promise<SpeechMeta>)
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        if (data.voice) setVoice(data.voice);
        if (Number.isFinite(data.speed)) setSpeed(data.speed);
      })
      .catch(() => {
        if (!cancelled) setStatus("Voice-API nicht erreichbar.");
      });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function speak(nextText = text) {
    setBusy(true);
    setStatus(`Synthese (${voice}, ${speed.toFixed(2)}x)…`);
    audioRef.current?.pause();
    try {
      const response = await fetch("/api/nova/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nextText, voice, speed }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus(data?.error || "Sprachausgabe momentan nicht verfügbar.");
        return;
      }
      const usedVoice = response.headers.get("X-Nova-Voice-Name") ?? voice;
      const usedSpeed = response.headers.get("X-Nova-Voice-Speed") ?? String(speed);
      const bytes = await response.arrayBuffer();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      objectUrlRef.current = url;
      const audio = audioRef.current;
      if (!audio) {
        setStatus("Audio-Element fehlt.");
        return;
      }
      audio.src = url;
      await audio.play();
      setStatus(`Spielt ${usedVoice} @ ${usedSpeed}x`);
    } catch {
      setStatus("Sprachausgabe momentan nicht verfügbar.");
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setStatus("Gestoppt.");
  }

  return (
    <main className="nova-voice-lab">
      <h1>NOVA Voice Lab</h1>
      <p>Nur in Development. Kein Bestandteil der normalen Oberfläche.</p>
      <p>
        Server-Default: {meta?.voice ?? "…"} @ {meta?.speed ?? "…"}x
      </p>
      <label>
        Stimme
        <select value={voice} onChange={(event) => setVoice(event.target.value)}>
          {(meta?.voices ?? FALLBACK_VOICES).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Geschwindigkeit {speed.toFixed(2)}x
        <input
          type="range"
          min={0.85}
          max={1.5}
          step={0.05}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
      </label>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} />
      <div className="nova-voice-lab-actions">
        <button type="button" disabled={busy} onClick={() => void speak()}>
          Sprechen
        </button>
        <button type="button" disabled={busy} onClick={() => void speak(TEST_LINE)}>
          Testsatz
        </button>
        <button type="button" disabled={busy} onClick={() => void speak(SHAPE_LINE)}>
          Viseme-Satz
        </button>
        <button type="button" onClick={stop}>
          Stop
        </button>
      </div>
      <p className="nova-voice-lab-status">{status}</p>
      <audio ref={audioRef} hidden />
    </main>
  );
}
