import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import {
  assertAllowedBrowserUrl,
  assertUploadAllowed,
  elementLooksLikeSubmit,
  locatorTargetText,
  looksLikeHumanGate,
  resolveLocatorSpec,
  typingLooksLikeSecretExfil,
  type BrowserLocatorSpec,
} from "@/lib/computer/browser-policy";
import { ephemeralDir } from "@/lib/computer/config";
import { wrapExternalContent } from "@/lib/computer/injection";
import { classifyComputerAction } from "@/lib/computer/risk";
import { redactSecrets } from "@/lib/computer/redaction";
import { createActionResult, failedResult } from "@/lib/computer/result";
import type { BrowserAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";
import {
  closeActiveBrowserTab,
  closeBrowserSession,
  consumePendingDownload,
  downloadsDirectory,
  ensureBrowserSession,
  getActivePage,
  listBrowserTabs,
  clearPageConsole,
  openBrowserTab,
  pageConsoleEntries,
  persistDownload,
  playwrightAvailable,
  switchBrowserTab,
} from "@/services/desktop-service/adapters/browser-session";

export { closeBrowserSession, playwrightAvailable };

const ACTION_TIMEOUT_MS = 12_000;
const NAV_TIMEOUT_MS = 20_000;

export async function executeBrowserAction(input: {
  payload: BrowserAction;
  userCommissioned: boolean;
  approvalToken?: string;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const payload = input.payload;
  const target = locatorTargetText({
    selector: "selector" in payload ? payload.selector : undefined,
    locator: "locator" in payload ? payload.locator : undefined,
    url: "url" in payload ? payload.url : undefined,
    filePath: "filePath" in payload ? payload.filePath : undefined,
  });
  const risk = classifyComputerAction({
    tool: "browser",
    action: payload.action,
    target,
    userCommissioned: input.userCommissioned,
  });

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "browser",
      action: payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
      target,
    });
  }

  if (input.signal?.aborted) {
    return failedResult({
      tool: "browser",
      action: payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "cancelled",
      message: "Browseraktion abgebrochen.",
    });
  }

  if (!(await playwrightAvailable())) {
    return failedResult({
      tool: "browser",
      action: payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "playwright_unavailable",
      message: "Playwright-Chromium ist nicht verfügbar.",
      metadata: { status: "UNAVAILABLE" },
    });
  }

  try {
    switch (payload.action) {
      case "open":
      case "navigate":
        return await handleNavigate(payload.action, payload.url, startedAt, input.approvalToken);
      case "read":
        return await handleRead(startedAt);
      case "inspect":
        return await handleInspect(payload.maxItems ?? 80, startedAt);
      case "click":
        return await handleClick(payload, startedAt, input.approvalToken);
      case "type":
        return await handleType(payload, startedAt);
      case "select":
        return await handleSelect(payload, startedAt);
      case "check":
        return await handleCheck(payload, startedAt);
      case "scroll":
        return await handleScroll(payload, startedAt);
      case "waitFor":
        return await handleWaitFor(payload, startedAt);
      case "screenshot":
        return await handleScreenshot(payload.persist === true, startedAt);
      case "setViewport":
        return await handleSetViewport(payload.width, payload.height, startedAt);
      case "back":
        return await handleHistory("back", startedAt);
      case "forward":
        return await handleHistory("forward", startedAt);
      case "reload":
        return await handleReload(startedAt);
      case "newTab":
        return await handleNewTab(payload.url, startedAt, input.approvalToken);
      case "closeTab":
        return await handleCloseTab(startedAt);
      case "listTabs":
        return await handleListTabs(startedAt);
      case "switchTab":
        return await handleSwitchTab(payload.index, startedAt);
      case "download":
        return await handleDownload(payload, startedAt);
      case "upload":
        return await handleUpload(payload, startedAt);
      case "submit":
        return await handleSubmit(payload, startedAt, input.approvalToken);
    }
  } catch (error) {
    return failedResult({
      tool: "browser",
      action: payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "browser_error",
      message: error instanceof Error ? error.message : "Browserfehler",
      target,
    });
  }
}

