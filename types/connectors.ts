/** Websuche (connectors/search/openai.ts). */
export type SearchFreshness = "any" | "day" | "week" | "month";

export type SearchQuery = {
  organizationId: string;
  query: string;
  language?: string;
  country?: string;
  freshness?: SearchFreshness;
  domains?: string[];
  excludeDomains?: string[];
  limit?: number;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  source: string;
  rank: number;
  provider: string;
  metadata?: Record<string, unknown>;
};

export type SearchResponse = {
  mock: boolean;
  results: SearchResult[];
  error?: string;
  queries?: string[];
};

export interface SearchProvider {
  id: string;
  mock: boolean;
  search(input: SearchQuery): Promise<SearchResponse>;
}

