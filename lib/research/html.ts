const DROP_TAGS = "script|style|noscript|iframe|svg|form|nav|footer|header|aside|button";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function collapse(text: string): string {
  return decodeEntities(text)
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const named = html.match(
      new RegExp(`<meta[^>]+(?:name|property|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
    );
    if (named?.[1]) return decodeEntities(named[1]);
    const reversed = html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property|itemprop)=["']${name}["']`, "i"),
    );
    if (reversed?.[1]) return decodeEntities(reversed[1]);
  }
  return null;
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match?.[1]) return null;
  return collapse(match[1].replace(/<[^>]+>/g, " "));
}

function allTagText(html: string, tag: string, limit = 12): string[] {
  const matches = html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"));
  const values: string[] = [];
  for (const match of matches) {
    const text = collapse((match[1] ?? "").replace(/<[^>]+>/g, " "));
    if (text) values.push(text.slice(0, 200));
    if (values.length >= limit) break;
  }
  return values;
}

function canonicalFromHtml(html: string, fallback: string): string {
  const link = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (link?.[1]) {
    try {
      return new URL(link[1], fallback).toString();
    } catch {
      return fallback;
    }
  }
  return metaContent(html, ["og:url"]) ?? fallback;
}

function publishedFromHtml(html: string): string | null {
  const meta = metaContent(html, [
    "article:published_time",
    "og:published_time",
    "pubdate",
    "publish-date",
    "date",
    "DC.date",
  ]);
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const raw = meta || time || null;
  if (!raw) {
    const jsonLd = extractJsonLd(html);
    const date = pickJsonDate(jsonLd);
    return date;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString();
}

function extractJsonLd(html: string): unknown[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const items: unknown[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1] ?? "null") as unknown;
      if (Array.isArray(parsed)) items.push(...parsed);
      else if (parsed) items.push(parsed);
    } catch {
      // ignore malformed json-ld
    }
  }
  return items;
}

function pickJsonDate(items: unknown[]): string | null {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const value = record.datePublished ?? record.dateCreated ?? record.dateModified;
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
    }
  }
  return null;
}

export type ExtractedHtml = {
  title: string;
  canonicalUrl: string;
  headings: string[];
  text: string;
  publishedAt: string | null;
  structured: Record<string, unknown> | null;
};

export function extractHtmlContent(html: string, url: string, maxChars: number): ExtractedHtml {
  const withoutDropped = html.replace(new RegExp(`<(${DROP_TAGS})\\b[\\s\\S]*?<\\/\\1>`, "gi"), " ");
  const withoutComments = withoutDropped.replace(/<!--[\s\S]*?-->/g, " ");
  const main =
    withoutComments.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    withoutComments.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
    withoutComments;
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    tagText(html, "title") ??
    allTagText(html, "h1", 1)[0] ??
    "";
  const headings = [...allTagText(main, "h1", 4), ...allTagText(main, "h2", 8), ...allTagText(main, "h3", 8)];
  const text = collapse(main.replace(/<[^>]+>/g, " ")).slice(0, maxChars);
  const jsonLd = extractJsonLd(html);
  return {
    title: title.slice(0, 300),
    canonicalUrl: canonicalFromHtml(html, url),
    headings: Array.from(new Set(headings)).slice(0, 16),
    text,
    publishedAt: publishedFromHtml(html),
    structured: jsonLd.length ? { jsonLd: jsonLd.slice(0, 4) } : null,
  };
}

export function looksLikeJsShell(text: string, html?: string): boolean {
  if (text.replace(/\s+/g, "").length < 180) {
    if (html && /enable javascript|you need to enable javascript|id=["'](?:root|app|__next)["']/i.test(html)) {
      return true;
    }
    return text.length < 80;
  }
  return false;
}
