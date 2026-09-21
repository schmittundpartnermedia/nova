import http from "node:http";
import { capabilitiesFrom, ensureNativeHelper, readMacPermissions } from "@/lib/computer/capabilities";
import {
  assertLoopbackHost,
  desktopPidPath,
  getDesktopListenHost,
  getDesktopListenPort,
  readOrCreateDesktopToken,
} from "@/lib/computer/config";
import { DESKTOP_SERVICE_VERSION } from "@/lib/computer/types";
import { extractBearer, getExpectedToken, isLoopbackAddress, tokensEqual } from "@/services/desktop-service/auth";
import { desktopJobs } from "@/services/desktop-service/jobs";
import { logDesktop } from "@/services/desktop-service/logger";
import { routeDesktopAction } from "@/services/desktop-service/router";
import { playwrightAvailable } from "@/services/desktop-service/adapters/browser";
import { discoverCursor } from "@/services/desktop-service/adapters/cursor";
import type { ComputerActionEnvelope } from "@/lib/computer/schemas";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const started = Date.now();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    json(res, 403, { ok: false, error: "Nur lokale Verbindungen sind erlaubt." });
    return false;
  }
  const token = extractBearer(req);
  if (!token || !tokensEqual(token, getExpectedToken())) {
    json(res, 401, { ok: false, error: "Unauthentifiziert." });
    return false;
  }
  return true;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1_000_000) throw new Error("Request zu groß.");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function capabilitiesPayload() {
  const [permissions, playwright, cursor] = await Promise.all([
    readMacPermissions(),
    playwrightAvailable(),
    discoverCursor(),
  ]);
  const helper = await ensureNativeHelper();
  return {
    ok: true,
    permissions,
    helper,
    capabilities: capabilitiesFrom({
      permissions,
      playwright,
      cursor: cursor.available,
      helper: helper.ok,
      platform: os.platform(),
    }),
  };
}

export function createDesktopServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        if (!requireAuth(req, res)) return;
        json(res, 200, {
          ok: true,
          service: "nova-desktop",
          version: DESKTOP_SERVICE_VERSION,
          listen: `${getDesktopListenHost()}:${getDesktopListenPort()}`,
          pid: process.pid,
          uptimeMs: Date.now() - started,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/capabilities") {
        if (!requireAuth(req, res)) return;
        json(res, 200, await capabilitiesPayload());
        return;
      }
      if (req.method === "GET" && url.pathname === "/permissions") {
        if (!requireAuth(req, res)) return;
        json(res, 200, { ok: true, permissions: await readMacPermissions() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/jobs/cancel") {
        if (!requireAuth(req, res)) return;
        const body = (await readBody(req)) as { jobId?: string };
        const ids = body.jobId ? [body.jobId] : desktopJobs.abortAll();
        if (body.jobId) desktopJobs.abort(body.jobId);
        json(res, 200, { ok: true, cancelled: ids, status: "CANCELLED_BY_USER" });
        return;
      }

      const actionRoutes: Record<string, ComputerActionEnvelope["tool"]> = {
        "/filesystem/action": "filesystem",
        "/shell/action": "shell",
        "/cursor/action": "cursor",
        "/browser/action": "browser",
        "/application/action": "application",
        "/process/action": "process",
        "/screen/action": "screen",
        "/accessibility/action": "accessibility",
      };

      if (req.method === "POST" && (url.pathname in actionRoutes || url.pathname === "/computer/action")) {
        if (!requireAuth(req, res)) return;
        const body = await readBody(req);
        const envelope =
          url.pathname === "/computer/action"
            ? body
            : {
                ...(typeof body === "object" && body ? body : {}),
                tool: actionRoutes[url.pathname],
                payload:
                  typeof body === "object" && body && "payload" in body
                    ? (body as { payload: unknown }).payload
                    : body,
              };
        const record = envelope as { jobId?: string; organizationId?: string; userCommissioned?: boolean };
        if (!record.organizationId) {
          json(res, 400, { ok: false, error: "organizationId ist Pflicht." });
          return;
        }
        const jobId = record.jobId ?? `ad-hoc-${Date.now()}`;
        const controller = desktopJobs.create(jobId);
        logDesktop("action.start", { jobId, path: url.pathname, organizationId: record.organizationId });
        const result = await routeDesktopAction({
          envelope,
          userCommissioned: record.userCommissioned === true,
          signal: controller.signal,
        });
        desktopJobs.cancel(jobId);
        logDesktop("action.finish", {
          jobId,
          success: result.success,
          tool: result.tool,
          action: result.action,
        });
        json(res, result.success ? 200 : 409, result);
        return;
      }

      json(res, 404, { ok: false, error: "Unbekannte Route." });
    } catch (error) {
      logDesktop("error", { message: error instanceof Error ? error.message : "unbekannt" });
      json(res, 500, { ok: false, error: "Interner Desktop-Service-Fehler." });
    }
  });
  return server;
}

export async function startDesktopService(): Promise<http.Server> {
  const host = getDesktopListenHost();
  assertLoopbackHost(host);
  const port = getDesktopListenPort();
  readOrCreateDesktopToken();
  await ensureNativeHelper();
  const server = createDesktopServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });
  fs.mkdirSync(path.dirname(desktopPidPath()), { recursive: true });
  fs.writeFileSync(desktopPidPath(), String(process.pid));
  logDesktop("listen", { host, port, pid: process.pid });
  return server;
}
