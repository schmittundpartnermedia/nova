import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { desktopPidPath, getDesktopBaseUrl, readOrCreateDesktopToken } from "@/lib/computer/config";
import type { ActionResult, CapabilityRecord, PermissionSnapshot } from "@/lib/computer/types";
import type { ComputerActionEnvelope } from "@/lib/computer/schemas";

async function desktopFetch(pathname: string, init?: RequestInit): Promise<Response> {
  const token = readOrCreateDesktopToken();
  return fetch(`${getDesktopBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function desktopHealth(): Promise<boolean> {
  try {
    const response = await desktopFetch("/health", { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureDesktopService(): Promise<{ ok: boolean; mode: "existing" | "started" | "failed"; reason: string }> {
  if (await desktopHealth()) {
    return { ok: true, mode: "existing", reason: "Desktop Service läuft." };
  }
  const script = path.join(process.cwd(), "services/desktop-service/index.ts");
  const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", script], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  if (child.pid) {
    fs.mkdirSync(path.dirname(desktopPidPath()), { recursive: true });
    fs.writeFileSync(desktopPidPath(), String(child.pid));
    child.unref();
  }
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await desktopHealth()) {
      return { ok: true, mode: "started", reason: "Desktop Service gestartet." };
    }
  }
  return { ok: false, mode: "failed", reason: "Desktop Service konnte nicht gestartet werden." };
}

export async function fetchCapabilities(): Promise<{
  capabilities: CapabilityRecord[];
  permissions: PermissionSnapshot[];
}> {
  await ensureDesktopService();
  const response = await desktopFetch("/capabilities");
  const body = (await response.json()) as {
    capabilities?: CapabilityRecord[];
    permissions?: PermissionSnapshot[];
  };
  return {
    capabilities: body.capabilities ?? [],
    permissions: body.permissions ?? [],
  };
}

export async function runDesktopAction(envelope: ComputerActionEnvelope & { userCommissioned?: boolean }): Promise<ActionResult> {
  const ready = await ensureDesktopService();
  if (!ready.ok) {
    return {
      success: false,
      tool: envelope.tool,
      action: "connect",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      riskLevel: "SYSTEM_CHANGE",
      approvalRequired: false,
      error: { code: "desktop_unavailable", message: ready.reason },
      verification: { verified: false, method: "health", details: ready.reason },
    };
  }
  const response = await desktopFetch("/computer/action", {
    method: "POST",
    body: JSON.stringify(envelope),
  });
  return (await response.json()) as ActionResult;
}

export async function cancelDesktopJobs(jobId?: string): Promise<{ ok: boolean; status: string }> {
  try {
    await ensureDesktopService();
    const response = await desktopFetch("/jobs/cancel", {
      method: "POST",
      body: JSON.stringify({ jobId }),
    });
    return (await response.json()) as { ok: boolean; status: string };
  } catch {
    return { ok: false, status: "FAILED" };
  }
}
