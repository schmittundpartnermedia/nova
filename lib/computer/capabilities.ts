import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mountedExternalVolumeRoots } from "@/lib/computer/volumes";
import { CAPABILITY_IDS, type CapabilityId, type CapabilityRecord, type CapabilityStatus, type PermissionSnapshot } from "@/lib/computer/types";

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

export async function buildNativeHelper(): Promise<{ ok: boolean; reason: string }> {
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
  const appPath = helperAppPath();
  const bin = helperBinaryPath();
  const macosDir = path.dirname(bin);
  const contentsDir = path.dirname(macosDir);
  fs.mkdirSync(macosDir, { recursive: true });
  fs.copyFileSync(infoPlist, path.join(contentsDir, "Info.plist"));
  const args = [
    "-O",
    "-o",
    bin,
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
    "-framework",
    "CoreGraphics",
    "-framework",
    "ImageIO",
    "-framework",
    "UniformTypeIdentifiers",
    "-framework",
    "ScreenCaptureKit",
  ];
  const result = await runProcess("/usr/bin/swiftc", args, 90_000);
  if (result.code !== 0) {
    return { ok: false, reason: result.stderr.slice(0, 500) || "swiftc fehlgeschlagen." };
  }
  const signed = await signNativeHelper(appPath);
  if (!signed.ok) return signed;
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

function filesFoldersMessage(): string {
  const volumes = mountedExternalVolumeRoots();
  if (!volumes.length) return "Definierte Arbeitsverzeichnisse sind lokal auflösbar. ELEVUM ist nicht eingehängt.";
  return `Lokale Platte: ${volumes.map((item) => item.name).join(", ")}. Nicht Google Drive.`;
}

export async function readMacPermissions(): Promise<PermissionSnapshot[]> {
  if (os.platform() !== "darwin") {
    return [
      { id: "accessibility", status: "UNAVAILABLE", message: "Nur auf macOS verfügbar." },
      { id: "screen_recording", status: "UNAVAILABLE", message: "Nur auf macOS verfügbar." },
      { id: "automation", status: "UNAVAILABLE", message: "Nur auf macOS verfügbar." },
      { id: "microphone", status: "UNAVAILABLE", message: "Wird für Computer Control nicht benötigt." },
      { id: "files_folders", status: "AVAILABLE", message: filesFoldersMessage() },
    ];
  }

  await ensureNativeHelper();
  const helper = await invokeNativeHelper({ cmd: "permissions" });
  const data = helper.data ?? {};
  const accessibility = data.accessibility === true;
  const screen = data.screenRecording === true;
  const automation = data.automation === true;

  return [
    {
      id: "accessibility",
      status: accessibility ? "AVAILABLE" : helper.ok ? "PERMISSION_REQUIRED" : "ERROR",
      message: accessibility
        ? "Bedienungshilfen sind erteilt."
        : "NOVA benötigt Bedienungshilfen-Zugriff.",
    },
    {
      id: "screen_recording",
      status: screen ? "AVAILABLE" : helper.ok ? "PERMISSION_REQUIRED" : "ERROR",
      message: screen
        ? "Bildschirmaufnahme ist erteilt."
        : "NOVA benötigt Bildschirmaufnahme-Zugriff.",
    },
    {
      id: "automation",
      status: automation ? "AVAILABLE" : helper.ok ? "PERMISSION_REQUIRED" : "ERROR",
      message: automation
        ? "Automation ist erteilt."
        : "NOVA benötigt Automation-Zugriff für einige App-Steuerungen.",
    },
    {
      id: "microphone",
      status: "UNAVAILABLE",
      message: "Mikrofon wird von der Computer-Schicht nicht verwendet.",
    },
    {
      id: "files_folders",
      status: "AVAILABLE",
      message: filesFoldersMessage(),
    },
  ];
}

export function capabilitiesFrom(input: {
  permissions: PermissionSnapshot[];
  playwright: boolean;
  cursor: boolean;
  helper: boolean;
  platform: NodeJS.Platform;
}): CapabilityRecord[] {
  const perm = (id: PermissionSnapshot["id"]): CapabilityStatus =>
    input.permissions.find((item) => item.id === id)?.status ?? "UNAVAILABLE";

  const darwin = input.platform === "darwin";
  const ax = perm("accessibility");
  const screen = perm("screen_recording");

  const records: CapabilityRecord[] = CAPABILITY_IDS.map((id) => {
    const base: CapabilityRecord = { id, status: "UNAVAILABLE" };
    return decorate(id, base, { darwin, ax, screen, playwright: input.playwright, cursor: input.cursor, helper: input.helper, perm });
  });
  return records;
}

function decorate(
  id: CapabilityId,
  record: CapabilityRecord,
  ctx: {
    darwin: boolean;
    ax: CapabilityStatus;
    screen: CapabilityStatus;
    playwright: boolean;
    cursor: boolean;
    helper: boolean;
    perm: (id: PermissionSnapshot["id"]) => CapabilityStatus;
  },
): CapabilityRecord {
  if (id.startsWith("filesystem.") || id.startsWith("shell.") || id.startsWith("process.")) {
    return { ...record, status: "AVAILABLE" };
  }
  if (id.startsWith("browser.")) {
    return ctx.playwright
      ? { ...record, status: "AVAILABLE", reason: "Playwright-Chromium mit persistenter NOVA-Session." }
      : { ...record, status: "UNAVAILABLE", reason: "Playwright oder Chromium ist nicht verfügbar." };
  }
  if (id === "macos.app.launch" || id === "macos.app.focus") {
    return { ...record, status: ctx.darwin ? "AVAILABLE" : "UNAVAILABLE" };
  }
  if (id === "macos.app.quit") {
    return {
      ...record,
      status: ctx.darwin ? ctx.perm("automation") : "UNAVAILABLE",
      permission: "automation",
      reason: ctx.darwin ? "App beenden nutzt Automation." : "Nur macOS.",
    };
  }
  if (id.startsWith("macos.")) {
    return {
      ...record,
      status: ctx.darwin ? (ctx.helper ? ctx.ax : "NOT_IMPLEMENTED") : "UNAVAILABLE",
      permission: "accessibility",
      reason: ctx.ax === "PERMISSION_REQUIRED" ? "NOVA benötigt Bedienungshilfen-Zugriff." : undefined,
    };
  }
  if (id.startsWith("screen.")) {
    return {
      ...record,
      status: ctx.darwin ? (ctx.helper ? ctx.screen : "NOT_IMPLEMENTED") : "UNAVAILABLE",
      permission: "screen_recording",
      reason: ctx.screen === "PERMISSION_REQUIRED" ? "NOVA benötigt Bildschirmaufnahme-Zugriff." : undefined,
    };
  }
  if (id === "cursor.available") {
    return { ...record, status: ctx.cursor ? "AVAILABLE" : "UNAVAILABLE" };
  }
  if (id.startsWith("cursor.")) {
    return {
      ...record,
      status: ctx.cursor ? "AVAILABLE" : "UNAVAILABLE",
      reason: ctx.cursor ? undefined : "Cursor Agent CLI wurde auf diesem Mac nicht gefunden.",
    };
  }
  return record;
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
