import fs from "node:fs/promises";
import path from "node:path";
import { classifyFilesystemAction } from "@/lib/computer/risk";
import { assertExistingPath, assertWritablePath, resolveWorkspacePath } from "@/lib/computer/paths";
import { failedResult, createActionResult } from "@/lib/computer/result";
import { redactEnvFile, redactSecrets, shouldRedactFilePath } from "@/lib/computer/redaction";
import { isHardBlockedPath } from "@/lib/computer/hard-blocks";
import type { FilesystemAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

const TEXT_MAX = 200_000;

function isProbablyText(filePath: string): boolean {
  return /\.(md|txt|ts|tsx|js|jsx|json|css|html|xml|yml|yaml|toml|prisma|mjs|cjs|sh|env|svg)$/i.test(filePath) ||
    path.basename(filePath).startsWith(".");
}

export async function executeFilesystemAction(input: {
  payload: FilesystemAction;
  userCommissioned: boolean;
  approvalToken?: string;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const action = input.payload.action;
  const target =
    "path" in input.payload
      ? input.payload.path
      : "from" in input.payload
        ? input.payload.from
        : "root" in input.payload
          ? input.payload.root
          : "";
  const risk = classifyFilesystemAction({
    action: action === "delete" && input.payload.action === "delete" && input.payload.recursive ? "deleteRecursive" : action,
    target,
    userCommissioned: input.userCommissioned,
  });

  if (risk.hardBlocked) {
    return failedResult({
      tool: "filesystem",
      action,
      startedAt,
      riskLevel: risk.risk,
      code: risk.hardBlockCode ?? "hard_block",
      message: risk.reason,
      approvalRequired: true,
      target,
    });
  }

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "filesystem",
      action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
      target,
    });
  }

  try {
    switch (input.payload.action) {
      case "list": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        assertExistingPath(resolved);
        const entries = await fs.readdir(resolved.resolved, { withFileTypes: true });
        const items = entries.slice(0, input.payload.maxEntries ?? 200).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        }));
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: { path: resolved.resolved, entries: items, truncated: entries.length > items.length },
          verification: { verified: true, method: "readdir", details: `${items.length} Einträge` },
        });
      }
      case "stat": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        assertExistingPath(resolved);
        const stat = await fs.stat(resolved.resolved);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: {
            path: resolved.resolved,
            size: stat.size,
            isFile: stat.isFile(),
            isDirectory: stat.isDirectory(),
            mtime: stat.mtime.toISOString(),
          },
          verification: { verified: true, method: "stat" },
        });
      }
      case "read": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        assertExistingPath(resolved);
        if (isHardBlockedPath(resolved.resolved)) {
          throw new Error("Geschützte Datei.");
        }
        const stat = await fs.stat(resolved.resolved);
        if (!stat.isFile()) throw new Error("Kein Datei-Pfad.");
        const maxBytes = input.payload.maxBytes ?? TEXT_MAX;
        const buf = await fs.readFile(resolved.resolved);
        const slice = buf.subarray(0, maxBytes);
        let content = slice.toString("utf8");
        if (shouldRedactFilePath(resolved.resolved)) content = redactEnvFile(content);
        else content = redactSecrets(content);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: {
            path: resolved.resolved,
            bytes: slice.length,
            truncated: buf.length > maxBytes,
            content: isProbablyText(resolved.resolved) ? content : `[binary ${stat.size} bytes]`,
          },
          verification: { verified: true, method: "readFile", details: `${slice.length} Bytes gelesen` },
        });
      }
      case "search": {
        const resolved = resolveWorkspacePath({ requested: input.payload.root });
        assertWritablePath(resolved);
        assertExistingPath(resolved);
        const matches = await walkSearch(resolved.resolved, input.payload.query.toLowerCase(), input.payload.maxResults ?? 40);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: { root: resolved.resolved, query: input.payload.query, matches },
          verification: { verified: true, method: "walk", details: `${matches.length} Treffer` },
        });
      }
      case "mkdir": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        await fs.mkdir(resolved.resolved, { recursive: true });
        const exists = await existsPath(resolved.resolved);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: exists,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: { path: resolved.resolved },
          verification: { verified: exists, method: "stat", details: exists ? "Ordner existiert" : "Ordner nicht gefunden" },
        });
      }
      case "create":
      case "write":
      case "append": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        if (input.payload.action === "write" && (await existsPath(resolved.resolved))) {
          if (!input.approvalToken) {
            return failedResult({
              tool: "filesystem",
              action,
              startedAt,
              riskLevel: "WORKSPACE_WRITE",
              code: "overwrite_approval",
              message: "Bestehende Datei überschreiben braucht eine höhere Risikoklasse/Freigabe.",
              approvalRequired: true,
              target: resolved.resolved,
            });
          }
        }
        await fs.mkdir(path.dirname(resolved.resolved), { recursive: true });
        const content = "content" in input.payload ? (input.payload.content ?? "") : "";
        if (input.payload.action === "append") await fs.appendFile(resolved.resolved, content, "utf8");
        else await fs.writeFile(resolved.resolved, content, "utf8");
        const exists = await existsPath(resolved.resolved);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: exists,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: resolved.resolved,
          result: { path: resolved.resolved, bytes: Buffer.byteLength(content) },
          verification: { verified: exists, method: "stat" },
        });
      }
      case "copy":
      case "move":
      case "rename": {
        const from = resolveWorkspacePath({ requested: input.payload.from });
        const to = resolveWorkspacePath({ requested: input.payload.to });
        assertWritablePath(from);
        assertWritablePath(to);
        assertExistingPath(from);
        await fs.mkdir(path.dirname(to.resolved), { recursive: true });
        if (input.payload.action === "copy") await fs.copyFile(from.resolved, to.resolved);
        else await fs.rename(from.resolved, to.resolved);
        const exists = await existsPath(to.resolved);
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: exists,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: to.resolved,
          result: { from: from.resolved, to: to.resolved },
          verification: { verified: exists, method: "stat" },
        });
      }
      case "delete": {
        const resolved = resolveWorkspacePath({ requested: input.payload.path });
        assertWritablePath(resolved);
        assertExistingPath(resolved);
        if (input.payload.recursive) {
          await fs.rm(resolved.resolved, { recursive: true, force: false });
        } else {
          await fs.rm(resolved.resolved);
        }
        const gone = !(await existsPath(resolved.resolved));
        return createActionResult({
          tool: "filesystem",
          action,
          startedAt,
          success: gone,
          riskLevel: risk.risk,
          approvalRequired: true,
          target: resolved.resolved,
          result: { path: resolved.resolved, deleted: gone },
          verification: { verified: gone, method: "stat", details: gone ? "Pfad entfernt" : "Pfad existiert noch" },
        });
      }
      default:
        return failedResult({
          tool: "filesystem",
          action,
          startedAt,
          riskLevel: risk.risk,
          code: "unknown_action",
          message: "Unbekannte Dateisystemaktion.",
        });
    }
  } catch (error) {
    return failedResult({
      tool: "filesystem",
      action,
      startedAt,
      riskLevel: risk.risk,
      code: "filesystem_error",
      message: error instanceof Error ? error.message : "Dateisystemfehler",
      approvalRequired: risk.approvalRequired,
      target,
    });
  }
}

async function existsPath(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function walkSearch(root: string, query: string, maxResults: number): Promise<string[]> {
  const matches: string[] = [];
  const skip = new Set(["node_modules", ".git", ".next", "dist", "coverage"]);
  async function walk(dir: string, depth: number): Promise<void> {
    if (matches.length >= maxResults || depth > 8) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(query)) matches.push(full);
      if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(root, 0);
  return matches;
}
