import { spawn } from "node:child_process";
import { classifyShellCommand } from "@/lib/computer/risk";
import { resolveWorkspacePath, assertWritablePath, assertExistingPath } from "@/lib/computer/paths";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { redactSecrets } from "@/lib/computer/redaction";
import type { ShellAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

const ALLOWED_BINS = new Set([
  "git",
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
  "npm",
  "npx",
  "node",
  "tsc",
  "eslint",
  "open",
  "stat",
  "file",
  "curl",
]);

const OUTPUT_LIMIT = 80_000;

export async function executeShellAction(input: {
  payload: ShellAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const argv = input.payload.argv;
  const bin = argv[0]?.split("/").pop() ?? "";
  const risk = classifyShellCommand({ argv, cwd: input.payload.cwd, userCommissioned: input.userCommissioned });

  if (risk.hardBlocked) {
    return failedResult({
      tool: "shell",
      action: "execute",
      startedAt,
      riskLevel: risk.risk,
      code: risk.hardBlockCode ?? "hard_block",
      message: risk.reason,
      approvalRequired: true,
      target: argv.join(" "),
    });
  }

  if (!ALLOWED_BINS.has(bin)) {
    return failedResult({
      tool: "shell",
      action: "execute",
      startedAt,
      riskLevel: "SYSTEM_CHANGE",
      code: "bin_not_allowed",
      message: `Befehl '${bin}' ist nicht in der erlaubten Shell-Liste.`,
      approvalRequired: true,
      target: argv.join(" "),
    });
  }

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "shell",
      action: "execute",
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
      target: argv.join(" "),
    });
  }

  const cwdResolved = resolveWorkspacePath({ requested: input.payload.cwd });
  try {
    assertWritablePath(cwdResolved);
    assertExistingPath(cwdResolved);
  } catch (error) {
    return failedResult({
      tool: "shell",
      action: "execute",
      startedAt,
      riskLevel: risk.risk,
      code: "cwd_invalid",
      message: error instanceof Error ? error.message : "cwd ungültig",
      target: input.payload.cwd,
    });
  }

  const timeoutMs = input.payload.timeoutMs ?? 30_000;
  try {
    const result = await runArgv({
      argv,
      cwd: cwdResolved.resolved,
      timeoutMs,
      signal: input.signal,
      env: input.payload.env,
    });
    const stdout = redactSecrets(result.stdout).slice(0, OUTPUT_LIMIT);
    const stderr = redactSecrets(result.stderr).slice(0, OUTPUT_LIMIT);
    const success = result.code === 0 && !result.cancelled;
    return createActionResult({
      tool: "shell",
      action: "execute",
      startedAt,
      success,
      riskLevel: risk.risk,
      approvalRequired: false,
      target: `${argv.join(" ")} @ ${cwdResolved.resolved}`,
      result: {
        argv,
        cwd: cwdResolved.resolved,
        purpose: input.payload.purpose,
        code: result.code,
        stdout,
        stderr,
        truncated: result.stdout.length > OUTPUT_LIMIT || result.stderr.length > OUTPUT_LIMIT,
        cancelled: result.cancelled,
      },
      verification: {
        verified: success,
        method: "exit_code",
        details: result.cancelled ? "Abgebrochen" : `exit ${result.code}`,
      },
    });
  } catch (error) {
    return failedResult({
      tool: "shell",
      action: "execute",
      startedAt,
      riskLevel: risk.risk,
      code: "shell_error",
      message: error instanceof Error ? error.message : "Shell-Fehler",
      target: argv.join(" "),
    });
  }
}

export function runArgv(input: {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
}): Promise<{ code: number; stdout: string; stderr: string; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.argv[0], input.argv.slice(1), {
      cwd: input.cwd,
      env: { ...process.env, ...input.env, NOVA_DESKTOP_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > OUTPUT_LIMIT * 2) stdout = stdout.slice(-OUTPUT_LIMIT);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > OUTPUT_LIMIT * 2) stderr = stderr.slice(-OUTPUT_LIMIT);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? 1, stdout, stderr, cancelled });
    });
  });
}