async function handleNavigate(
  action: "open" | "navigate",
  url: string,
  startedAt: Date,
  approvalToken?: string,
): Promise<ActionResult> {
  const allowed = assertAllowedBrowserUrl(url);
  if (!allowed.ok) {
    return failedResult({
      tool: "browser",
      action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "invalid_url",
      message: allowed.message,
      target: url,
    });
  }
  const blocked = approvalIfNeeded(action, url, startedAt, approvalToken);
  if (blocked) return blocked;
  const { page } = await ensureBrowserSession();
  clearPageConsole(page);
  const before = await snapshot(page);
  const response = await page.goto(allowed.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const after = await snapshot(page);
  const status = response?.status();
  const ok =
    after.url !== "about:blank" &&
    (status === undefined || (status >= 200 && status < 400) || after.url !== before.url || after.title.length > 0);
  return createActionResult({
    tool: "browser",
    action,
    startedAt,
    success: ok,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: {
      requested: url,
      url: after.url,
      title: after.title,
      status,
      session: "nova-persistent",
      untrusted: wrapExternalContent(after.url, after.text),
    },
    verification: {
      verified: ok,
      method: "playwright_navigation",
      details: `HTTP ${status ?? "n/a"} → ${after.url}`,
    },
  });
}

async function handleRead(startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  const after = await snapshot(page);
  const untrusted = wrapExternalContent(after.url, after.text);
  const human = looksLikeHumanGate(`${after.title} ${after.text}`);
  return createActionResult({
    tool: "browser",
    action: "read",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: {
      url: after.url,
      title: after.title,
      text: after.text,
      injectionSuspected: untrusted.injectionSuspected,
      untrusted,
      humanRequired: human,
    },
    verification: {
      verified: after.title.length > 0 || after.text.length > 0 || /^https?:/i.test(after.url),
      method: "playwright_dom",
      details: human
        ? `Menschliche Aktion nötig: ${human}`
        : untrusted.injectionSuspected
          ? "Seiteninhalt ist untrusted; Injection-Muster erkannt und nicht als Anweisung behandelt."
          : `Titel ${after.title || "(leer)"}`,
    },
    metadata: human
      ? { humanRequired: human }
      : untrusted.injectionSuspected
        ? { untrusted: true, injectionSuspected: true }
        : undefined,
  });
}

async function handleInspect(maxItems: number, startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  const after = await snapshot(page);
  const tree = await inspectDom(page, maxItems);
  const consoleEntries = pageConsoleEntries(page);
  const untrusted = wrapExternalContent(after.url, JSON.stringify(tree).slice(0, 4000));
  const human = looksLikeHumanGate(`${after.title} ${after.text} ${JSON.stringify(tree).slice(0, 1500)}`);
  return createActionResult({
    tool: "browser",
    action: "inspect",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: {
      url: after.url,
      title: after.title,
      ...tree,
      console: consoleEntries,
      consoleErrors: consoleEntries.filter((item) => item.type === "error" || item.type === "pageerror"),
      injectionSuspected: untrusted.injectionSuspected,
      untrusted,
      humanRequired: human,
    },
    verification: {
      verified: true,
      method: "playwright_dom_inspect",
      details: human
        ? `Menschliche Aktion nötig: ${human}`
        : `${tree.links.length} Links, ${tree.inputs.length} Felder, ${tree.buttons.length} Buttons, ${consoleEntries.length} Console-Einträge`,
    },
    metadata: human ? { humanRequired: human } : untrusted.injectionSuspected ? { untrusted: true, injectionSuspected: true } : undefined,
  });
}

async function handleClick(
  payload: Extract<BrowserAction, { action: "click" }>,
  startedAt: Date,
  approvalToken?: string,
): Promise<ActionResult> {
  const page = await getActivePage();
  const locator = await requireLocator(page, payload);
  const info = await describeElement(locator);
  const target = locatorTargetText(payload);
  if (elementLooksLikeSubmit(info) && !approvalToken) {
    return failedResult({
      tool: "browser",
      action: "click",
      startedAt,
      riskLevel: "EXTERNAL_SIDE_EFFECT",
      code: "approval_required",
      message: "Finaler Submit oder irreversible Browseraktion braucht Freigabe. Es wurde nicht geklickt.",
      approvalRequired: true,
      target,
      metadata: { element: info },
    });
  }
  const before = await snapshot(page);
  await locator.click({ timeout: ACTION_TIMEOUT_MS });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const after = await snapshot(page);
  const changed = after.url !== before.url || after.title !== before.title || after.text !== before.text;
  return createActionResult({
    tool: "browser",
    action: "click",
    startedAt,
    success: true,
    riskLevel: changed && /^(https?:)/i.test(after.url) && after.url !== before.url ? "READ_ONLY" : "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: {
      before: { url: before.url, title: before.title },
      after: { url: after.url, title: after.title, text: after.text.slice(0, 1500) },
      element: info,
      untrusted: wrapExternalContent(after.url, after.text),
    },
    verification: {
      verified: changed || Boolean(info.tag),
      method: "dom_and_url",
      details: changed ? `${before.url} → ${after.url}` : "Klick ausgeführt, sichtbarer Zustand unverändert.",
    },
  });
}

