import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isHardBlockedPath } from "@/lib/computer/hard-blocks";
import { mountedExternalVolumeRoots } from "@/lib/computer/volumes";

export type PathResolution = {
  requested: string;
  resolved: string;
  exists: boolean;
  withinAllowed: boolean;
  blocked: boolean;
};

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function defaultWorkspaceRoots(): string[] {
  const extra = (process.env.NOVA_WORKSPACE_ROOTS ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = [
    process.cwd(),
    extra,
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "Downloads"),
    path.join(os.tmpdir(), "nova-coding-e2e"),
    path.join(os.tmpdir(), "nova-knowledge-e2e"),
    path.join(os.tmpdir(), "nova-chatgpt-e2e"),
    path.join(process.cwd(), ".nova", "uploads"),
    ...mountedExternalVolumeRoots().map((item) => item.path),
  ].flat();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(expandHome(candidate));
    if (!unique.includes(resolved)) unique.push(resolved);
  }
  return unique;
}

export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspacePath(input: {
  requested: string;
  roots?: string[];
  mustExist?: boolean;
}): PathResolution {
  const roots = input.roots ?? defaultWorkspaceRoots();
  const resolved = path.resolve(expandHome(input.requested));
  const blocked = isHardBlockedPath(resolved);
  const withinAllowed = roots.some((root) => isPathInside(resolved, root));
  const exists = fs.existsSync(resolved);
  return {
    requested: input.requested,
    resolved,
    exists,
    withinAllowed,
    blocked,
  };
}

export function assertWritablePath(resolution: PathResolution): void {
  if (resolution.blocked) {
    throw new Error(`Pfad ist hart geschützt: ${resolution.resolved}`);
  }
  if (!resolution.withinAllowed) {
    throw new Error(`Pfad liegt außerhalb erlaubter Arbeitsverzeichnisse: ${resolution.resolved}`);
  }
}

export function assertExistingPath(resolution: PathResolution): void {
  if (!resolution.exists) {
    throw new Error(`Pfad existiert nicht: ${resolution.resolved}`);
  }
}
