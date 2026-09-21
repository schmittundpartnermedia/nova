import os from "node:os";
import { classifyComputerAction } from "@/lib/computer/risk";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { redactSecrets } from "@/lib/computer/redaction";
import { wrapExternalContent } from "@/lib/computer/injection";
import { runArgv } from "@/services/desktop-service/adapters/shell";
import type { BrowserAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

type PlaywrightModule = {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<{
      newPage: () => Promise<PlaywrightPage>;
      close: () => Promise<void>;
    }>;
  };
};

type PlaywrightPage = {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  goBack: () => Promise<unknown>;
  goForward: () => Promise<unknown>;
  url: () => string;
  title: () => Promise<string>;
  content: () => Promise<string>;
  innerText: (selector: string) => Promise<string>;
  click: (selector: string) => Promise<void>;
  fill: (selector: string, text: string) => Promise<void>;
  selectOption: (selector: string, value: string) => Promise<unknown>;
  mouse: { wheel: (dx: number, dy: number) => Promise<void> };
  screenshot: (options?: { path?: string }) => Promise<Buffer>;
  waitForSelector: (selector: string, options?: Record<string, unknown>) => Promise<unknown>;
  locator: (selector: string) => { count: () => Promise<number> };
};

let playwrightPage: PlaywrightPage | null = null;
let _playwrightBrowser: { close: () => Promise<void> } | null = null;

export async function playwrightAvailable(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

export async function executeBrowserAction(input: {
  payload: BrowserAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const risk = classifyComputerAction({
    tool: "browser",
    action: input.payload.action,
    target: "url" in input.payload ? input.payload.url : "selector" in input.payload ? input.payload.selector : undefined,
    userCommissioned: input.userCommissioned,
  });

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "browser",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
    });
  }

  try {
    switch (input.payload.action) {
      case "open":
      case "navigate": {
        const url = input.payload.url;
        if (!/^https?:\/\//i.test(url) && !url.startsWith("file:")) {
          return failedResult({
            tool: "browser",
            action: input.payload.action,
            startedAt,
            riskLevel: risk.risk,
            code: "invalid_url",
            message: "Nur http(s)-URLs sind erlaubt.",
            target: url,
          });
        }
        if (os.platform() === "darwin" && input.payload.action === "open") {
          await runArgv({ argv: ["open", url], cwd: process.cwd(), timeoutMs: 8000, signal: input.signal });
        }
        const probe = await probeUrl(url);
        const pw = await playwrightAvailable();
        if (pw) {
          const page = await ensurePage();
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        }
        return createActionResult({
          tool: "browser",
          action: input.payload.action,
          startedAt,
          success: probe.ok,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: url,
          result: {
            url,
            status: probe.status,
            title: probe.title,
            openedVia: os.platform() === "darwin" ? "macos-open" : "http",
            playwright: pw,
            untrusted: wrapExternalContent(url, probe.text.slice(0, 2000)),
          },
          verification: {
            verified: probe.ok,
            method: "http_status",
            details: probe.ok ? `HTTP ${probe.status}` : probe.error ?? "nicht erreichbar",
          },
        });
      }
      case "read": {
        const pw = await playwrightAvailable();
        if (pw && playwrightPage) {
          const title = await playwrightPage.title();
          const text = redactSecrets(await playwrightPage.innerText("body").catch(async () => (await playwrightPage!.content()).slice(0, 8000)));
          const url = playwrightPage.url();
          return createActionResult({
            tool: "browser",
            action: "read",
            startedAt,
            success: true,
            riskLevel: "READ_ONLY",
            approvalRequired: false,
            target: url,
            result: {
              url,
              title,
              text: text.slice(0, 8000),
              untrusted: wrapExternalContent(url, text),
            },
            verification: { verified: true, method: "playwright_dom" },
          });
        }
        return failedResult({
          tool: "browser",
          action: "read",
          startedAt,
          riskLevel: "READ_ONLY",
          code: "no_active_page",
          message: "Kein aktives Playwright-Dokument. Für Erreichbarkeit 'open' mit HTTP-Verify verwenden.",
          metadata: { status: "UNAVAILABLE" },
        });
      }
      case "click":
      case "type":
      case "select":
      case "scroll":
      case "waitFor":
      case "screenshot":
      case "back":
      case "forward":
      case "newTab":
      case "closeTab":
      case "listTabs":
      case "switchTab":
      case "download":
      case "upload": {
        if (!(await playwrightAvailable())) {
          return failedResult({
            tool: "browser",
            action: input.payload.action,
            startedAt,
            riskLevel: risk.risk,
            code: "playwright_unavailable",
            message: "Playwright ist nicht installiert. Strukturierte DOM-Steuerung ist daher UNAVAILABLE.",
            metadata: { status: "UNAVAILABLE" },
          });
        }
        const page = await ensurePage();
        if (input.payload.action === "click") await page.click(input.payload.selector);
        if (input.payload.action === "type") await page.fill(input.payload.selector, input.payload.text);
        if (input.payload.action === "select") await page.selectOption(input.payload.selector, input.payload.value);
        if (input.payload.action === "scroll") await page.mouse.wheel(input.payload.dx ?? 0, input.payload.dy ?? 400);
        if (input.payload.action === "waitFor" && input.payload.selector) {
          await page.waitForSelector(input.payload.selector, { timeout: input.payload.timeoutMs ?? 10_000 });
        }
        if (input.payload.action === "screenshot") {
          const buffer = await page.screenshot();
          return createActionResult({
            tool: "browser",
            action: "screenshot",
            startedAt,
            success: true,
            riskLevel: "READ_ONLY",
            approvalRequired: false,
            result: { bytes: buffer.length, ephemeral: true },
            verification: { verified: buffer.length > 0, method: "screenshot_bytes" },
            metadata: { note: "Screenshot bleibt ephemer und wird nicht ins Memory geschrieben." },
          });
        }
        if (input.payload.action === "back") await page.goBack();
        if (input.payload.action === "forward") await page.goForward();
        if (["newTab", "closeTab", "listTabs", "switchTab", "download", "upload"].includes(input.payload.action)) {
          return failedResult({
            tool: "browser",
            action: input.payload.action,
            startedAt,
            riskLevel: risk.risk,
            code: "not_implemented",
            message: `Browser-Aktion ${input.payload.action} ist vorbereitet, aber noch nicht produktionsfähig verdrahtet.`,
            metadata: { status: "NOT_IMPLEMENTED" },
          });
        }
        return createActionResult({
          tool: "browser",
          action: input.payload.action,
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: page.url(),
          result: { url: page.url() },
          verification: { verified: true, method: "playwright_action" },
        });
      }
    }
  } catch (error) {
    return failedResult({
      tool: "browser",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "browser_error",
      message: error instanceof Error ? error.message : "Browserfehler",
    });
  }
}

async function ensurePage(): Promise<PlaywrightPage> {
  if (playwrightPage) return playwrightPage;
  const mod = (await import("playwright")) as unknown as PlaywrightModule;
  const browser = await mod.chromium.launch({ headless: true });
  _playwrightBrowser = browser;
  playwrightPage = await browser.newPage();
  return playwrightPage;
}

async function probeUrl(url: string): Promise<{ ok: boolean; status?: number; title?: string; text: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const text = redactSecrets((await response.text()).slice(0, 20_000));
    const title = text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    return { ok: response.ok, status: response.status, title, text };
  } catch (error) {
    return { ok: false, text: "", error: error instanceof Error ? error.message : "fetch fehlgeschlagen" };
  } finally {
    clearTimeout(timer);
  }
}
