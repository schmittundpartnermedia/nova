import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Download, Page } from "playwright";
import {
  applyPlaywrightBrowsersPath,
  browserDownloadsDir,
  browserHeaded,
  browserProfileDir,
} from "@/lib/computer/config";

export type BrowserTabInfo = {
  index: number;
  url: string;
  title: string;
  active: boolean;
};

export type SavedDownload = {
  suggestedFilename: string;
  path: string;
  url: string;
  failed: string | null;
};

export type BrowserConsoleEntry = {
  type: string;
  text: string;
};

let context: BrowserContext | null = null;
let activePage: Page | null = null;
let launching: Promise<BrowserContext> | null = null;
const pendingDownloads: Download[] = [];
const savedDownloads: SavedDownload[] = [];
const pageConsole = new WeakMap<Page, BrowserConsoleEntry[]>();
const boundPages = new WeakSet<Page>();

export async function playwrightAvailable(): Promise<boolean> {
  try {
    applyPlaywrightBrowsersPath();
    const { chromium } = await import("playwright");
    const executable = chromium.executablePath();
    return Boolean(executable && fs.existsSync(executable));
  } catch {
    return false;
  }
}

export async function ensureBrowserSession(): Promise<{ context: BrowserContext; page: Page }> {
  if (context && isContextAlive(context)) {
    const page = await ensureActivePage();
    return { context, page };
  }
  if (!launching) {
    launching = launchPersistentContext().finally(() => {
      launching = null;
    });
  }
  context = await launching;
  const page = await ensureActivePage();
  return { context, page };
}

export async function getActivePage(): Promise<Page> {
  const session = await ensureBrowserSession();
  return session.page;
}

export async function listBrowserTabs(): Promise<BrowserTabInfo[]> {
  const session = await ensureBrowserSession();
  const pages = livePages(session.context);
  const active = activePage && !activePage.isClosed() ? activePage : pages[0] ?? null;
  const tabs: BrowserTabInfo[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    tabs.push({
      index,
      url: page.url(),
      title: await page.title().catch(() => ""),
      active: page === active,
    });
  }
  return tabs;
}

export async function openBrowserTab(url?: string): Promise<Page> {
  const session = await ensureBrowserSession();
  const page = await session.context.newPage();
  bindPage(page);
  activePage = page;
  if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return page;
}

export async function switchBrowserTab(index: number): Promise<Page> {
  const session = await ensureBrowserSession();
  const pages = livePages(session.context);
  const page = pages[index];
  if (!page) {
    throw new Error(`Tab ${index} existiert nicht.`);
  }
  activePage = page;
  await page.bringToFront().catch(() => undefined);
  return page;
}

export async function closeActiveBrowserTab(): Promise<BrowserTabInfo[]> {
  const session = await ensureBrowserSession();
  const pages = livePages(session.context);
  const current = activePage && !activePage.isClosed() ? activePage : pages[pages.length - 1];
  if (current) await current.close().catch(() => undefined);
  const remaining = livePages(session.context);
  if (remaining.length === 0) {
    activePage = await session.context.newPage();
    bindPage(activePage);
  } else {
    activePage = remaining[remaining.length - 1] ?? null;
  }
  return listBrowserTabs();
}

export async function closeBrowserSession(): Promise<void> {
  const current = context;
  context = null;
  activePage = null;
  pendingDownloads.length = 0;
  if (current) {
    await current.close().catch(() => undefined);
  }
}

export function consumePendingDownload(): Download | undefined {
  return pendingDownloads.shift();
}

export function recordedDownloads(): SavedDownload[] {
  return [...savedDownloads];
}

export async function persistDownload(download: Download): Promise<SavedDownload> {
  const dir = browserDownloadsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const safeName = sanitizeFilename(download.suggestedFilename() || `download-${Date.now()}`);
  const target = uniquePath(path.join(dir, safeName));
  await download.saveAs(target);
  const record: SavedDownload = {
    suggestedFilename: download.suggestedFilename(),
    path: target,
    url: download.url(),
    failed: await download.failure(),
  };
  savedDownloads.push(record);
  return record;
}

export function downloadsDirectory(): string {
  return browserDownloadsDir();
}

async function launchPersistentContext(): Promise<BrowserContext> {
  applyPlaywrightBrowsersPath();
  const { chromium } = await import("playwright");
  const executable = chromium.executablePath();
  if (!executable || !fs.existsSync(executable)) {
    throw new Error("Playwright-Chromium ist nicht installiert. Bitte npm run playwright:install ausführen.");
  }
  const profile = browserProfileDir();
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const downloadsPath = browserDownloadsDir();
  fs.mkdirSync(downloadsPath, { recursive: true, mode: 0o700 });
  const launched = await chromium.launchPersistentContext(profile, {
    headless: !browserHeaded(),
    executablePath: executable,
    acceptDownloads: true,
    downloadsPath,
    locale: "de-DE",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-dev-shm-usage", "--disable-sync", "--no-first-run"],
  });
  launched.on("page", bindPage);
  for (const page of launched.pages()) bindPage(page);
  activePage = launched.pages()[0] ?? (await launched.newPage());
  if (activePage) bindPage(activePage);
  return launched;
}

async function ensureActivePage(): Promise<Page> {
  if (!context) throw new Error("Keine Browser-Session.");
  if (activePage && !activePage.isClosed()) return activePage;
  const pages = livePages(context);
  activePage = pages[0] ?? (await context.newPage());
  bindPage(activePage);
  return activePage;
}

export function pageConsoleEntries(page: Page): BrowserConsoleEntry[] {
  return [...(pageConsole.get(page) ?? [])];
}

function bindPage(page: Page): void {
  page.removeAllListeners("download");
  page.on("download", (download) => {
    pendingDownloads.push(download);
  });
  if (boundPages.has(page)) return;
  boundPages.add(page);
  const entries: BrowserConsoleEntry[] = [];
  pageConsole.set(page, entries);
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      entries.push({ type: msg.type(), text: msg.text().slice(0, 500) });
      if (entries.length > 50) entries.splice(0, entries.length - 50);
    }
  });
  page.on("pageerror", (error) => {
    entries.push({ type: "pageerror", text: error.message.slice(0, 500) });
    if (entries.length > 50) entries.splice(0, entries.length - 50);
  });
}

function livePages(current: BrowserContext): Page[] {
  return current.pages().filter((page) => !page.isClosed());
}

function isContextAlive(current: BrowserContext): boolean {
  try {
    current.pages();
    return true;
  } catch {
    return false;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 180) || `download-${Date.now()}`;
}

function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const base = target.slice(0, target.length - ext.length);
  let index = 1;
  while (fs.existsSync(`${base}-${index}${ext}`)) index += 1;
  return `${base}-${index}${ext}`;
}