async function handleType(
  payload: Extract<BrowserAction, { action: "type" }>,
  startedAt: Date,
): Promise<ActionResult> {
  if (typingLooksLikeSecretExfil(payload.text)) {
    return failedResult({
      tool: "browser",
      action: "type",
      startedAt,
      riskLevel: "PRIVILEGED",
      code: "secret_blocked",
      message: "Geheimnisse werden nicht an Webseiten gesendet.",
    });
  }
  const page = await getActivePage();
  const locator = await requireLocator(page, payload);
  await locator.fill(payload.text, { timeout: ACTION_TIMEOUT_MS });
  const value = await locator.inputValue().catch(async () => locator.innerText().catch(() => ""));
  const verified = value === payload.text || value.includes(payload.text);
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "type",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, filled: verified, valuePreview: redactSecrets(value).slice(0, 200) },
    verification: {
      verified,
      method: "input_value",
      details: verified ? "Feldwert entspricht der Eingabe." : `Feldwert weicht ab: ${redactSecrets(value).slice(0, 80)}`,
    },
  });
}

async function handleSelect(
  payload: Extract<BrowserAction, { action: "select" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const page = await getActivePage();
  const locator = await requireLocator(page, payload);
  await locator.selectOption(payload.value, { timeout: ACTION_TIMEOUT_MS });
  const value = await locator.inputValue().catch(() => "");
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "select",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, value },
    verification: {
      verified: value === payload.value,
      method: "select_value",
      details: `selected=${value}`,
    },
  });
}

async function handleCheck(
  payload: Extract<BrowserAction, { action: "check" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const page = await getActivePage();
  const locator = await requireLocator(page, payload);
  const wanted = payload.checked !== false;
  if (wanted) await locator.check({ timeout: ACTION_TIMEOUT_MS });
  else await locator.uncheck({ timeout: ACTION_TIMEOUT_MS });
  const checked = await locator.isChecked();
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "check",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, checked, wanted },
    verification: {
      verified: checked === wanted,
      method: "checkbox_state",
      details: `checked=${checked}`,
    },
  });
}

async function handleScroll(
  payload: Extract<BrowserAction, { action: "scroll" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const page = await getActivePage();
  const beforeY = await page.evaluate(() => window.scrollY);
  const spec = resolveLocatorSpec(payload);
  if (spec) {
    const locator = playwrightLocator(page, spec);
    await locator.first().scrollIntoViewIfNeeded();
  } else {
    await page.mouse.wheel(payload.dx ?? 0, payload.dy ?? 400);
  }
  const afterY = await page.evaluate(() => window.scrollY);
  return createActionResult({
    tool: "browser",
    action: "scroll",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: page.url(),
    result: { scrollY: afterY, beforeY },
    verification: {
      verified: spec ? true : afterY !== beforeY || (payload.dy ?? 400) === 0,
      method: "scroll_position",
      details: `${beforeY} → ${afterY}`,
    },
  });
}

async function handleWaitFor(
  payload: Extract<BrowserAction, { action: "waitFor" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const page = await getActivePage();
  const timeout = payload.timeoutMs ?? 10_000;
  if (payload.url) await page.waitForURL(payload.url, { timeout });
  const spec = resolveLocatorSpec(payload);
  if (spec) await playwrightLocator(page, spec).first().waitFor({ timeout });
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "waitFor",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, title: after.title },
    verification: { verified: true, method: "wait_for", details: after.url },
  });
}

