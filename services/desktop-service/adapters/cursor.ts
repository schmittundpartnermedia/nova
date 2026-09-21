import { spawn } from "node:child_process";
import { classifyComputerAction } from "@/lib/computer/risk";
import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { resolveWorkspacePath, assertWritablePath, assertExistingPath } from "@/lib/computer/paths";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { redactSecrets } from "@/lib/computer/redaction";
import { runArgv } from "@/services/desktop-service/adapters/shell";
import {
  buildAgentCliArgv,
  buildCursorPrompt,
  defaultCursorTimeoutMs,
  isElectronGuiHelp,
  looksLikeAgentCli,
  parseCreateChatId,
  parseCursorAuth,
  parseCursorCliOutput,
  wellKnownAgentBins,
  wellKnownCursorEditorBins,
} from "@/lib/computer/cursor-cli";
import type { CursorAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export type CursorDiscovery = {
  available: boolean;
  bin: string | null;
  kind: "agent-cli" | "cursor-bin" | "unavailable";
  version?: string;
  authenticated?: boolean;
  authMessage?: string;
  supportsResume: boolean;
  reason: string;
};

let cached: CursorDiscovery | null = null;

export async function discoverCursor(force = false): Promise<CursorDiscovery> {
  if (cached && !force) return cached;

  for (const bin of wellKnownAgentBins()) {
    const help = await runArgv({ argv: [bin, "--help"], cwd: process.cwd(), timeoutMs: 4000 }).catch(() => null);
    if (!help) continue;
    const text = `${help.stdout}\n${help.stderr}`;
    if (isElectronGuiHelp(text)) continue;
    if (looksLikeAgentCli(text) || /agent/i.test(bin)) {
      const version = await readVersion(bin);
      const auth = await readAuth(bin);
      cached = {
        available: true,
        bin,
        kind: "agent-cli",
        version,
        authenticated: auth.authenticated,
        authMessage: auth.message,
        supportsResume: /--resume/i.test(text),
        reason: `Cursor Agent CLI gefunden: ${bin}${auth.authenticated ? "" : " (nicht angemeldet)"}`,
      };
      return cached;
    }
  }

  for (const bin of wellKnownCursorEditorBins()) {
    const help = await runArgv({ argv: [bin, "agent", "--help"], cwd: process.cwd(), timeoutMs: 4000 }).catch(() => null);
    if (!help) continue;
    const text = `${help.stdout}\n${help.stderr}`;
    if (isElectronGuiHelp(text) || !looksLikeAgentCli(text)) continue;
    const auth = await readAuth(bin, ["agent"]);
    cached = {
      available: true,
      bin,
      kind: "cursor-bin",
      version: text.split("\n")[0]?.slice(0, 120),
      authenticated: auth.authenticated,
      authMessage: auth.message,
      supportsResume: /--resume/i.test(text),
      reason: `Cursor Agent Subcommand gefunden: ${bin} agent`,
    };
    return cached;
  }

  cached = {
    available: false,
    bin: null,
    kind: "unavailable",
    supportsResume: false,
    reason:
      "Cursor Agent CLI ist auf diesem Mac nicht verfügbar. Der Editor unter /Applications/Cursor.app reicht dafür nicht.",
  };
  return cached;
}

async function readVersion(bin: string): Promise<string | undefined> {
  const result = await runArgv({ argv: [bin, "--version"], cwd: process.cwd(), timeoutMs: 4000 }).catch(() => null);
  const text = result?.stdout.trim() || result?.stderr.trim();
  return text?.split("\n")[0]?.slice(0, 80);
}

async function readAuth(bin: string, prefix: string[] = []) {
  const result = await runArgv({
    argv: [bin, ...prefix, "status", "--format", "json"],
    cwd: process.cwd(),
    timeoutMs: 4000,
  }).catch(() => null);
  if (!result) return { authenticated: false, message: "Auth-Status unbekannt" };
  return parseCursorAuth(result.stdout, result.stderr);
}

export async function executeCursorAction(input: {
  payload: CursorAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
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

  if (input.payload.action === "status") {
    const status = await runArgv({
      argv: discovery.kind === "cursor-bin" ? [discovery.bin, "agent", "persist", "list"] : [discovery.bin, "persist", "list"],
      cwd: process.cwd(),
      timeoutMs: 8_000,
    }).catch(() => null);
    return createActionResult({
      tool: "cursor",
      action: "status",
      startedAt,
      success: true,
      riskLevel: "READ_ONLY",
      approvalRequired: false,
      result: {
        discovery,
        requested: input.payload.sessionId ?? input.payload.jobId ?? null,
        persist: redactSecrets((status?.stdout || status?.stderr || "").slice(0, 4000)),
      },
      verification: { verified: true, method: "cursor_status", details: discovery.reason },
    });
  }

  if (discovery.authenticated !== true && input.payload.action !== "stop") {
    return failedResult({
      tool: "cursor",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "cursor_unauthenticated",
      message:
        discovery.authMessage === "Not logged in"
          ? "Cursor Agent CLI ist installiert, aber nicht angemeldet. Einmaliger Schritt: `agent login`."
          : discovery.authMessage || "Cursor Agent CLI ist nicht angemeldet.",
      metadata: { status: "UNAUTHENTICATED", bin: discovery.bin, version: discovery.version },
    });
  }

  const task = taskFromPayload(input.payload);
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

  if (input.payload.action === "stop") {
    return stopCursorSession(discovery, input.payload.sessionId, startedAt, input.signal);
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

  if (input.payload.action === "createSession") {
    const argv =
      discovery.kind === "cursor-bin" ? ["agent", "create-chat"] : ["create-chat"];
    try {
      const result = await runCursor(discovery.bin, argv, resolved.resolved, input.signal, 8_000);
      const sessionId = parseCreateChatId(result.stdout, result.stderr);
      const success = Boolean(sessionId);
      return createActionResult({
        tool: "cursor",
        action: "createSession",
        startedAt,
        success,
        riskLevel: "READ_ONLY",
        approvalRequired: false,
        target: resolved.resolved,
        result: {
          sessionId: sessionId ?? null,
          output: redactSecrets((result.stdout || result.stderr).slice(0, 2000)),
        },
        verification: {
          verified: success,
          method: "cursor_create_chat",
          details: sessionId ? `chat ${sessionId}` : "Keine Chat-ID erhalten",
        },
      });
    } catch (error) {
      return failedResult({
        tool: "cursor",
        action: "createSession",
        startedAt,
        riskLevel: "READ_ONLY",
        code: "cursor_error",
        message: error instanceof Error ? error.message : "Cursor create-chat fehlgeschlagen",
        target: resolved.resolved,
      });
    }
  }

  const runAction =
    input.payload.action === "resume"
      ? "resume"
      : input.payload.action === "ask"
        ? "ask"
        : input.payload.action === "plan"
          ? "plan"
          : "agent";
  const resumeSessionId =
    input.payload.action === "resume"
      ? input.payload.sessionId
      : "resumeSessionId" in input.payload
        ? input.payload.resumeSessionId
        : undefined;
  const prompt = buildCursorPrompt({
    action: runAction,
    task,
    constraints: input.payload.action === "agent" ? input.payload.constraints : undefined,
  });
  const argv = buildAgentCliArgv({
    kind: discovery.kind === "cursor-bin" ? "cursor-bin" : "agent-cli",
    action: runAction,
    prompt,
    workspace: resolved.resolved,
    resumeSessionId,
  });
  const timeoutMs =
    ("timeoutMs" in input.payload ? input.payload.timeoutMs : undefined) ??
    input.timeoutMs ??
    defaultCursorTimeoutMs(input.payload.action);

  try {
    const result = await runCursor(discovery.bin, argv, resolved.resolved, input.signal, timeoutMs);
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
    const parsed = parseCursorCliOutput(result.stdout, result.stderr);
    const authError = /authentication required|not logged in|cursor_api_key/i.test(`${result.stdout}\n${result.stderr}\n${parsed.text}`);
    if (authError) {
      return failedResult({
        tool: "cursor",
        action: input.payload.action,
        startedAt,
        riskLevel: risk.risk,
        code: "cursor_unauthenticated",
        message: "Cursor Agent CLI ist installiert, aber nicht angemeldet. Einmaliger Schritt: `agent login`.",
        target: resolved.resolved,
        metadata: { status: "UNAUTHENTICATED", bin: discovery.bin, version: discovery.version },
      });
    }
    const success = result.code === 0 && !result.cancelled && parsed.text.trim().length > 0 && !parsed.error;
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
        output: redactSecrets(parsed.text).slice(0, 12_000),
        sessionId: parsed.sessionId ?? resumeSessionId ?? null,
        cancelled: result.cancelled,
      },
      verification: {
        verified: success,
        method: "cursor_cli",
        details: result.cancelled ? "Abgebrochen" : parsed.error ?? `exit ${result.code}`,
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

async function stopCursorSession(
  discovery: CursorDiscovery,
  sessionId: string | undefined,
  startedAt: Date,
  signal?: AbortSignal,
): Promise<ActionResult> {
  if (!discovery.bin) {
    return failedResult({
      tool: "cursor",
      action: "stop",
      startedAt,
      riskLevel: "SYSTEM_CHANGE",
      code: "cursor_unavailable",
      message: discovery.reason,
    });
  }
  const argv = sessionId
    ? discovery.kind === "cursor-bin"
      ? ["agent", "persist", "stop", sessionId]
      : ["persist", "stop", sessionId]
    : [];
  let persistOutput = "";
  if (argv.length > 0) {
    const stopped = await runCursor(discovery.bin, argv, process.cwd(), signal, 8_000).catch(() => null);
    persistOutput = redactSecrets((stopped?.stdout || stopped?.stderr || "").slice(0, 2000));
  }
  return createActionResult({
    tool: "cursor",
    action: "stop",
    startedAt,
    success: true,
    riskLevel: "SYSTEM_CHANGE",
    approvalRequired: false,
    result: {
      sessionId: sessionId ?? null,
      persist: persistOutput,
      note: "Laufende Cursor-Prozesse werden über den Desktop-Job abgebrochen. Änderungen werden nicht gelöscht.",
    },
    verification: { verified: true, method: "cursor_stop", details: sessionId ? `stop ${sessionId}` : "kein persist-stop" },
  });
}

function taskFromPayload(payload: CursorAction): string {
  if (payload.action === "ask") return payload.question;
  if (payload.action === "status") return payload.jobId ?? payload.sessionId ?? "";
  if (payload.action === "stop") return payload.sessionId ?? "";
  if ("task" in payload) return payload.task;
  return "";
}

function runCursor(
  bin: string,
  argv: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
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
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 120_000) stdout = stdout.slice(-60_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 80_000) stderr = stderr.slice(-40_000);
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
