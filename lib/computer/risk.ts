import { detectHardBlock, isDestructiveElevumAction, isHardBlockedPath } from "@/lib/computer/hard-blocks";
import { isIrreversibleBrowserAction } from "@/lib/computer/browser-policy";
import type { ApprovalClass, ComputerRiskClass } from "@/lib/computer/types";

export type RiskDecision = {
  risk: ComputerRiskClass;
  approvalClass: ApprovalClass;
  approvalRequired: boolean;
  autonomousAllowed: boolean;
  reason: string;
  hardBlocked: boolean;
  hardBlockCode?: string;
};

const DESTRUCTIVE_COMMANDS = new Set(["rm", "rmdir", "diskutil", "dd", "mkfs", "format", "shred"]);
const PRIVILEGED_COMMANDS = new Set(["sudo", "su", "launchctl", "csrutil", "spctl", "profiles"]);
const SYSTEM_COMMANDS = new Set(["kill", "killall", "pkill", "reboot", "shutdown", "nvram", "defaults"]);
const WRITE_COMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "node", "tsc", "eslint", "mkdir", "touch", "cp", "mv", "git"]);
const READ_COMMANDS = new Set([
  "ls",
  "pwd",
  "find",
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "ps",
  "lsof",
  "which",
  "uname",
  "hostname",
  "sw_vers",
  "git",
  "stat",
  "file",
  "open",
]);

function approvalFor(risk: ComputerRiskClass, userCommissioned: boolean): ApprovalClass {
  if (risk === "READ_ONLY") return "A";
  if (risk === "WORKSPACE_WRITE") return userCommissioned ? "B" : "C";
  return "C";
}

export function classifyShellCommand(input: {
  argv: string[];
  cwd?: string;
  userCommissioned?: boolean;
}): RiskDecision {
  const argv = input.argv.map((part) => part.trim()).filter(Boolean);
  const bin = argv[0]?.split("/").pop()?.toLowerCase() ?? "";
  const joined = argv.join(" ");
  const hard = detectHardBlock(joined);
  if (hard) {
    return {
      risk: "DESTRUCTIVE",
      approvalClass: "C",
      approvalRequired: true,
      autonomousAllowed: false,
      reason: hard.message,
      hardBlocked: true,
      hardBlockCode: hard.code,
    };
  }

  if (PRIVILEGED_COMMANDS.has(bin) || argv.includes("sudo")) {
    return decision("PRIVILEGED", input.userCommissioned, "Privilegierter Systembefehl.");
  }
  if (isDestructiveElevumAction(bin, input.cwd ?? "", argv)) {
    return {
      risk: "DESTRUCTIVE",
      approvalClass: "C",
      approvalRequired: true,
      autonomousAllowed: false,
      reason: "Daten auf der Festplatte ELEVUM werden niemals gelöscht — auch nicht mit Freigabe.",
      hardBlocked: true,
      hardBlockCode: "delete_elevum",
    };
  }
  if (DESTRUCTIVE_COMMANDS.has(bin) || /-rf\b/.test(joined) || /\brm\s+-/.test(joined)) {
    return decision("DESTRUCTIVE", input.userCommissioned, "Zerstörender Dateisystembefehl.");
  }
  if (bin === "git" && argv.some((part) => part === "push" || part === "force" || part === "--force")) {
    return decision("EXTERNAL_SIDE_EFFECT", input.userCommissioned, "git push verändert ein Remote.");
  }
  if (bin === "git" && (argv.includes("reset") || argv.includes("clean") || argv.includes("rebase"))) {
    return decision("DESTRUCTIVE", input.userCommissioned, "Git-Reset/Clean kann Arbeit unwiderruflich entfernen.");
  }
  if (SYSTEM_COMMANDS.has(bin)) {
    return decision("SYSTEM_CHANGE", input.userCommissioned, "Prozess- oder Systemänderung.");
  }
  if (bin === "curl" || bin === "wget" || bin === "ssh" || bin === "scp" || bin === "rsync") {
    const method = argv.find((part, index) => argv[index - 1] === "-X")?.toUpperCase();
    if (method && method !== "GET" && method !== "HEAD") {
      return decision("EXTERNAL_SIDE_EFFECT", input.userCommissioned, "Netzwerkanfrage mit Seiteneffekt.");
    }
    if (bin !== "curl") {
      return decision("EXTERNAL_SIDE_EFFECT", input.userCommissioned, "Externer Netzwerk- oder Hostzugriff.");
    }
  }
  if (bin === "npm" || bin === "npx" || bin === "pnpm" || bin === "yarn") {
    const sub = argv[1] ?? "";
    if (["install", "i", "add", "uninstall", "remove"].includes(sub) && argv.includes("-g")) {
      return decision("PRIVILEGED", input.userCommissioned, "Globale Paketinstallation.");
    }
    if (["publish", "deploy"].includes(sub)) {
      return decision("EXTERNAL_SIDE_EFFECT", input.userCommissioned, "Publish/Deploy hat externe Wirkung.");
    }
    if (["test", "run", "exec", "lint", "build", "start", "dev"].includes(sub) || sub?.startsWith("run")) {
      return {
        ...decision("WORKSPACE_WRITE", true, "Projektbefehl im Workspace."),
        approvalClass: input.userCommissioned === false ? "C" : "B",
        approvalRequired: input.userCommissioned === false,
        autonomousAllowed: input.userCommissioned !== false,
      };
    }
  }
  if (bin === "git") {
    const sub = argv[1] ?? "";
    if (["status", "diff", "log", "show", "rev-parse", "branch", "remote"].includes(sub)) {
      return decision("READ_ONLY", input.userCommissioned, "Lesender Git-Befehl.");
    }
    return decision("WORKSPACE_WRITE", input.userCommissioned, "Schreibender Git-Befehl.");
  }
  if (READ_COMMANDS.has(bin) && !WRITE_COMMANDS.has(bin)) {
    return decision("READ_ONLY", input.userCommissioned, "Lesender Systembefehl.");
  }
  if (WRITE_COMMANDS.has(bin)) {
    return decision("WORKSPACE_WRITE", input.userCommissioned, "Workspace-Schreibbefehl.");
  }
  return decision("SYSTEM_CHANGE", input.userCommissioned, "Unbekannter Befehl – Freigabe erforderlich.");
}

