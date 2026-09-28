import fs from "node:fs";
import { executeScreenAction } from "@/services/desktop-service/adapters/screen";
import { resolveAIProvider } from "@/providers/ai/registry";
import type { ScreenPerception } from "@/types/ai";

/**
 * Bildschirm sehen: Capture → Modell → Datei sofort löschen.
 * Inhalt geht nicht ins Memory.
 */
export async function perceiveScreen(input: {
  organizationId: string;
  question?: string;
}): Promise<
  | { ok: true; perception: ScreenPerception; ephemeralPath?: string }
  | { ok: false; reason: string }
> {
  const capture = await executeScreenAction({ payload: { action: "capture" } });
  if (!capture.success) {
    return {
      ok: false,
      reason: capture.error?.message ?? "Screenshot fehlgeschlagen.",
    };
  }
  const path = String((capture.result as { path?: string } | undefined)?.path ?? "");
  if (!path || !fs.existsSync(path)) {
    return { ok: false, reason: "Kein ephemeral Screenshot-Pfad." };
  }

  try {
    const bytes = fs.readFileSync(path);
    const { provider } = await resolveAIProvider(input.organizationId, "simple");
    if (!provider.analyzeImage) {
      return { ok: false, reason: `Provider ${provider.id} unterstützt keine Bildanalyse (später).` };
    }
    const perception = await provider.analyzeImage({
      imageBase64: bytes.toString("base64"),
      mimeType: "image/png",
      question:
        input.question ??
        "Was ist auf dem Bildschirm sichtbar? Fenster, fokussierte App, bedienbare Elemente, Zustand.",
    });
    return { ok: true, perception, ephemeralPath: path };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Bildanalyse fehlgeschlagen.",
    };
  } finally {
    try {
      fs.unlinkSync(path);
    } catch {
      // ephemeral best-effort
    }
  }
}
