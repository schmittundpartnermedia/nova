"use client";

import { useState } from "react";
import type { VoiceSessionState } from "@/features/voice/session-types";

const QUICK_ACTIONS = [
  { id: "research", label: "Recherchieren", prefix: "Recherchiere: " },
  { id: "task", label: "Aufgabe erstellen", prefix: "Erstelle eine Aufgabe: " },
  { id: "mail", label: "E-Mail schreiben", prefix: "Schreibe eine E-Mail: " },
  { id: "idea", label: "Idee", prefix: "Idee: " },
] as const;

export function NovaCommandBar({
  disabled,
  listening,
  speaking,
  voiceSupported,
  voiceEnabled,
  sessionActive = false,
  sessionState = "OFF",
  silenceRemainingMs = null,
  silenceTimeoutMs = 800,

  dictation = "",
  onSubmit,
  onMic,
  onStopSpeech,
  onToggleVoice,
  onDraftChange,
  onComposeStart,
}: {
  disabled: boolean;
  listening: boolean;
  speaking: boolean;
  voiceSupported: boolean;
  voiceEnabled: boolean;
  sessionActive?: boolean;
  sessionState?: VoiceSessionState;
  silenceRemainingMs?: number | null;
  silenceTimeoutMs?: number;
  dictation?: string;
  onSubmit: (value: string) => void;
  onMic: () => void;
  onStopSpeech: () => void;
  onToggleVoice: () => void;
  onDraftChange?: (value: string) => void;
  onComposeStart?: () => void;
}) {
  const [value, setValue] = useState("");
  const [preparedHint, setPreparedHint] = useState(false);
  const shown = sessionActive ? dictation : value;
  const silenceProgress =
    sessionState === "SILENCE_WAIT" && silenceRemainingMs != null
      ? Math.max(0, Math.min(1, silenceRemainingMs / silenceTimeoutMs))
      : 0;
  const micClass = [
    "nova-icon-btn",
    sessionActive ? "session-active" : listening ? "listening" : "",
    sessionState === "USER_SPEAKING" || sessionState === "INTERRUPTED" ? "user-speaking" : "",
    sessionState === "SILENCE_WAIT" ? "silence-wait" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form
      className="nova-command"
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim();
        if (!next || disabled) return;
        onSubmit(next);
        setValue("");
        setPreparedHint(false);
      }}
    >
      <input
        value={shown}
        onChange={(event) => {
          if (sessionActive) return;
          const next = event.target.value;
          setValue(next);
          onDraftChange?.(next);
        }}
        onFocus={() => onComposeStart?.()}
        disabled={disabled}
        readOnly={sessionActive}
        placeholder={
          sessionActive
            ? dictation
              ? ""
              : sessionState === "USER_SPEAKING"
                ? "Ich höre zu …"
                : "NOVA hört zu …"
            : speaking
              ? "NOVA spricht …"
              : "Was kann ich für dich tun?"
        }
        autoComplete="off"
      />
      <div className="nova-command-row">
        <button
          type="button"
          className="nova-icon-btn prepared"
          aria-label="Anhänge vorbereitet"
          title="Anhänge sind vorbereitet, noch nicht verfügbar."
          onClick={() => setPreparedHint(true)}
        >
          +
        </button>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className="nova-chip"
            onClick={() => {
              setValue((current) => (current.startsWith(action.prefix) ? current : `${action.prefix}${current}`));
              setPreparedHint(false);
            }}
          >
            {action.label}
          </button>
        ))}
        {speaking ? (
          <button type="button" className="nova-chip stop" onClick={onStopSpeech} aria-label="Stopp">
            Stop
          </button>
        ) : null}
        <span className="nova-command-tools">
          <button
            type="button"
            onClick={onToggleVoice}
            className={`nova-icon-btn ${voiceEnabled ? "" : "voice-off"}`}
            aria-label={voiceEnabled ? "NOVA Stimme aus" : "NOVA Stimme an"}
            title={voiceEnabled ? "NOVA Stimme: An" : "NOVA Stimme: Aus"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 10v4h3.2L12 18.5V5.5L7.2 10H4Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {voiceEnabled ? (
                <>
                  <path d="M16 9.2a3.2 3.2 0 0 1 0 5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M18.4 7a5.6 5.6 0 0 1 0 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </>
              ) : (
                <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={onMic}
            className={micClass}
            style={{ ["--silence-progress" as string]: String(silenceProgress) }}
            aria-pressed={sessionActive}
            aria-label={
              sessionActive
                ? "Voice Session beenden"
                : voiceSupported
                  ? "Voice Session starten"
                  : "Spracheingabe vorbereitet"
            }
            title={
              sessionActive
                ? "Voice Session aktiv — klicken zum Beenden"
                : voiceSupported
                  ? "Mikrofon"
                  : "Spracheingabe vorbereitet"
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 12 3Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button type="submit" disabled={disabled || !value.trim()} className="nova-icon-btn send" aria-label="Senden">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      </div>
      {preparedHint ? <p className="nova-hint">Anhänge sind vorbereitet, noch nicht verfügbar.</p> : null}
    </form>
  );
}
