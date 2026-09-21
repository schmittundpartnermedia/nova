import type { ComputerIntentKind } from "@/agents/computer/intent";
import type { ComputerActionEnvelope } from "@/lib/computer/schemas";

export type PlannedStep = {
  tool: ComputerActionEnvelope["tool"];
  payload: unknown;
  purpose: string;
  userCommissioned: boolean;
};

export function planComputerTask(input: {
  kind: ComputerIntentKind;
  userRequest: string;
  workspace: string;
}): PlannedStep[] {
  switch (input.kind) {
    case "inspect_project":
      return [
        {
          tool: "filesystem",
          payload: { action: "stat", path: input.workspace },
          purpose: "Projektpfad prüfen",
          userCommissioned: true,
        },
        {
          tool: "shell",
          payload: {
            action: "execute",
            argv: ["git", "status", "--short", "--branch"],
            cwd: input.workspace,
            purpose: "Git-Status des NOVA-Projekts",
            timeoutMs: 15_000,
          },
          purpose: "Git-Status",
          userCommissioned: true,
        },
        {
          tool: "shell",
          payload: {
            action: "execute",
            argv: ["git", "diff", "--stat"],
            cwd: input.workspace,
            purpose: "Änderungsübersicht",
            timeoutMs: 15_000,
          },
          purpose: "Git-Diff",
          userCommissioned: true,
        },
      ];
    case "start_dev":
      return [
        {
          tool: "process",
          payload: { action: "list", query: "next" },
          purpose: "Laufende Dev-Server erkennen",
          userCommissioned: true,
        },
      ];
    case "open_local":
      return [
        {
          tool: "process",
          payload: { action: "list", query: "next" },
          purpose: "Port des lokalen Servers erkennen",
          userCommissioned: true,
        },
        {
          tool: "browser",
          payload: { action: "open", url: "http://127.0.0.1:3000" },
          purpose: "Lokale NOVA-Seite öffnen und Erreichbarkeit prüfen",
          userCommissioned: true,
        },
      ];
    case "cursor_ask":
      return [
        {
          tool: "cursor",
          payload: {
            action: "available",
          },
          purpose: "Cursor CLI prüfen",
          userCommissioned: true,
        },
        {
          tool: "cursor",
          payload: {
            action: "ask",
            workspace: input.workspace,
            question:
              "Gibt es im aktuellen Workspace TypeScript-Fehler? Antworte knapp. Keine Dateien ändern. Kein Push. Kein Deploy.",
          },
          purpose: "Cursor nach TypeScript-Fehlern fragen",
          userCommissioned: true,
        },
      ];
    case "delete_dangerous":
      return [
        {
          tool: "filesystem",
          payload: { action: "delete", path: input.workspace, recursive: true },
          purpose: "Projekt löschen – darf nicht autonom laufen",
          userCommissioned: true,
        },
      ];
    case "screenshot":
      return [
        {
          tool: "screen",
          payload: { action: "capture", persist: false },
          purpose: "Ephemeral Screenshot",
          userCommissioned: true,
        },
      ];
    case "find_file":
      return [
        {
          tool: "filesystem",
          payload: {
            action: "search",
            root: input.workspace,
            query: guessFilename(input.userRequest),
            maxResults: 30,
          },
          purpose: "Datei suchen",
          userCommissioned: true,
        },
      ];
    default:
      return [];
  }
}

function guessFilename(request: string): string {
  const named = request.match(/datei\s+([a-zA-Z0-9._-]+)/i)?.[1];
  if (named) return named;
  const cleaned = request.replace(/such(?:e| mir)?|die datei|finde/gi, "").trim().slice(0, 40);
  if (cleaned) return cleaned;
  return "nova";
}
