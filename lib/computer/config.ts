import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DESKTOP_DEFAULT_PORT = 47821;
export const DESKTOP_DEFAULT_HOST = "127.0.0.1";

function novaDir(): string {
  return path.join(process.cwd(), ".nova");
}

function tokenPath(): string {
  return path.join(novaDir(), "desktop-token");
}

export function getDesktopListenHost(): string {
  return process.env.NOVA_DESKTOP_HOST?.trim() || DESKTOP_DEFAULT_HOST;
}

export function getDesktopListenPort(): number {
  const raw = process.env.NOVA_DESKTOP_PORT?.trim();
  if (!raw) return DESKTOP_DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("NOVA_DESKTOP_PORT ist ungültig.");
  }
  return parsed;
}

export function getDesktopBaseUrl(): string {
  return `http://${getDesktopListenHost()}:${getDesktopListenPort()}`;
}

export function readOrCreateDesktopToken(): string {
  const fromEnv = process.env.NOVA_DESKTOP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = tokenPath();
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 24) return existing;
  }
  fs.mkdirSync(novaDir(), { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

export function desktopPidPath(): string {
  return path.join(novaDir(), "desktop-service.pid");
}

export function ownedProcessPath(): string {
  return path.join(novaDir(), "owned-pids.json");
}

export function ephemeralDir(): string {
  const dir = path.join(os.tmpdir(), "nova-desktop-ephemeral");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("NOVA Desktop Service darf nur lokal lauschen.");
  }
}
