/**
 * Ein Mikrofon-Stream, RMS-VAD, HTTP-Transkription.
 * Standard: Push-to-Talk (Taste halten = aufnehmen, loslassen = verarbeiten).
 * Kein Aktivierungswort, kein Zuhören im Hintergrund im Wartezustand.
 */

export const VOICE_SESSION_CONFIG = {
  /** true = nur aufnehmen solange Hotkey/Button gehalten wird; kein Dauerhören. */
  pushToTalk: true,
  /** Vom Nutzer wählbar; Default Rechts-Option. Launcher liest NOVA_PTT_KEY / UserDefaults. */
  pushToTalkKeyDefault: "rightOption",
  silenceTimeoutMs: 800,
  minSpeechDurationMs: 160,
  vadHangoverMs: 280,
  vadWarmupMs: 400,
  vadMinSpeechRms: 0.012,
  vadMinSpeechPeak: 0.04,
  vadNoiseFloor: 0.004,
  vadNoiseMultiplier: 2.4,
  vadNoiseAdaptSpeech: 0.04,
  vadNoiseAdaptSilence: 0.12,
  vadNoiseCeiling: 0.06,
  postTtsGuardMs: 180,
  bargeInEnabled: true,
  bargeInWarmupMs: 180,
  bargeInMinSpeechRms: 0.028,
  bargeInMinSpeechPeak: 0.1,
  bargeInMinSpeechMs: 200,
  silenceResumeConfirmMs: 280,
  silenceUiTickMs: 100,
  fftSize: 2048,
  maxTranscriptChars: 4000,
  maxUtteranceMs: 25000,
  preRollMs: 350,
  postRollMs: 180,
  utteranceMinBytes: 800,
  pcmSampleRate: 16000,
  pcmBufferSeconds: 30,
} as const;

export type VoiceSessionConfig = Omit<
  typeof VOICE_SESSION_CONFIG,
  "bargeInEnabled" | "pushToTalk" | "pushToTalkKeyDefault"
> & {
  bargeInEnabled: boolean;
  pushToTalk: boolean;
  pushToTalkKeyDefault: string;
};
