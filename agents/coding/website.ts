import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runDesktopAction } from "@/services/desktop-service/client";
import type { VerificationCheck } from "@/lib/coding/types";
import type { ActionResult } from "@/lib/computer/types";

const SITE_PORT = 47831;

export type WebsiteVerification = {
  overall: "VERIFIED" | "UNVERIFIED" | "FAILED";
  url?: string;
  checks: VerificationCheck[];
  actions: ActionResult[];
  issues: string[];
};

export async function verifyWebsite(input: {
  organizationId: string;
  jobId?: string;
  projectPath: string;
}): Promise<WebsiteVerification> {
  const actions: ActionResult[] = [];
  const checks: VerificationCheck[] = [];
  const issues: string[] = [];
  const run = async (tool: "process" | "browser" | "shell", payload: unknown, timeoutMs?: number) => {
    const result = await runDesktopAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      requestId: randomUUID(),
      timeoutMs,
      source: "nova_plan",
      tool,
      payload,
      userCommissioned: true,
    });
    actions.push(result);
    return result;
  };

  const entry = findSiteEntry(input.projectPath);
  if (!entry) {
    checks.push({
      id: "site.entry",
      label: "Website-Einstieg",
      status: "failed",
      details: "Keine index.html oder package.json mit Dev-Script gefunden.",
    });
    return { overall: "FAILED", checks, actions, issues: ["Keine Website-Dateien gefunden."] };
  }

  const url = await ensureLocalServer(run, input.projectPath, entry);
  if (!url) {
    checks.push({
      id: "site.server",
      label: "Lokaler Server",
      status: "unverified",
      details: "Lokaler Server konnte nicht gestartet oder verifiziert werden.",
    });
    return { overall: "UNVERIFIED", checks, actions, issues: ["Server nicht erreichbar."] };
  }

  const opened = await run("browser", { action: "open", url });
  const status = Number((opened.result as { status?: number } | undefined)?.status ?? 0);
  const reachable = opened.success && opened.verification?.verified && (status === 0 || (status >= 200 && status < 400));
  checks.push({
    id: "site.load",
    label: "Seite lädt",
    status: reachable ? "passed" : "failed",
    details: `HTTP ${status || "n/a"} ${url}`,
  });
  if (!reachable) issues.push("Seite nicht erreichbar.");

  const inspect = await run("browser", { action: "inspect", maxItems: 80 });
  const inspectResult = (inspect.result ?? {}) as {
    title?: string;
    headings?: string[];
    links?: Array<{ href: string; text: string }>;
    buttons?: Array<{ text: string }>;
    consoleErrors?: Array<{ type: string; text: string }>;
  };
  checks.push({
    id: "site.dom",
    label: "DOM",
    status: inspect.success ? "passed" : "unverified",
    details: `Titel ${inspectResult.title || "(leer)"}; ${inspectResult.headings?.length ?? 0} Überschriften`,
  });

  const screenshot = await run("browser", { action: "screenshot", persist: false });
  checks.push({
    id: "site.screenshot",
    label: "Screenshot",
    status: screenshot.success && screenshot.verification?.verified ? "passed" : "unverified",
    details: screenshot.verification?.details ?? "kein Screenshot",
  });

  const mobile = await run("browser", { action: "setViewport", width: 390, height: 844 });
  const mobileInspect = await run("browser", { action: "inspect", maxItems: 40 });
  await run("browser", { action: "setViewport", width: 1280, height: 900 });
  checks.push({
    id: "site.responsive",
    label: "Responsive",
    status: mobile.success && mobileInspect.success ? "passed" : "unverified",
    details: mobile.success ? "Viewport 390x844 gesetzt und erneut gelesen." : "Viewport konnte nicht gesetzt werden.",
  });

  const consoleErrors = (inspectResult.consoleErrors ?? []).filter((item) => item.type !== "warning");
  if (consoleErrors.length > 0) {
    issues.push(`Console: ${consoleErrors.map((item) => item.text).slice(0, 3).join("; ")}`);
    checks.push({
      id: "site.console",
      label: "Console Errors",
      status: "failed",
      details: consoleErrors.map((item) => item.text).slice(0, 5).join(" | "),
    });
  } else {
    checks.push({ id: "site.console", label: "Console Errors", status: "passed", details: "Keine kritischen Console Errors." });
  }

  const internal = (inspectResult.links ?? []).filter((link) => isInternalLink(link.href, url));
  let broken = 0;
  for (const link of internal.slice(0, 12)) {
    const ok = await httpOk(link.href);
    if (!ok) {
      broken += 1;
      issues.push(`Link ${link.href} nicht ok`);
    }
  }
  checks.push({
    id: "site.links",
    label: "Interne Links",
    status: broken > 0 ? "failed" : "passed",
    details: `${internal.length} interne Links geprüft, ${broken} fehlerhaft.`,
  });

  const seoIssues = seoGaps(inspectResult);
  checks.push({
    id: "site.seo",
    label: "Technische SEO-Basis",
    status: seoIssues.length ? "failed" : "passed",
    details: seoIssues.length ? seoIssues.join("; ") : "Titel und Überschrift vorhanden.",
  });
  issues.push(...seoIssues);

  const failed = checks.some((item) => item.status === "failed");
  const unverified = checks.some((item) => item.status === "unverified");
  return {
    overall: failed ? "FAILED" : unverified ? "UNVERIFIED" : "VERIFIED",
    url,
    checks,
    actions,
    issues: [...new Set(issues)],
  };
}

