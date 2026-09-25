import type { Browser } from "playwright";
import { wrapExternalContent } from "@/lib/computer/injection";
import { applyPlaywrightBrowsersPath } from "@/lib/computer/config";
import { extractHtmlContent } from "@/lib/research/html";
import { RESEARCH_LIMITS } from "@/lib/research/limits";
import { canonicalizeUrl, domainOf, isFetchUrlAllowed } from "@/lib/research/url";
import type { FetchedPage } from "@/lib/research/types";

export class ResearchPlaywrightFetcher {
  private browser: Browser | null = null;

  async fetch(url: string, allowLocal = false): Promise<FetchedPage | { error: string }> {
    const allowed = isFetchUrlAllowed(url, allowLocal);
    if (!allowed.ok) return { error: allowed.message };
    applyPlaywrightBrowsersPath();
    try {
      if (!this.browser) {
        const { chromium } = await import("playwright");
        this.browser = await chromium.launch({
          headless: true,
          args: ["--disable-dev-shm-usage"],
        });
      }
      const page = await this.browser.newPage();
      try {
        const response = await page.goto(allowed.url, {
          waitUntil: "load",
          timeout: RESEARCH_LIMITS.playwrightTimeoutMs,
        });
        await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
        const finalUrl = canonicalizeUrl(page.url() || allowed.url);
        const finalAllowed = isFetchUrlAllowed(finalUrl, allowLocal);
        if (!finalAllowed.ok) return { error: finalAllowed.message };
        const title = await page.title().catch(() => "");
        const html = await page.content().catch(() => "");
        const visible = await page.locator("body").innerText().catch(() => "");
        const extracted = extractHtmlContent(html, finalUrl, RESEARCH_LIMITS.maxPageChars);
        const text = (visible.trim() || extracted.text).slice(0, RESEARCH_LIMITS.maxPageChars);
        const untrusted = wrapExternalContent(extracted.canonicalUrl || finalUrl, text);
        return {
          url: finalUrl,
          canonicalUrl: canonicalizeUrl(extracted.canonicalUrl || finalUrl),
          domain: domainOf(extracted.canonicalUrl || finalUrl),
          title: title || extracted.title,
          headings: extracted.headings,
          text: untrusted.text,
          excerpt: untrusted.text.slice(0, RESEARCH_LIMITS.maxExcerptChars),
          publishedAt: extracted.publishedAt,
          retrievedAt: new Date().toISOString(),
          method: "playwright",
          status: response?.status(),
          injectionSuspected: untrusted.injectionSuspected,
          structured: extracted.structured,
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Playwright-Abruf fehlgeschlagen" };
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    await this.browser.close().catch(() => undefined);
    this.browser = null;
  }
}
