import { wrapExternalContent } from "@/lib/computer/injection";
import { extractHtmlContent, looksLikeJsShell } from "@/lib/research/html";
import { RESEARCH_LIMITS } from "@/lib/research/limits";
import { canonicalizeUrl, domainOf, isFetchUrlAllowed } from "@/lib/research/url";
import type { FetchedPage } from "@/lib/research/types";

export type FetchOptions = {
  allowLocal?: boolean;
};

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, RESEARCH_LIMITS.maxBodyBytes);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < RESEARCH_LIMITS.maxBodyBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    size += value.byteLength;
  }
  try {
    reader.releaseLock();
  } catch {
    // ignore
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export async function fetchHttpPage(url: string, options: FetchOptions = {}): Promise<FetchedPage | { error: string }> {
  const allowed = isFetchUrlAllowed(url, options.allowLocal === true);
  if (!allowed.ok) return { error: allowed.message };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_LIMITS.httpTimeoutMs);
  try {
    const response = await fetch(allowed.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "NOVA-Research/0.1 (+local assistant)",
      },
    });
    const finalUrl = canonicalizeUrl(response.url || allowed.url);
    const finalAllowed = isFetchUrlAllowed(finalUrl, options.allowLocal === true);
    if (!finalAllowed.ok) return { error: finalAllowed.message };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml|text\/plain|application\/json/i.test(contentType) && contentType) {
      return { error: `Unpassender Inhaltstyp: ${contentType}` };
    }
    const raw = await readLimited(response);
    const extracted = extractHtmlContent(raw, finalUrl, RESEARCH_LIMITS.maxPageChars);
    const untrusted = wrapExternalContent(extracted.canonicalUrl || finalUrl, extracted.text);
    const needsJs = looksLikeJsShell(extracted.text, raw);
    return {
      url: finalUrl,
      canonicalUrl: canonicalizeUrl(extracted.canonicalUrl || finalUrl),
      domain: domainOf(extracted.canonicalUrl || finalUrl),
      title: extracted.title,
      headings: extracted.headings,
      text: untrusted.text,
      excerpt: untrusted.text.slice(0, RESEARCH_LIMITS.maxExcerptChars),
      publishedAt: extracted.publishedAt,
      retrievedAt: new Date().toISOString(),
      method: "http",
      status: response.status,
      injectionSuspected: untrusted.injectionSuspected,
      structured: {
        ...(extracted.structured ?? {}),
        needsJs,
        contentType,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Abruf fehlgeschlagen";
    return { error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function isFetchedPage(value: FetchedPage | { error: string }): value is FetchedPage {
  return "canonicalUrl" in value && "text" in value;
}
