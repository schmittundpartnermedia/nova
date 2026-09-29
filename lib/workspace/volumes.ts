import fs from "node:fs";
import path from "node:path";

export const DEFAULT_EXTERNAL_VOLUME_NAMES = ["ELEVUM"];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/;

export function isAllowedVolumeName(name: string): boolean {
  const value = name.trim();
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return NAME_RE.test(value);
}

export function configuredExternalVolumeNames(): string[] {
  const extra = (process.env.NOVA_EXTERNAL_VOLUMES ?? "")
    .split(/[,:]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const names: string[] = [];
  for (const name of [...DEFAULT_EXTERNAL_VOLUME_NAMES, ...extra]) {
    if (!isAllowedVolumeName(name)) continue;
    if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

export function volumeMountPath(name: string): string {
  return path.join("/Volumes", name);
}

export function mountedExternalVolumeRoots(): Array<{ name: string; path: string }> {
  const mounted: Array<{ name: string; path: string }> = [];
  for (const name of configuredExternalVolumeNames()) {
    const root = volumeMountPath(name);
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
        mounted.push({ name, path: path.resolve(root) });
      }
    } catch {
      /* unlesbar */
    }
  }
  return mounted;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionsVolumeDisk(text: string, name: string): boolean {
  const value = text.trim();
  if (!value || !isAllowedVolumeName(name)) return false;
  if (/\b(?:website|webseite|beschlossen|angebot)\b/i.test(value) && !/\b(festplatte|platte|volume|\/volumes\/)\b/i.test(value)) {
    return false;
  }
  const nameRe = escapeRegExp(name);
  if (new RegExp(`/volumes/${nameRe}\\b`, "i").test(value)) return true;
  if (new RegExp(`\\b(auf|von)\\s+(der\\s+)?(festplatte\\s+)?${nameRe}\\b`, "i").test(value)) return true;
  if (new RegExp(`\\bfestplatte(?:\\s+${nameRe})?\\b`, "i").test(value) && new RegExp(`\\b${nameRe}\\b`, "i").test(value)) {
    return true;
  }
  if (
    new RegExp(`\\b${nameRe}\\b`, "i").test(value) &&
    /\b(festplatte|platte|volume|ordner|dateien|unterlagen|importier|lies|lese|lern|zeig|liste|was liegt|inhalt)\b/i.test(value)
  ) {
    return true;
  }
  return false;
}

export type NamedVolumeHit = {
  name: string;
  path: string | null;
  mounted: boolean;
};

export function detectNamedVolume(text: string): NamedVolumeHit | null {
  const value = text.trim();
  if (!value) return null;
  for (const name of configuredExternalVolumeNames()) {
    if (!mentionsVolumeDisk(value, name)) continue;
    const root = volumeMountPath(name);
    const mounted = (() => {
      try {
        return fs.existsSync(root) && fs.statSync(root).isDirectory();
      } catch {
        return false;
      }
    })();
    return { name, path: mounted ? path.resolve(root) : null, mounted };
  }
  const volumesPath = value.match(/\/Volumes\/([^/\s"'`]+)/);
  if (volumesPath?.[1] && isAllowedVolumeName(volumesPath[1])) {
    const name = volumesPath[1];
    if (!configuredExternalVolumeNames().some((item) => item.toLowerCase() === name.toLowerCase())) {
      return null;
    }
  }
  return null;
}

export function namedVolumePaths(text: string): string[] {
  const hit = detectNamedVolume(text);
  if (hit?.path) return [hit.path];
  return [];
}

export function unmountedVolumeMessage(hit: NamedVolumeHit): string {
  return `Die Festplatte ${hit.name} ist gerade nicht eingehängt. Es wurde nichts gelesen.`;
}