function findSiteEntry(projectPath: string): { kind: "static" | "dev"; file?: string } | null {
  const index = ["index.html", "public/index.html", "src/index.html"]
    .map((rel) => path.join(/* turbopackIgnore: true */ projectPath, rel))
    .find((file) => fs.existsSync(/* turbopackIgnore: true */ file));
  if (index) return { kind: "static", file: index };
  const pkgFile = path.join(/* turbopackIgnore: true */ projectPath, "package.json");
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as { scripts?: Record<string, string> };
      if (pkg.scripts?.dev || pkg.scripts?.start) return { kind: "dev" };
    } catch {
      return null;
    }
  }
  return null;
}

async function ensureLocalServer(
  run: (tool: "process" | "browser" | "shell", payload: unknown, timeoutMs?: number) => Promise<ActionResult>,
  projectPath: string,
  entry: { kind: "static" | "dev"; file?: string },
): Promise<string | null> {
  const listed = await run("process", { action: "list", query: String(SITE_PORT) });
  const processes = ((listed.result as { processes?: Array<{ ports: number[]; command: string }> })?.processes ?? []);
  if (processes.some((item) => item.ports.includes(SITE_PORT))) {
    return `http://127.0.0.1:${SITE_PORT}/`;
  }
  if (entry.kind === "static") {
    await run("process", {
      action: "start",
      argv: ["python3", "-m", "http.server", String(SITE_PORT), "--directory", projectPath],
      cwd: projectPath,
      purpose: "Lokale Website bereitstellen",
    });
  } else {
    await run("process", {
      action: "start",
      argv: ["npm", "run", "dev"],
      cwd: projectPath,
      purpose: "Lokalen Dev-Server starten",
    });
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await httpOk(`http://127.0.0.1:${SITE_PORT}/`)) return `http://127.0.0.1:${SITE_PORT}/`;
  }
  return (await httpOk("http://127.0.0.1:3000/")) ? "http://127.0.0.1:3000/" : null;
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function isInternalLink(href: string, base: string): boolean {
  try {
    const resolved = new URL(href, base);
    return resolved.hostname === "127.0.0.1" || resolved.hostname === "localhost" || href.startsWith("/") || href.startsWith("#");
  } catch {
    return href.startsWith("/") || href.startsWith("#");
  }
}

function seoGaps(inspect: { title?: string; headings?: string[] }): string[] {
  const issues: string[] = [];
  if (!inspect.title?.trim()) issues.push("Kein Seitentitel.");
  if (!inspect.headings?.some((item) => item.trim())) issues.push("Keine Überschrift gefunden.");
  return issues;
}