export function classifyFilesystemAction(input: {
  action: string;
  target: string;
  userCommissioned?: boolean;
}): RiskDecision {
  if (isHardBlockedPath(input.target) || detectHardBlock(input.target)) {
    return {
      risk: "DESTRUCTIVE",
      approvalClass: "C",
      approvalRequired: true,
      autonomousAllowed: false,
      reason: "Geschützter Pfad oder hart blockierte Aktion.",
      hardBlocked: true,
      hardBlockCode: "protected_path",
    };
  }
  if (isDestructiveElevumAction(input.action, input.target)) {
    return {
      risk: "DESTRUCTIVE",
      approvalClass: "C",
      approvalRequired: true,
      autonomousAllowed: false,
      reason: "Daten auf der Festplatte ELEVUM werden niemals gelöscht — auch nicht mit Freigabe.",
      hardBlocked: true,
      hardBlockCode: "delete_elevum",
    };
  }
  if (input.action === "delete" || input.action === "deleteRecursive") {
    return decision("DESTRUCTIVE", false, "Löschen benötigt immer Freigabe.");
  }
  if (input.action === "write" || input.action === "overwrite") {
    return decision("WORKSPACE_WRITE", input.userCommissioned, "Bestehende oder neue Datei schreiben.");
  }
  if (["create", "mkdir", "copy", "move", "rename", "append"].includes(input.action)) {
    return {
      ...decision("WORKSPACE_WRITE", true, "Arbeitsdatei ändern."),
      approvalClass: input.userCommissioned ? "B" : "C",
      approvalRequired: !input.userCommissioned,
      autonomousAllowed: Boolean(input.userCommissioned),
    };
  }
  return decision("READ_ONLY", true, "Lesender Dateizugriff.");
}

