import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { classifyComputerAction } from "@/lib/computer/risk";
import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { resolveWorkspacePath, assertWritablePath, assertExistingPath } from "@/lib/computer/paths";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { redactSecrets } from "@/lib/computer/redaction";
import { runArgv } from "@/services/desktop-service/adapters/shell";
import type { CursorAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export type CursorDiscovery = {
  available: boolean;
  bin: string | null;
  kind: "agent-cli" | "cursor-bin" | "unavailable";
  version?: string;
  reason: string;
};

const POLICY = [
  "NO PUSH",
  "NO DEPLOY",
  "Keine Production-Datenbank mutieren.",
  "Keine Secrets rotieren.",
  "Kein force push.",
  "Kein Repository löschen.",
].join(" ");

let cached: CursorDiscovery | null = null;

function whichSync(bin: string): string | null {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of paths) {
    const candidate = path.join(dir, bin);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function discoverCursor(force = false): Promise<CursorDiscovery> {
  if (cached && !force) return cached;
  const envBin = process.env.NOVA_CURSOR_AGENT_BIN?.trim();
  const agentCandidates = [envBin, whichSync("agent"), whichSync("cursor-agent")].filter(
    (item): item is string => Boolean(item),
  );

  for (const bin of agentCandidates) {
    const help = await runArgv({ argv: [bin, "--help"], cwd: process.cwd(), timeoutMs: 4000 }).catch(() => null);
    if (!help) continue;
    const text = `${help.stdout}\n${help.stderr}`;
    if (isElectronGuiHelp(text)) continue;
    if (looksLikeAgentCli(text) || path.basename(bin).includes("agent")) {
      cached = {
        available: true,
        bin,
        kind: "agent-cli",
        version: text.split("\n")[0]?.slice(0, 120),
        reason: `Cursor Agent CLI gefunden: ${bin}`,
      };
      return cached;
    }
  }

  const cursorBins = [whichSync("cursor"), "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"].filter(
    (item): item is string => Boolean(item),
  );
  for (const bin of cursorBins) {
    const help = await runArgv({ argv: [bin, "agent", "--help"], cwd: process.cwd(), timeoutMs: 4000 }).catch(() => null);
    if (!help) continue;
    const text = `${help.stdout}\n${help.stderr}`;
    if (isElectronGuiHelp(text) || !looksLikeAgentCli(text)) continue;
    cached = {
      available: true,
      bin,
      kind: "cursor-bin",
      version: text.split("\n")[0]?.slice(0, 120),
      reason: `Cursor Agent Subcommand gefunden: ${bin} agent`,
    };
    return cached;
  }

  cached = {
    available: false,
    bin: null,
    kind: "unavailable",
    reason:
      "Cursor Agent CLI ist auf diesem Mac nicht verfügbar. Der Editor unter /Applications/Cursor.app reicht dafür nicht.",
  };
  return cached;
}

function isElectronGuiHelp(text: string): boolean {
  return /Electron\/Chromium|not in the list of known options/i.test(text);
}

function looksLikeAgentCli(text: string): boolean {
  return /--print|print mode|workspace|--output-format|cursor agent/i.test(text) && !isElectronGuiHelp(text);
}

export async function executeCursorAction(input: {
  payload: CursorAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const discovery = await discoverCursor();
  const risk = classifyComputerAction({
    tool: "cursor",
    action: input.payload.action,
    target: "workspace" in input.payload ? input.payload.workspace : undefined,
    userCommissioned: input.userCommissioned,
  });

  if (input.payload.action === "available") {
    return createActionResult({
      tool: "cursor",
      action: "available",
      startedAt,
      success: true,
      riskLevel: "READ_ONLY",
      approvalRequired: false,
      result: discovery,
      verification: { verified: true, method: "probe", details: discovery.reason },
    });
  }

  if (!discovery.available || !discovery.bin) {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "cursor_unavailable",
      message: discovery.reason,
    });
  }

  const task =
    input.payload.action === "ask"
      ? input.payload.question
      : input.payload.action === "status"
        ? input.payload.jobId
        : "task" in input.payload
          ? input.payload.task
          : "";
  const hard = detectHardBlock(task);
  if (hard) {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: "EXTERNAL_SIDE_EFFECT",
      code: hard.code,
      message: hard.message,
      approvalRequired: true,
    });
  }

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
    });
  }

  if (input.payload.action === "status") {
    return failedResult({
      tool: "cursor",
      action: "status",
      startedAt,
      riskLevel: "READ_ONLY",
      code: "not_implemented",
      message: "Persistente Cursor-Job-Statusabfrage ist noch nicht angebunden.",
      metadata: { status: "NOT_IMPLEMENTED" },
    });
  }

  const workspacePath = "workspace" in input.payload ? input.payload.workspace : process.cwd();
  const resolved = resolveWorkspacePath({ requested: workspacePath });
  try {
    assertWritablePath(resolved);
    assertExistingPath(resolved);
  } catch (error) {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "workspace_invalid",
      message: error instanceof Error ? error.message : "Workspace ungültig",
    });
  }

  const prompt = [
    POLICY,
    input.payload.action === "plan" ? "Erstelle nur einen Plan, keine Änderungen." : "",
    input.payload.action === "ask" ? "Antworte nur, ändere keinen Code." : "",
    "task" in input.payload && input.payload.action === "agent"
      ? `Constraints: ${(input.payload.constraints ?? []).join("; ")}`
      : "",
    task,
  ]
    .filter(Boolean)
    .join("\n");

  const argv = buildCursorArgv(discovery, prompt, input.payload.action);
  try {
    const result = await runCursor(discovery.bin, argv, resolved.resolved, input.signal);
    const output = redactSecrets(result.stdout || result.stderr).slice(0, 20_000);
    if (isElectronGuiHelp(output)) {
      return failedResult({
        tool: "cursor",
        action: input.payload.action,
        startedAt,
        riskLevel: risk.risk,
        code: "cursor_unavailable",
        message: "Die gefundene Cursor-Binary ist der Editor, nicht die Agent CLI. Es wurde keine Agent-Antwort empfangen.",
        target: resolved.resolved,
      });
    }
    const success = result.code === 0 && !result.cancelled && output.trim().length > 0;
    return createActionResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      success,
      riskLevel: risk.risk,
      approvalRequired: false,
      target: resolved.resolved,
      result: {
        bin: discovery.bin,
        argv: argv.map((part, index) => (index === argv.length - 1 ? "[prompt]" : part)),
        code: result.code,
        output,
        cancelled: result.cancelled,
      },
      verification: {
        verified: success,
        method: "cursor_cli",
        details: result.cancelled ? "Abgebrochen" : `exit ${result.code}`,
      },
    });
  } catch (error) {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "cursor_error",
      message: error instanceof Error ? error.message : "Cursor CLI Fehler",
      target: resolved.resolved,
    });
  }
}

function buildCursorArgv(discovery: CursorDiscovery, prompt: string, action: CursorAction["action"]): string[] {
  if (discovery.kind === "cursor-bin") {
    return ["agent", "-p", prompt, "--output-format", "text"];
  }
  if (action === "plan") return ["-p", prompt, "--output-format", "text"];
  return ["-p", prompt, "--output-format", "text"];
}

function runCursor(
  bin: string,
  argv: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd,
      env: { ...process.env, NOVA_DESKTOP_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      child.kill("SIGKILL");
    }, 90_000);
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 80_000) stdout = stdout.slice(-40_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? 1, stdout, stderr, cancelled });
    });
  });
}
