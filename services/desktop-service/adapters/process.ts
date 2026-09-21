import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ownedProcessPath } from "@/lib/computer/config";
import { classifyComputerAction } from "@/lib/computer/risk";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { resolveWorkspacePath, assertWritablePath, assertExistingPath } from "@/lib/computer/paths";
import { runArgv } from "@/services/desktop-service/adapters/shell";
import type { ProcessAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

type OwnedRecord = { pid: number; argv: string[]; cwd: string; startedAt: string; purpose: string };

function loadOwned(): OwnedRecord[] {
  const file = ownedProcessPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OwnedRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOwned(records: OwnedRecord[]): void {
  fs.mkdirSync(path.dirname(ownedProcessPath()), { recursive: true });
  fs.writeFileSync(ownedProcessPath(), JSON.stringify(records, null, 2));
}

function isOwned(pid: number): boolean {
  return loadOwned().some((item) => item.pid === pid);
}

export async function executeProcessAction(input: {
  payload: ProcessAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const risk = classifyComputerAction({
    tool: "process",
    action: input.payload.action,
    argv: input.payload.action === "start" ? input.payload.argv : undefined,
    userCommissioned: input.userCommissioned,
  });

  if (risk.hardBlocked) {
    return failedResult({
      tool: "process",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: risk.hardBlockCode ?? "hard_block",
      message: risk.reason,
      approvalRequired: true,
    });
  }

  const payload = input.payload;
  try {
    switch (payload.action) {
      case "list": {
        const listed = await listProcesses(payload.query);
        return createActionResult({
          tool: "process",
          action: "list",
          startedAt,
          success: true,
          riskLevel: "READ_ONLY",
          approvalRequired: false,
          result: { processes: listed },
          verification: { verified: true, method: "ps", details: `${listed.length} Prozesse` },
        });
      }
      case "inspect": {
        const listed = await listProcesses(String(payload.pid));
        const match = listed.find((item) => item.pid === payload.pid) ?? null;
        return createActionResult({
          tool: "process",
          action: "inspect",
          startedAt,
          success: Boolean(match),
          riskLevel: "READ_ONLY",
          approvalRequired: false,
          target: String(payload.pid),
          result: { process: match, owned: isOwned(payload.pid) },
          verification: { verified: Boolean(match), method: "ps" },
        });
      }
      case "start": {
        if (risk.approvalRequired && !input.approvalToken) {
          return failedResult({
            tool: "process",
            action: "start",
            startedAt,
            riskLevel: risk.risk,
            code: "approval_required",
            message: risk.reason,
            approvalRequired: true,
            target: payload.argv.join(" "),
          });
        }
        const cwd = resolveWorkspacePath({ requested: payload.cwd });
        assertWritablePath(cwd);
        assertExistingPath(cwd);
        const child = spawn(payload.argv[0], payload.argv.slice(1), {
          cwd: cwd.resolved,
          detached: true,
          stdio: "ignore",
          env: { ...process.env, NOVA_DESKTOP_TOKEN: "" },
        });
        const pid = child.pid;
        if (!pid) throw new Error("Prozess konnte nicht gestartet werden.");
        child.unref();
        const owned = loadOwned();
        owned.push({
          pid,
          argv: payload.argv,
          cwd: cwd.resolved,
          startedAt: new Date().toISOString(),
          purpose: payload.purpose,
        });
        saveOwned(owned);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const still = processExists(pid);
        return createActionResult({
          tool: "process",
          action: "start",
          startedAt,
          success: still,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: String(pid),
          result: { pid, argv: payload.argv, cwd: cwd.resolved, owned: true },
          verification: { verified: still, method: "pid_alive", details: still ? `PID ${pid} läuft` : "Prozess beendet sich sofort" },
        });
      }
      case "stop": {
        const owned = isOwned(payload.pid);
        if (!owned && !input.approvalToken) {
          return failedResult({
            tool: "process",
            action: "stop",
            startedAt,
            riskLevel: "SYSTEM_CHANGE",
            code: "approval_required",
            message: "Fremde oder kritische Prozesse werden nur mit Freigabe beendet.",
            approvalRequired: true,
            target: String(payload.pid),
          });
        }
        try {
          process.kill(payload.pid, "SIGTERM");
        } catch (error) {
          return failedResult({
            tool: "process",
            action: "stop",
            startedAt,
            riskLevel: risk.risk,
            code: "kill_failed",
            message: error instanceof Error ? error.message : "kill fehlgeschlagen",
            target: String(payload.pid),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (processExists(payload.pid)) {
          try {
            process.kill(payload.pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        const gone = !processExists(payload.pid);
        saveOwned(loadOwned().filter((item) => item.pid !== payload.pid));
        return createActionResult({
          tool: "process",
          action: "stop",
          startedAt,
          success: gone,
          riskLevel: risk.risk,
          approvalRequired: !owned,
          target: String(payload.pid),
          result: { pid: payload.pid, owned, stopped: gone },
          verification: { verified: gone, method: "pid_alive" },
        });
      }
    }
  } catch (error) {
    return failedResult({
      tool: "process",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "process_error",
      message: error instanceof Error ? error.message : "Prozessfehler",
    });
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listProcesses(query?: string): Promise<Array<{ pid: number; command: string; ports: number[] }>> {
  const ps = await runArgv({
    argv: ["ps", "-axo", "pid=,command="],
    cwd: process.cwd(),
    timeoutMs: 8000,
  });
  const lsof = await runArgv({
    argv: ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
    cwd: process.cwd(),
    timeoutMs: 8000,
  });
  const portsByPid = new Map<number, number[]>();
  for (const line of lsof.stdout.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[1]);
    const name = parts[parts.length - 2] ?? "";
    const portMatch = name.match(/:(\d+)$/);
    if (!Number.isFinite(pid) || !portMatch) continue;
    const port = Number(portMatch[1]);
    const current = portsByPid.get(pid) ?? [];
    current.push(port);
    portsByPid.set(pid, current);
  }
  const needle = query?.toLowerCase();
  const rows: Array<{ pid: number; command: string; ports: number[] }> = [];
  for (const line of ps.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!split) continue;
    const pid = Number(split[1]);
    const command = split[2];
    if (needle && !command.toLowerCase().includes(needle) && !String(pid).includes(needle)) continue;
    rows.push({ pid, command, ports: portsByPid.get(pid) ?? [] });
    if (rows.length >= 80) break;
  }
  return rows;
}
