import fs from "node:fs";
import path from "node:path";
import { assertOrganizationId } from "@/services/tenant";
import { defaultWorkspaceRoots, resolveWorkspacePath } from "@/lib/computer/paths";
import { isHardBlockedPath } from "@/lib/computer/hard-blocks";
import { redactSecrets, shouldRedactFilePath } from "@/lib/computer/redaction";
import type { StorageProvider } from "@/types/connectors";

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "coverage", ".Spotlight-V100", ".fseventsd", ".Trashes"]);

function walkMatches(root: string, query: string, maxResults: number): string[] {
  const matches: string[] = [];
  const needle = query.toLowerCase();
  const walk = (dir: string, depth: number) => {
    if (matches.length >= maxResults || depth > 8) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(needle)) matches.push(full);
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return matches;
}

export class LocalDiskStorageProvider implements StorageProvider {
  id = "local-disk";

  async search(organizationId: string, query: string): Promise<unknown[]> {
    assertOrganizationId(organizationId);
    const needle = query.trim();
    if (!needle) return [];
    const hits: string[] = [];
    for (const root of defaultWorkspaceRoots()) {
      if (!fs.existsSync(root)) continue;
      hits.push(...walkMatches(root, needle, 20));
      if (hits.length >= 40) break;
    }
    return hits.slice(0, 40).map((filePath) => ({ path: filePath, name: path.basename(filePath) }));
  }

  async read(organizationId: string, filePath: string): Promise<string | null> {
    assertOrganizationId(organizationId);
    const resolved = resolveWorkspacePath({ requested: filePath, mustExist: true });
    if (!resolved.withinAllowed || resolved.blocked || !resolved.exists) return null;
    if (isHardBlockedPath(resolved.resolved) || shouldRedactFilePath(resolved.resolved)) return null;
    try {
      const stat = fs.statSync(resolved.resolved);
      if (!stat.isFile() || stat.size > 200_000) return null;
      return redactSecrets(fs.readFileSync(resolved.resolved, "utf8"));
    } catch {
      return null;
    }
  }

  async create(organizationId: string, _input: { title: string; content: string }) {
    assertOrganizationId(organizationId);
    return {
      ok: false,
      executed: false,
      reason: "Lokale Platte ist lesend angebunden. Ohne konkreten Pfad schreibe ich nichts.",
    };
  }

  async getUrl(_organizationId: string, filePath: string): Promise<string | null> {
    const resolved = resolveWorkspacePath({ requested: filePath });
    if (!resolved.withinAllowed || !resolved.exists) return null;
    return resolved.resolved;
  }
}
