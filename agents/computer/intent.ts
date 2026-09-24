import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { isInjectionAttempt } from "@/lib/computer/injection";
import { detectNamedVolume } from "@/lib/computer/volumes";

export type ComputerIntentKind =
  | "cancel"
  | "inspect_project"
  | "start_dev"
  | "open_local"
  | "open_app"
  | "ui_click"
  | "cursor_ask"
  | "delete_dangerous"
  | "screenshot"
  | "find_file"
  | "generic"
  | "none";

export type ComputerIntent = {
  kind: ComputerIntentKind;
  userCommissioned: boolean;
  statusMessage: string;
};

export function detectComputerIntent(userRequest: string): ComputerIntent {
  const text = userRequest.trim();
  const lower = text.toLowerCase();

  if (/^(nova[,.\s]*)?(stopp?|stop|abbrechen|hör\s*auf|hoer\s*auf)\.?$/i.test(text)) {
    return { kind: "cancel", userCommissioned: true, statusMessage: "Ich breche ab." };
  }

  if (detectHardBlock(text)?.code === "delete_repository" || /lösch(?:e|en)?\s+(?:das\s+)?nova/i.test(lower)) {
    return { kind: "delete_dangerous", userCommissioned: true, statusMessage: "Freigabe erforderlich" };
  }

  if (detectHardBlock(text)?.code === "ssh_exfil" || (isInjectionAttempt(text) && /website|seite|webpage|untrusted/i.test(lower))) {
    return { kind: "generic", userCommissioned: false, statusMessage: "Inhalt wird geprüft" };
  }

  if (/frag(?:e)?\s+cursor|cursor.*(analysier)/i.test(lower) && !/umsetz|änder|bau|beheb|implement/i.test(lower)) {
    return { kind: "cursor_ask", userCommissioned: true, statusMessage: "Cursor analysiert NOVA" };
  }

  if (/öffne die lokale nova|lokale nova-seite|localhost.*prüf|seite.*erreichbar/i.test(lower)) {
    return { kind: "open_local", userCommissioned: true, statusMessage: "Browser wird geprüft" };
  }

  if (/\b(?:klick(?:e|en)?(?:\s+auf)?|drück(?:e|en)?(?:\s+auf)?|tippe(?:\s+(?:in|auf))?)\b/i.test(lower)) {
    return { kind: "ui_click", userCommissioned: true, statusMessage: "UI-Element wird bedient" };
  }

  if (/öffne\s+(?:finder|terminal|textedit|mail|kalender|safari|chrome|cursor|notizen|notes|systemeinstellungen)/i.test(lower)) {
    return { kind: "open_app", userCommissioned: true, statusMessage: "App wird geöffnet" };
  }

  if (/starte nova lokal|npm run dev|dev server|lokal starten/i.test(lower)) {
    return { kind: "start_dev", userCommissioned: true, statusMessage: "NOVA wird lokal gestartet" };
  }

  if (/aktuellen stand|git status|was (?:hat|hast).*(projekt|cursor).*gemacht|prüfe.*nova-projekt|projektstand/i.test(lower)) {
    return { kind: "inspect_project", userCommissioned: true, statusMessage: "Projektstand wird geprüft" };
  }

  if (/screenshot|bildschirmfoto/i.test(lower)) {
    return { kind: "screenshot", userCommissioned: true, statusMessage: "Bildschirm wird erfasst" };
  }

  if (/wo (?:liegt|ist) die datei|such(?:e| mir) die datei|finde die datei|was liegt auf|inhalt (?:der|von)|zeig(?:e| mir) (?:den )?(?:ordner|inhalt)/i.test(lower)) {
    return { kind: "find_file", userCommissioned: true, statusMessage: "Dateien werden gesucht" };
  }

  const volume = detectNamedVolume(text);
  if (volume && /\b(lies|lese|zeig|liste|ordner|dateien|unterlagen|festplatte|was liegt|inhalt|such)\b/i.test(lower)) {
    return { kind: "find_file", userCommissioned: true, statusMessage: volume.mounted ? `${volume.name} wird gelesen` : `${volume.name} ist nicht eingehängt` };
  }

  if (
    /auf meinem mac|öffne (?:finder|terminal|cursor|chrome|safari)|computer|dateisystem|browser.*(seite|formular)/i.test(
      lower,
    )
  ) {
    return { kind: "generic", userCommissioned: true, statusMessage: "Computeraktion wird vorbereitet" };
  }

  return { kind: "none", userCommissioned: false, statusMessage: "" };
}

export function isComputerRequest(userRequest: string): boolean {
  return detectComputerIntent(userRequest).kind !== "none";
}
