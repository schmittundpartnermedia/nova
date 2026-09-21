import type { SpeechViseme } from "@/types/voice";
import { visemeGeometry } from "@/services/voice/viseme-shapes";

export function applyLipSyncStage(
  node: HTMLElement | null,
  input: { speaking: boolean; viseme: SpeechViseme; intensity: number },
) {
  if (!node) return;
  const speaking = input.speaking;
  const viseme = speaking ? input.viseme : "REST";
  const intensity = speaking ? Math.min(1, Math.max(0, input.intensity)) : 0;
  const geo = visemeGeometry(viseme, intensity);
  node.style.setProperty("--nova-speech-intensity", intensity.toFixed(3));
  node.style.setProperty("--nova-mouth-w", `${geo.width.toFixed(2)}%`);
  node.style.setProperty("--nova-mouth-h", `${geo.height.toFixed(2)}%`);
  node.style.setProperty("--nova-jaw-drop", `${geo.jaw.toFixed(2)}px`);
  node.style.setProperty("--nova-mouth-teeth", geo.teeth.toFixed(3));
  node.dataset.viseme = viseme;
  node.dataset.speaking = speaking ? "true" : "false";
}
