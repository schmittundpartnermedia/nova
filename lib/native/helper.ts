/**
 * Nativer Swift-Helfer (services/desktop-service/native/main.swift) für Apple Events an Apple Mail.
 * Wird bei Bedarf gebaut und signiert; ein Aufruf = ein Prozess mit JSON-Befehl als Argument.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type NativeHelperResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  permission?: string;
  path?: string;
  ephemeral?: boolean;
  status?: string;
};

export const HELPER_BUNDLE_IDENTIFIER = "de.joachimschmitt.nova.desktop-helper";
const HELPER_APP_NAME = "NOVA Desktop Helper.app";

function helperAppPath(): string {
  return path.join(process.cwd(), "services/desktop-service/native/bin", HELPER_APP_NAME);
}

function helperBinaryPath(): string {
  return path.join(helperAppPath(), "Contents/MacOS/nova-desktop-helper");
}

function helperSourcePath(): string {
  return path.join(process.cwd(), "services/desktop-service/native/main.swift");
}

function helperInfoPlistPath(): string {
  return path.join(process.cwd(), "services/desktop-service/native/Info.plist");
}

export function helperAvailable(): boolean {
  return fs.existsSync(helperBinaryPath());
}

async function resolveAppleDevelopmentIdentity(): Promise<{ ok: true; identity: string } | { ok: false; reason: string }> {
  const result = await runProcess("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], 15_000);
  const match = result.stdout.match(/^\s*\d+\)\s+[A-F0-9]+\s+"((?:Apple Development|Developer ID Application): [^"]+)"/m);
  if (!match?.[1]) {
    return {
      ok: false,
      reason: "Keine gültige Apple-Development- oder Developer-ID-Identity. security find-identity -v -p codesigning ist leer.",
    };
  }
  return { ok: true, identity: match[1] };
}

async function signNativeHelper(appPath: string): Promise<{ ok: boolean; reason: string }> {
  const identity = await resolveAppleDevelopmentIdentity();
  if (!identity.ok) return identity;
  const result = await runProcess(
    "/usr/bin/codesign",
    ["--force", "--sign", identity.identity, "--identifier", HELPER_BUNDLE_IDENTIFIER, "--timestamp=none", appPath],
    30_000,
  );
  if (result.code !== 0) {
    return { ok: false, reason: result.stderr.slice(0, 500) || "codesign fehlgeschlagen." };
  }
  const verify = await runProcess("/usr/bin/codesign", ["--verify", "--verbose=2", appPath], 10_000);
  if (verify.code !== 0) {
    return { ok: false, reason: verify.stderr.slice(0, 500) || "codesign verify fehlgeschlagen." };
  }
  return { ok: true, reason: `Native Helper signiert mit ${identity.identity}.` };
}

let helperBuildInFlight: Promise<{ ok: boolean; reason: string }> | null = null;

export function buildNativeHelper(): Promise<{ ok: boolean; reason: string }> {
  if (helperBuildInFlight) return helperBuildInFlight;
  helperBuildInFlight = buildNativeHelperOnce().finally(() => {
    helperBuildInFlight = null;
  });
  return helperBuildInFlight;
}

async function buildNativeHelperOnce(): Promise<{ ok: boolean; reason: string }> {
  if (os.platform() !== "darwin") {
    return { ok: false, reason: "Native Helper nur auf macOS." };
  }
  const source = helperSourcePath();
  if (!fs.existsSync(source)) {
    return { ok: false, reason: "Swift-Quelle fehlt." };
  }
  const infoPlist = helperInfoPlistPath();
  if (!fs.existsSync(infoPlist)) {
    return { ok: false, reason: "Info.plist für den Native Helper fehlt." };
  }
  const liveApp = helperAppPath();
  const stagingRoot = path.join(path.dirname(liveApp), `.helper-staging-${process.pid}`);
  const stagingApp = path.join(stagingRoot, HELPER_APP_NAME);
  const stagingBin = path.join(stagingApp, "Contents/MacOS/nova-desktop-helper");
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stagingBin), { recursive: true });
  fs.copyFileSync(infoPlist, path.join(stagingApp, "Contents/Info.plist"));
  const args = [
    "-O",
    "-o",
    stagingBin,
    source,
    "-Xlinker",
    "-sectcreate",
    "-Xlinker",
    "__TEXT",
    "-Xlinker",
    "__info_plist",
    "-Xlinker",
    infoPlist,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
  ];
  const result = await runProcess("/usr/bin/swiftc", args, 90_000);
  if (result.code !== 0) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return { ok: false, reason: result.stderr.slice(0, 500) || "swiftc fehlgeschlagen." };
  }
  const signed = await signNativeHelper(stagingApp);
  if (!signed.ok) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return signed;
  }
  const backup = path.join(path.dirname(liveApp), `.helper-previous-${process.pid}`);
  fs.rmSync(backup, { recursive: true, force: true });
  try {
    if (fs.existsSync(liveApp)) fs.renameSync(liveApp, backup);
    fs.renameSync(stagingApp, liveApp);
  } catch (error) {
    if (!fs.existsSync(liveApp) && fs.existsSync(backup)) fs.renameSync(backup, liveApp);
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : "Austausch fehlgeschlagen.";
    return { ok: false, reason: message };
  }
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  return { ok: true, reason: signed.reason };
}

export async function ensureNativeHelper(): Promise<{ ok: boolean; reason: string }> {
  const source = helperSourcePath();
  const plist = helperInfoPlistPath();
  const bin = helperBinaryPath();
  if (helperAvailable()) {
    const binTime = fs.statSync(bin).mtimeMs;
    const sourceTime = fs.existsSync(source) ? fs.statSync(source).mtimeMs : 0;
    const plistTime = fs.existsSync(plist) ? fs.statSync(plist).mtimeMs : 0;
    if (binTime >= sourceTime && binTime >= plistTime) {
      return { ok: true, reason: "Native Helper vorhanden." };
    }
  }
  return buildNativeHelper();
}

export async function invokeNativeHelper(command: Record<string, unknown>, timeoutMs = 8000): Promise<NativeHelperResult> {
  const bin = helperBinaryPath();
  if (!fs.existsSync(bin)) {
    return { ok: false, error: "Native Helper nicht gebaut.", permission: "missing_helper" };
  }
  const result = await runProcess(bin, [JSON.stringify(command)], timeoutMs);
  if (!result.stdout.trim()) {
    return { ok: false, error: result.stderr.slice(0, 400) || "Native Helper lieferte keine Ausgabe." };
  }
  try {
    const parsed = JSON.parse(result.stdout) as NativeHelperResult;
    return parsed;
  } catch {
    return { ok: false, error: "Native Helper Antwort war kein JSON." };
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}
