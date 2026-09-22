"use client";

import { useState } from "react";

export function Composer({
  disabled,
  listening,
  voiceSupported,
  onSubmit,
  onMic,
}: {
  disabled: boolean;
  listening: boolean;
  voiceSupported: boolean;
  onSubmit: (value: string) => void;
  onMic: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex w-full max-w-[560px] items-center gap-2 rounded-full border border-white/8 bg-white/4 px-3 py-2 backdrop-blur-md"
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim();
        if (!next || disabled) return;
        onSubmit(next);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
        placeholder={listening ? "Ich höre zu …" : "Was soll ich erledigen?"}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] text-white/90 outline-none placeholder:text-white/30"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={onMic}
        className={`grid h-10 w-10 place-items-center rounded-full transition ${
          listening ? "bg-white/18 text-white" : "text-white/55 hover:bg-white/8 hover:text-white/80"
        }`}
        aria-label={voiceSupported ? "Spracheingabe" : "Spracheingabe vorbereitet"}
        title={voiceSupported ? "Mikrofon" : "Spracheingabe vorbereitet"}
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
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/16 disabled:opacity-30"
        aria-label="Senden"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
