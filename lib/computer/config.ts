import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DESKTOP_DEFAULT_PORT = 47821;
export const DESKTOP_DEFAULT_HOST = "127.0.0.1";
export const WEB_DEFAULT_PORT = 3100;
export const WEB_DEFAULT_HOST = "127.0.0.1";
export const WEB_PORT_SPAN = 100;

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

export function getWebListenHost(): string {
  return process.env.NOVA_WEB_HOST?.trim() || WEB_DEFAULT_HOST;
}

export function getWebListenPort(): number {
  const raw = process.env.NOVA_WEB_PORT?.trim() || process.env.PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }
  const fromFile = readBoundPortFile("web-port");
  if (fromFile) return fromFile;
  return WEB_DEFAULT_PORT;
}

export function getWebBaseUrl(): string {
  return `http://${getWebListenHost()}:${getWebListenPort()}`;
}

export function isNovaWebPort(port: number): boolean {
  return port >= WEB_DEFAULT_PORT && port < WEB_DEFAULT_PORT + WEB_PORT_SPAN;
}

function readBoundPortFile(name: string): number | null {
  try {
    const file = path.join(process.cwd(), ".nova", name);
    if (!fs.existsSync(file)) return null;
    const parsed = Number(fs.readFileSync(file, "utf8").trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
    return parsed;
  } catch {
    return null;
  }
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

export function playwrightBrowsersDir(): string {
  const fromEnv = process.env.NOVA_PLAYWRIGHT_BROWSERS?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(novaDir(), "ms-playwright");
}

export function applyPlaywrightBrowsersPath(): string {
  const dir = playwrightBrowsersDir();
  if (fs.existsSync(/* turbopackIgnore: true */ dir)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
  }
  return process.env.PLAYWRIGHT_BROWSERS_PATH ?? "";
}

export function browserProfileDir(): string {
  const fromEnv = process.env.NOVA_BROWSER_PROFILE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(novaDir(), "browser-profile");
}

export function browserDownloadsDir(): string {
  const fromEnv = process.env.NOVA_BROWSER_DOWNLOADS?.trim();
  if (fromEnv) return path.resolve(expandMaybe(fromEnv));
  const dir = path.join(novaDir(), "browser-downloads");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function browserHeaded(): boolean {
  return process.env.NOVA_BROWSER_HEADED === "1" || process.env.NOVA_BROWSER_HEADLESS === "0";
}

function expandMaybe(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function browserCdpUrl(): string | null {
  const raw = process.env.NOVA_BROWSER_CDP?.trim();
  if (!raw) return null;
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(raw)) {
    return null;
  }
  return raw;
}

export function assertLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("NOVA Desktop Service darf nur lokal lauschen.");
  }
}
