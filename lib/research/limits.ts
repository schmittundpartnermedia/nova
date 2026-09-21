export const RESEARCH_LIMITS = {
  maxQueries: 8,
  maxQueryLength: 220,
  maxResultsPerQuery: 10,
  maxUniqueResults: 24,
  maxFetches: 8,
  maxRounds: 3,
  maxPageChars: 12_000,
  maxExcerptChars: 900,
  httpTimeoutMs: 12_000,
  searchTimeoutMs: 35_000,
  playwrightTimeoutMs: 18_000,
  maxRedirects: 5,
  maxBodyBytes: 1_500_000,
} as const;

export function clampQueryCount(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(RESEARCH_LIMITS.maxQueries, Math.floor(value));
}

export function clampFetchCount(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(RESEARCH_LIMITS.maxFetches, Math.floor(value));
}