async function handleScreenshot(persist: boolean, startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  const buffer = persist
    ? null
    : await page.screenshot({ type: "png" });
  let file: string | undefined;
  if (persist) {
    file = path.join(ephemeralDir(), `browser-${Date.now()}.png`);
    await page.screenshot({ path: file, type: "png" });
  }
  const bytes = buffer?.length ?? (file && fs.existsSync(file) ? fs.statSync(file).size : 0);
  return createActionResult({
    tool: "browser",
    action: "screenshot",
    startedAt,
    success: bytes > 0,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: page.url(),
    result: { bytes, ephemeral: true, path: file },
    artifacts: [{ kind: "screenshot", path: file, ephemeral: true, description: "Browser-Screenshot, nicht ins Memory." }],
    verification: { verified: bytes > 0, method: "screenshot_bytes", details: `${bytes} bytes` },
    metadata: { note: "Screenshot bleibt ephemer und wird nicht ins Memory geschrieben." },
  });
}

async function handleSetViewport(width: number, height: number, startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  await page.setViewportSize({ width, height });
  const size = page.viewportSize();
  return createActionResult({
    tool: "browser",
    action: "setViewport",
    startedAt,
    success: size?.width === width && size.height === height,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: page.url(),
    result: { width: size?.width, height: size?.height },
    verification: {
      verified: size?.width === width && size.height === height,
      method: "playwright_viewport",
      details: `${size?.width ?? "?"}x${size?.height ?? "?"}`,
    },
  });
}

async function handleHistory(action: "back" | "forward", startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  const before = await snapshot(page);
  if (action === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  else await page.goForward({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action,
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { before: before.url, url: after.url, title: after.title },
    verification: {
      verified: after.url !== before.url || after.title !== before.title,
      method: "history_navigation",
      details: `${before.url} → ${after.url}`,
    },
  });
}

async function handleReload(startedAt: Date): Promise<ActionResult> {
  const page = await getActivePage();
  const before = page.url();
  await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "reload",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, title: after.title },
    verification: {
      verified: after.url === before || after.title.length > 0,
      method: "reload",
      details: after.url,
    },
  });
}

async function handleNewTab(url: string | undefined, startedAt: Date, approvalToken?: string): Promise<ActionResult> {
  if (url) {
    const allowed = assertAllowedBrowserUrl(url);
    if (!allowed.ok) {
      return failedResult({
        tool: "browser",
        action: "newTab",
        startedAt,
        riskLevel: "READ_ONLY",
        code: "invalid_url",
        message: allowed.message,
        target: url,
      });
    }
    const blocked = approvalIfNeeded("newTab", url, startedAt, approvalToken);
    if (blocked) return blocked;
    const page = await openBrowserTab(allowed.url);
    const after = await snapshot(page);
    const tabs = await listBrowserTabs();
    return createActionResult({
      tool: "browser",
      action: "newTab",
      startedAt,
      success: true,
      riskLevel: "READ_ONLY",
      approvalRequired: false,
      target: after.url,
      result: { url: after.url, title: after.title, tabs },
      verification: {
        verified: tabs.length >= 2 || Boolean(url && after.url),
        method: "tab_list",
        details: `${tabs.length} Tabs, aktiv ${after.url}`,
      },
    });
  }
  const page = await openBrowserTab();
  const tabs = await listBrowserTabs();
  return createActionResult({
    tool: "browser",
    action: "newTab",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: page.url(),
    result: { url: page.url(), tabs },
    verification: { verified: tabs.some((tab) => tab.active), method: "tab_list" },
  });
}

async function handleCloseTab(startedAt: Date): Promise<ActionResult> {
  const tabs = await closeActiveBrowserTab();
  const active = tabs.find((tab) => tab.active);
  return createActionResult({
    tool: "browser",
    action: "closeTab",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: active?.url,
    result: { tabs },
    verification: { verified: true, method: "tab_list", details: `${tabs.length} Tabs` },
  });
}

async function handleListTabs(startedAt: Date): Promise<ActionResult> {
  const tabs = await listBrowserTabs();
  return createActionResult({
    tool: "browser",
    action: "listTabs",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    result: { tabs },
    verification: { verified: tabs.length > 0, method: "tab_list", details: `${tabs.length} Tabs` },
  });
}

async function handleSwitchTab(index: number, startedAt: Date): Promise<ActionResult> {
  const page = await switchBrowserTab(index);
  const after = await snapshot(page);
  const tabs = await listBrowserTabs();
  const active = tabs.find((tab) => tab.active);
  return createActionResult({
    tool: "browser",
    action: "switchTab",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: after.url,
    result: { url: after.url, title: after.title, tabs },
    verification: {
      verified: active?.index === index,
      method: "tab_active",
      details: `aktiv=${active?.index} url=${after.url}`,
    },
  });
}

