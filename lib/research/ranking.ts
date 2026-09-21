import { domainOf } from "@/lib/research/url";
import type { RankedSearchResult, TrustTier } from "@/lib/research/types";
import type { SearchResult } from "@/types/connectors";

const OFFICIAL_HOSTS = [
  "bund.de",
  "bundesregierung.de",
  "bundeskanzler.de",
  "bundestag.de",
  "bundesrat.de",
  "destatis.de",
  "bundesbank.de",
  "europa.eu",
  "ec.europa.eu",
  "who.int",
  "un.org",
  "oecd.org",
  "imf.org",
  "worldbank.org",
  "nasa.gov",
  "nih.gov",
  "cdc.gov",
  "gov.uk",
  "whitehouse.gov",
];

const DOCUMENT_HINTS = /(docs?|documentation|developer|rfc|gesetz|verordnung|whitepaper|pdf)/i;
const SPECIALIST_HINTS = /(arxiv|ieee|acm.org|pubmed|springer|nature.com|science.org|harvard|stanford|mit.edu)/i;
const MEDIA_HOSTS = [
  "tagesschau.de",
  "zeit.de",
  "faz.net",
  "sueddeutsche.de",
  "spiegel.de",
  "handelsblatt.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "ft.com",
  "wsj.com",
  "theguardian.com",
  "npr.org",
];
const COMMUNITY_HOSTS = [
  "reddit.com",
  "news.ycombinator.com",
  "quora.com",
  "stackoverflow.com",
  "medium.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "tiktok.com",
  "youtube.com",
];

function hostMatches(domain: string, suffixes: string[]): boolean {
  return suffixes.some((item) => domain === item || domain.endsWith(`.${item}`));
}

export function trustTierOf(url: string, query?: string): TrustTier {
  const domain = domainOf(url);
  if (!domain) return "other";
  if (hostMatches(domain, OFFICIAL_HOSTS) || /\.gov$|\.gov\./.test(domain) || domain.endsWith(".bund.de")) {
    return "official";
  }
  if (query) {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9äöüß.-]+/i)
      .filter((token) => token.length > 3);
    if (tokens.some((token) => domain.includes(token) && !hostMatches(domain, COMMUNITY_HOSTS))) {
      return "primary";
    }
  }
  if (DOCUMENT_HINTS.test(url) || DOCUMENT_HINTS.test(domain)) return "document";
  if (SPECIALIST_HINTS.test(domain) || domain.endsWith(".edu") || domain.endsWith(".ac.uk")) return "specialist";
  if (hostMatches(domain, MEDIA_HOSTS)) return "media";
  if (hostMatches(domain, COMMUNITY_HOSTS) || /forum|community|board/i.test(domain)) return "community";
  return "other";
}

const TIER_SCORE: Record<TrustTier, number> = {
  primary: 100,
  official: 95,
  document: 85,
  specialist: 78,
  media: 64,
  other: 40,
  community: 22,
};

export function rankSearchResults(results: SearchResult[], query?: string): RankedSearchResult[] {
  const seen = new Set<string>();
  const ranked: RankedSearchResult[] = [];
  for (const result of results) {
    const canonicalUrl = result.url;
    const domain = domainOf(canonicalUrl);
    const key = `${domain}|${canonicalUrl.replace(/\/+$/, "")}`;
    if (!canonicalUrl || seen.has(key)) continue;
    seen.add(key);
    const trustTier = trustTierOf(canonicalUrl, query);
    ranked.push({
      ...result,
      canonicalUrl,
      domain,
      trustTier,
      trustScore: TIER_SCORE[trustTier] + Math.max(0, 12 - result.rank),
    });
  }
  ranked.sort((a, b) => b.trustScore - a.trustScore || a.rank - b.rank);
  return ranked;
}

export function selectSourcesToFetch(results: RankedSearchResult[], limit: number): RankedSearchResult[] {
  const selected: RankedSearchResult[] = [];
  const domains = new Set<string>();
  for (const result of results) {
    if (selected.length >= limit) break;
    const domainCount = [...selected].filter((item) => item.domain === result.domain).length;
    if (domainCount >= 2 && domains.size >= 2) continue;
    selected.push(result);
    domains.add(result.domain);
  }
  if (selected.length < Math.min(3, limit)) {
    for (const result of results) {
      if (selected.length >= limit) break;
      if (selected.some((item) => item.canonicalUrl === result.canonicalUrl)) continue;
      selected.push(result);
    }
  }
  return selected.slice(0, limit);
}

export function isCommunityOnlyEvidence(tiers: TrustTier[]): boolean {
  return tiers.length > 0 && tiers.every((tier) => tier === "community" || tier === "other");
}