export function classifyComputerAction(input: {
  tool: string;
  action: string;
  target?: string;
  argv?: string[];
  userCommissioned?: boolean;
}): RiskDecision {
  const blob = [input.tool, input.action, input.target ?? "", ...(input.argv ?? [])].join(" ");
  const hard = detectHardBlock(blob);
  if (hard) {
    return {
      risk: "DESTRUCTIVE",
      approvalClass: "C",
      approvalRequired: true,
      autonomousAllowed: false,
      reason: hard.message,
      hardBlocked: true,
      hardBlockCode: hard.code,
    };
  }
  if (input.tool === "shell" && input.argv) {
    return classifyShellCommand({ argv: input.argv, userCommissioned: input.userCommissioned });
  }
  if (input.tool === "filesystem") {
    return classifyFilesystemAction({
      action: input.action,
      target: input.target ?? "",
      userCommissioned: input.userCommissioned,
    });
  }
  if (input.tool === "cursor") {
    if (/push|deploy|migration|secret|production/i.test(blob)) {
      return decision("EXTERNAL_SIDE_EFFECT", false, "Cursor-Auftrag mit externer oder produktiver Wirkung.");
    }
    return {
      ...decision("WORKSPACE_WRITE", true, "Cursor Coding-Auftrag."),
      approvalClass: input.userCommissioned ? "B" : "C",
      approvalRequired: !input.userCommissioned,
      autonomousAllowed: Boolean(input.userCommissioned),
    };
  }
  if (input.tool === "process" && (input.action === "stop" || input.action === "kill")) {
    return decision("SYSTEM_CHANGE", input.userCommissioned, "Prozess beenden.");
  }
  if (input.tool === "process" && input.action === "start") {
    return {
      ...decision("WORKSPACE_WRITE", true, "Lokalen Prozess starten."),
      approvalClass: input.userCommissioned ? "B" : "C",
      approvalRequired: !input.userCommissioned,
      autonomousAllowed: Boolean(input.userCommissioned),
    };
  }
  if (input.tool === "browser") {
    if (isIrreversibleBrowserAction(input.action, input.target)) {
      return decision("EXTERNAL_SIDE_EFFECT", false, "Browseraktion mit externer irreversibler Wirkung.");
    }
    if (input.action === "upload") {
      return decision("WORKSPACE_WRITE", true, "Datei für Upload vorbereiten, ohne das Formular abzusenden.");
    }
    if (input.action === "download") {
      return decision("READ_ONLY", true, "Download in den kontrollierten NOVA-Workspace.");
    }
    return decision("READ_ONLY", true, "Lesende oder lokale Browseraktion.");
  }
  if (input.tool === "application" && input.action === "quit") {
    return decision("SYSTEM_CHANGE", input.userCommissioned, "Anwendung beenden.");
  }
  if (input.tool === "application" && input.action === "runScript") {
    return {
      ...decision("SYSTEM_CHANGE", true, "AppleScript steuert eine App."),
      approvalClass: input.userCommissioned ? "B" : "C",
      approvalRequired: !input.userCommissioned,
      autonomousAllowed: Boolean(input.userCommissioned),
    };
  }
  if (input.tool === "application") {
    return decision("READ_ONLY", true, "Anwendung fokussieren oder starten.");
  }
  if (input.tool === "accessibility") {
    if (input.action === "inspect") {
      return decision("READ_ONLY", true, "UI-Baum lesen.");
    }
    return {
      ...decision("WORKSPACE_WRITE", true, "UI-Steuerung in einer App."),
      approvalClass: input.userCommissioned ? "B" : "C",
      approvalRequired: !input.userCommissioned,
      autonomousAllowed: Boolean(input.userCommissioned),
    };
  }
  return decision("READ_ONLY", true, "Standard-Computeraktion.");
}

function decision(risk: ComputerRiskClass, userCommissioned: boolean | undefined, reason: string): RiskDecision {
  const approvalClass = approvalFor(risk, Boolean(userCommissioned));
  const approvalRequired = approvalClass === "C";
  return {
    risk,
    approvalClass,
    approvalRequired,
    autonomousAllowed: !approvalRequired,
    reason,
    hardBlocked: false,
  };
}