async function handleDownload(
  payload: Extract<BrowserAction, { action: "download" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const page = await getActivePage();
  const spec = resolveLocatorSpec(payload);
  let download = consumePendingDownload();
  if (!download && spec) {
    const locator = playwrightLocator(page, spec).first();
    const wait = page.waitForEvent("download", { timeout: payload.timeoutMs ?? 15_000 });
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    download = await wait;
  }
  if (!download) {
    return failedResult({
      tool: "browser",
      action: "download",
      startedAt,
      riskLevel: "READ_ONLY",
      code: "download_not_detected",
      message: "Kein Download erkannt.",
      target: page.url(),
    });
  }
  const saved = await persistDownload(download);
  const exists = fs.existsSync(saved.path);
  return createActionResult({
    tool: "browser",
    action: "download",
    startedAt,
    success: exists && !saved.failed,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    target: saved.path,
    result: {
      ...saved,
      downloadsDir: downloadsDirectory(),
      executed: false,
      note: "Datei wurde nur gespeichert, nicht ausgeführt.",
    },
    artifacts: [{ kind: "file", path: saved.path, ephemeral: false, description: "Browser-Download im NOVA-Workspace" }],
    verification: {
      verified: exists && !saved.failed,
      method: "download_file",
      details: exists ? saved.path : "Datei fehlt nach dem Download.",
    },
    metadata: { executed: false },
  });
}

async function handleUpload(
  payload: Extract<BrowserAction, { action: "upload" }>,
  startedAt: Date,
): Promise<ActionResult> {
  const allowed = assertUploadAllowed(payload.filePath);
  if (!allowed.ok) {
    return failedResult({
      tool: "browser",
      action: "upload",
      startedAt,
      riskLevel: "PRIVILEGED",
      code: "upload_blocked",
      message: allowed.message,
      target: payload.filePath,
      approvalRequired: true,
    });
  }
  const page = await getActivePage();
  const locator = await requireLocator(page, payload);
  const isFileInput = await locator.evaluate((el) => el instanceof HTMLInputElement && el.type === "file");
  if (isFileInput) {
    await locator.setInputFiles(allowed.resolved);
  } else {
    const chooserWait = page.waitForEvent("filechooser", { timeout: 8_000 });
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    const chooser = await chooserWait;
    await chooser.setFiles(allowed.resolved);
  }
  const files = isFileInput
    ? await locator.evaluate((el) =>
        el instanceof HTMLInputElement ? Array.from(el.files ?? []).map((file) => file.name) : [],
      )
    : [path.basename(allowed.resolved)];
  return createActionResult({
    tool: "browser",
    action: "upload",
    startedAt,
    success: files.length > 0,
    riskLevel: "WORKSPACE_WRITE",
    approvalRequired: false,
    target: page.url(),
    result: { files, prepared: true, submitted: false },
    verification: {
      verified: files.some((name) => name === path.basename(allowed.resolved)),
      method: "input_files",
      details: files.join(", "),
    },
  });
}

async function handleSubmit(
  payload: Extract<BrowserAction, { action: "submit" }>,
  startedAt: Date,
  approvalToken?: string,
): Promise<ActionResult> {
  if (!approvalToken) {
    return failedResult({
      tool: "browser",
      action: "submit",
      startedAt,
      riskLevel: "EXTERNAL_SIDE_EFFECT",
      code: "approval_required",
      message: "Finaler Formular-Submit braucht Freigabe. Es wurde nichts abgesendet.",
      approvalRequired: true,
      target: locatorTargetText(payload),
    });
  }
  const page = await getActivePage();
  const spec = resolveLocatorSpec(payload);
  const before = await snapshot(page);
  if (spec) {
    await playwrightLocator(page, spec).first().click({ timeout: ACTION_TIMEOUT_MS });
  } else {
    await page.locator("form").first().evaluate((form) => {
      if (form instanceof HTMLFormElement) form.requestSubmit();
    });
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const after = await snapshot(page);
  return createActionResult({
    tool: "browser",
    action: "submit",
    startedAt,
    success: true,
    riskLevel: "EXTERNAL_SIDE_EFFECT",
    approvalRequired: true,
    target: after.url,
    result: { before: before.url, url: after.url, title: after.title },
    verification: {
      verified: after.url !== before.url || after.text !== before.text,
      method: "submit_navigation",
      details: `${before.url} → ${after.url}`,
    },
  });
}

function approvalIfNeeded(action: string, target: string, startedAt: Date, approvalToken?: string): ActionResult | null {
  const risk = classifyComputerAction({ tool: "browser", action, target, userCommissioned: true });
  if (risk.approvalRequired && !approvalToken) {
    return failedResult({
      tool: "browser",
      action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
      target,
    });
  }
  return null;
}

async function requireLocator(page: Page, payload: { selector?: string; locator?: BrowserLocatorSpec }): Promise<Locator> {
  const spec = resolveLocatorSpec(payload);
  if (!spec) {
    throw new Error("Kein robuster Locator angegeben (role, label, text, test-id oder selector).");
  }
  const locator = playwrightLocator(page, spec).first();
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`Element nicht gefunden: ${locatorTargetText(payload)}`);
  }
  return locator;
}

