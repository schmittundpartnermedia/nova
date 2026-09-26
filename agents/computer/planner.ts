import type { ComputerIntentKind } from "@/agents/computer/intent";
import type { ComputerActionEnvelope } from "@/lib/computer/schemas";
import { compileAppleScript, extractAppleScript } from "@/lib/computer/applescript";
import { getWebBaseUrl } from "@/lib/computer/config";
import { detectNamedVolume } from "@/lib/computer/volumes";

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
          payload: { action: "open", url: getWebBaseUrl() },
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
    case "run_script": {
      const compiled = compileAppleScript(extractAppleScript(input.userRequest));
      if (!compiled.ok) return [];
      return [
        {
          tool: "application",
          payload: { action: "runScript", source: compiled.source, app: compiled.app },
          purpose: `AppleScript in ${compiled.app}`,
          userCommissioned: true,
        },
        {
          tool: "screen",
          payload: { action: "capture", persist: false },
          purpose: "Selbstprüfung nach AppleScript",
          userCommissioned: true,
        },
      ];
    }
    case "quit_app": {
      const app = guessAppName(input.userRequest);
      if (!app) return [];
      return [
        {
          tool: "application",
          payload: { action: "quit", name: app },
          purpose: `${app} beenden`,
          userCommissioned: true,
        },
      ];
    }
    case "open_app": {
      const app = guessAppName(input.userRequest);
      return [
        {
          tool: "application",
          payload: { action: "launch", name: app },
          purpose: `${app} starten`,
          userCommissioned: true,
        },
        {
          tool: "application",
          payload: { action: "focus", name: app },
          purpose: `${app} in den Vordergrund`,
          userCommissioned: true,
        },
      ];
    }
    case "ui_click": {
      const app = guessAppName(input.userRequest);
      const control = guessControlName(input.userRequest);
      const typed = guessTypedValue(input.userRequest);
      const steps: PlannedStep[] = [];
      if (app) {
        steps.push({
          tool: "application",
          payload: { action: "focus", name: app },
          purpose: `${app} fokussieren`,
          userCommissioned: true,
        });
      }
      if (typed && control) {
        steps.push({
          tool: "accessibility",
          payload: { action: "setValue", identifier: control, value: typed, app: app || undefined },
          purpose: `In ${control} tippen`,
          userCommissioned: true,
        });
        steps.push({
          tool: "screen",
          payload: { action: "capture", persist: false },
          purpose: "Selbstprüfung nach UI-Eingabe",
          userCommissioned: true,
        });
        return steps;
      }
      if (control) {
        steps.push({
          tool: "accessibility",
          payload: { action: "inspect", app: app || undefined, maxDepth: 3 },
          purpose: "UI lesen, dann klicken",
          userCommissioned: true,
        });
        steps.push({
          tool: "accessibility",
          payload: { action: "press", identifier: control, app: app || undefined },
          purpose: `${control} bedienen`,
          userCommissioned: true,
        });
        steps.push({
          tool: "screen",
          payload: { action: "capture", persist: false },
          purpose: "Selbstprüfung nach UI-Klick",
          userCommissioned: true,
        });
        return steps;
      }
      steps.push({
        tool: "accessibility",
        payload: { action: "inspect", app: app || undefined, maxDepth: 3 },
        purpose: "UI lesen, weil das Ziel unklar ist",
        userCommissioned: true,
      });
      return steps;
    }
    case "find_file": {
      const volume = detectNamedVolume(input.userRequest);
      const root = volume?.path ?? input.workspace;
      const listing = /was liegt|zeig|liste|übersicht|inhalt|festplatte/i.test(input.userRequest);
      if (listing) {
        return [
          {
            tool: "filesystem",
            payload: { action: "list", path: root, maxEntries: 80 },
            purpose: volume ? `${volume.name} listen` : "Ordner listen",
            userCommissioned: true,
          },
        ];
      }
      return [
        {
          tool: "filesystem",
          payload: {
            action: "search",
            root,
            query: guessFilename(input.userRequest),
            maxResults: 30,
          },
          purpose: volume ? `Auf ${volume.name} suchen` : "Datei suchen",
          userCommissioned: true,
        },
      ];
    }
    case "resume":
      return [];
    default:
      return [];
  }
}

function guessFilename(request: string): string {
  const named = request.match(/datei\s+([a-zA-Z0-9._-]+)/i)?.[1];
  if (named) return named;
  const cleaned = request
    .replace(/such(?:e| mir)?|die datei|finde|auf elevum|von elevum|festplatte|elevum/gi, "")
    .trim()
    .slice(0, 40);
  if (cleaned) return cleaned;
  return "nova";
}

const APP_ALIASES: Record<string, string> = {
  finder: "Finder",
  terminal: "Terminal",
  textedit: "TextEdit",
  mail: "Mail",
  kalender: "Calendar",
  calendar: "Calendar",
  safari: "Safari",
  chrome: "Google Chrome",
  cursor: "Cursor",
  notizen: "Notes",
  notes: "Notes",
  systemeinstellungen: "System Settings",
};

export function guessAppName(request: string): string {
  const match = request.match(
    /\b(finder|terminal|textedit|mail|kalender|calendar|safari|chrome|cursor|notizen|notes|systemeinstellungen)\b/i,
  );
  if (!match?.[1]) return "";
  return APP_ALIASES[match[1].toLowerCase()] ?? match[1];
}

export function guessControlName(request: string): string {
  const quoted = request.match(/["„]([^"”]+)["”]/)?.[1];
  if (quoted?.trim()) return quoted.trim().slice(0, 120);
  const click = request.match(
    /(?:klick(?:e|en)?(?:\s+auf)?|drück(?:e|en)?(?:\s+auf)?|button|menü(?:punkt)?)\s+(.+?)(?:\s+in\s+|\s*$)/i,
  );
  if (click?.[1]) return click[1].replace(/\s+in\s+.+$/i, "").trim().slice(0, 120);
  const field = request.match(/tippe(?:\s+(?:in|auf))?\s+(.+?)(?:\s*[:–-]\s*|\s*$)/i);
  if (field?.[1]) return field[1].trim().slice(0, 120);
  return "";
}

export function guessTypedValue(request: string): string {
  const typed = request.match(/tippe(?:\s+(?:in|auf)\s+[^:]+)?\s*[:–-]\s*(.+)$/i);
  return typed?.[1]?.trim().slice(0, 500) ?? "";
}
