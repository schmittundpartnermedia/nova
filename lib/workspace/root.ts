import fs from "node:fs";
import path from "node:path";
import { configuredExternalVolumeNames, volumeMountPath } from "@/lib/computer/volumes";
import type { WorkspaceAvailability, WorkspaceRootStatus } from "@/types/workspace";

export type ProbeFacts = {
  configured: boolean;
  resolvedPath: string | null;
  volumeName: string | null;
  source: WorkspaceRootStatus["source"];
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  error?: string;
};

export function configuredWorkspaceRootPath(): string | null {
  const raw = process.env.NOVA_WORKSPACE_ROOT?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function discoverWorkspaceRootPath(): {
  path: string | null;
  volumeName: string | null;
  source: WorkspaceRootStatus["source"];
} {
  const configured = configuredWorkspaceRootPath();
  if (configured) {
    const volumeName = configured.startsWith(`${path.sep}Volumes${path.sep}`)
      ? configured.split(path.sep)[2] ?? null
      : null;
    return { path: configured, volumeName, source: "env" };
  }
  for (const name of configuredExternalVolumeNames()) {
    const root = volumeMountPath(name);
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
        return { path: path.resolve(root), volumeName: name, source: "volume" };
      }
    } catch {
      /* nächstes konfiguriertes Volume */
    }
  }
  return { path: null, volumeName: configuredExternalVolumeNames()[0] ?? null, source: "none" };
}

export function classifyWorkspaceProbe(facts: ProbeFacts): WorkspaceRootStatus {
  const base = {
    configuredPath: facts.configured ? facts.resolvedPath : null,
    resolvedPath: facts.resolvedPath,
    volumeName: facts.volumeName,
    source: facts.source,
    writable: false,
  };
  if (facts.error) {
    return {
      ...base,
      availability: "ERROR",
      message: facts.error,
    };
  }
  if (!facts.resolvedPath || !facts.exists) {
    const expected = facts.volumeName ? ` (${facts.volumeName})` : "";
    return {
      ...base,
      availability: "UNAVAILABLE",
      resolvedPath: facts.resolvedPath,
      message: facts.configured
        ? `Der konfigurierte Workspace-Pfad ist nicht verbunden${expected}. Es wurde nichts woanders abgelegt.`
        : `Kein Workspace-Volume verbunden${expected}. Es wurde nichts auf einem anderen Datenträger angelegt.`,
    };
  }
  if (!facts.isDirectory) {
    return {
      ...base,
      availability: "ERROR",
      message: `Workspace-Pfad ist keine Ablage: ${facts.resolvedPath}`,
    };
  }
  if (!facts.readable) {
    return {
      ...base,
      availability: "ERROR",
      message: `Workspace ist nicht lesbar: ${facts.resolvedPath}`,
    };
  }
  if (!facts.writable) {
    return {
      ...base,
      availability: "READ_ONLY",
      message: `Workspace ist nur lesbar: ${facts.resolvedPath}. Es wurde nichts geschrieben.`,
    };
  }
  return {
    ...base,
    availability: "AVAILABLE",
    writable: true,
    message: `Workspace bereit: ${facts.resolvedPath}`,
  };
}

function canAccess(target: string, mode: number): boolean {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

export function probeWorkspaceRoot(): WorkspaceRootStatus {
  const discovered = discoverWorkspaceRootPath();
  const configured = Boolean(configuredWorkspaceRootPath());
  if (!discovered.path) {
    return classifyWorkspaceProbe({
      configured,
      resolvedPath: null,
      volumeName: discovered.volumeName,
      source: discovered.source,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
    });
  }
  try {
    const exists = fs.existsSync(discovered.path);
    if (!exists) {
      return classifyWorkspaceProbe({
        configured,
        resolvedPath: discovered.path,
        volumeName: discovered.volumeName,
        source: discovered.source,
        exists: false,
        isDirectory: false,
        readable: false,
        writable: false,
      });
    }
    const stat = fs.statSync(discovered.path);
    const readable = canAccess(discovered.path, fs.constants.R_OK);
    const writable = canAccess(discovered.path, fs.constants.W_OK);
    return classifyWorkspaceProbe({
      configured,
      resolvedPath: discovered.path,
      volumeName: discovered.volumeName,
      source: discovered.source,
      exists: true,
      isDirectory: stat.isDirectory(),
      readable,
      writable,
    });
  } catch (error) {
    return classifyWorkspaceProbe({
      configured,
      resolvedPath: discovered.path,
      volumeName: discovered.volumeName,
      source: discovered.source,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      error: error instanceof Error ? error.message : "Workspace konnte nicht geprüft werden.",
    });
  }
}

export function availabilityRank(value: WorkspaceAvailability): number {
  if (value === "AVAILABLE") return 0;
  if (value === "READ_ONLY") return 1;
  if (value === "UNAVAILABLE") return 2;
  return 3;
}