function playwrightLocator(page: Page, spec: BrowserLocatorSpec): Locator {
  const exact = spec.exact;
  if (spec.role) {
    return page.getByRole(spec.role as Parameters<Page["getByRole"]>[0], {
      name: spec.name,
      exact,
    });
  }
  if (spec.label) return page.getByLabel(spec.label, { exact });
  if (spec.text) return page.getByText(spec.text, { exact });
  if (spec.testId) return page.getByTestId(spec.testId);
  if (spec.placeholder) return page.getByPlaceholder(spec.placeholder, { exact });
  if (spec.alt) return page.getByAltText(spec.alt, { exact });
  if (spec.title) return page.getByTitle(spec.title, { exact });
  if (spec.selector) return page.locator(spec.selector);
  if (spec.name) return page.getByRole("button", { name: spec.name, exact }).or(page.getByRole("link", { name: spec.name, exact }));
  throw new Error("Kein verwendbarer Locator.");
}

async function snapshot(page: Page): Promise<{ url: string; title: string; text: string }> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const raw = await page.innerText("body").catch(async () => (await page.content().catch(() => "")).slice(0, 8000));
  return { url, title, text: redactSecrets(raw).slice(0, 8000) };
}

async function describeElement(locator: Locator): Promise<{
  tag: string;
  type: string;
  text: string;
  name: string;
  role: string;
  href: string;
}> {
  return locator.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type || el.getAttribute("type") || "",
    text: (el.textContent || "").trim().slice(0, 200),
    name: el.getAttribute("name") || "",
    role: el.getAttribute("role") || "",
    href: (el as HTMLAnchorElement).href || "",
  }));
}

async function inspectDom(page: Page, maxItems: number) {
  return page.evaluate(
    new Function(
      "limit",
      `const textOf = (el) => (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160);
      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, limit).map((el) => ({
        text: textOf(el) || el.getAttribute("aria-label") || "",
        href: el.href,
        name: el.getAttribute("aria-label") || textOf(el),
      }));
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")).slice(0, limit).map((el) => ({
        text: textOf(el) || el.value || "",
        type: el.type || "button",
        name: el.getAttribute("name") || "",
      }));
      const inputs = Array.from(document.querySelectorAll("input, textarea")).slice(0, limit).map((el) => {
        const labelNode = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
        const label = (labelNode && labelNode.textContent ? labelNode.textContent.trim() : "") ||
          (el.closest("label") && el.closest("label").textContent ? el.closest("label").textContent.trim() : "") ||
          el.getAttribute("aria-label") ||
          el.placeholder ||
          "";
        return {
          type: el.type || el.tagName.toLowerCase(),
          name: el.name || "",
          label: String(label).slice(0, 120),
          testId: el.getAttribute("data-testid") || "",
        };
      });
      const selects = Array.from(document.querySelectorAll("select")).slice(0, limit).map((el) => ({
        name: el.name,
        label: (el.closest("label") && el.closest("label").textContent ? el.closest("label").textContent : "").trim().slice(0, 120),
        options: Array.from(el.options).slice(0, 20).map((option) => ({ value: option.value, text: option.text })),
      }));
      const headings = Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 20).map((el) => textOf(el));
      return { links, buttons, inputs, selects, headings };`,
    ) as (limit: number) => {
      links: Array<{ text: string; href: string; name: string }>;
      buttons: Array<{ text: string; type: string; name: string }>;
      inputs: Array<{ type: string; name: string; label: string; testId: string }>;
      selects: Array<{ name: string; label: string; options: Array<{ value: string; text: string }> }>;
      headings: string[];
    },
    maxItems,
  );
}
