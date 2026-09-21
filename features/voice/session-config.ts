/**
 * Zentrale Voice-Session-Konfiguration.
 * Keine Magic Numbers in Components.
 *
 * Barge-In ist bewusst aus:
 * Web Speech API nutzt einen eigenen Mikrofonpfad. echoCancellation auf
 * unserem MediaStream gilt nicht für STT. STT während TTS würde NOVAs
 * eigene Stimme transkribieren. Mic-VAD während TTS kann durch Lautsprecher-
 * Leak fehlzünden. Echtes Barge-In braucht denselben echo-cancelled Capture-
 * Graphen für VAD und STT (z. B. AudioWorklet).
 */

export const VOICE_SESSION_CONFIG = {
  silenceTimeoutMs: 5000,
  minSpeechDurationMs: 180,
  vadHangoverMs: 280,
  vadWarmupMs: 320,
  vadSnrDb: 8,
  vadMinSpeechEnergy: 0.018,
  vadNoiseFloor: 0.004,
  vadNoiseAdaptSpeech: 0.035,
  vadNoiseAdaptSilence: 0.14,
  vadRumbleRatio: 1.15,
  vadHissRatio: 0.85,
  vadZcrMin: 0.01,
  vadZcrMax: 0.35,
  postTtsGuardMs: 450,
  bargeInEnabled: false,
  sttLang: "de-DE",
  earlySttWindowMs: 900,
  silenceResumeConfirmMs: 400,
  silenceUiTickMs: 100,
  sttRestartDelayMs: 80,
  speechBandLowHz: 300,
  speechBandHighHz: 3400,
  rumbleHighHz: 150,
  hissLowHz: 5000,
  fftSize: 2048,
  maxTranscriptChars: 4000,
} as const;

export type VoiceSessionConfig = typeof VOICE_SESSION_CONFIG;
