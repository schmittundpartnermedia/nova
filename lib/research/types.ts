import type { SearchFreshness, SearchResult } from "@/types/connectors";
import type { MemoryType } from "@/types";

export type KnowledgeKind = "stable" | "current" | "realtime";

export type ResearchIntentKind = "fact" | "news" | "company" | "deep" | "none";

export type TrustTier =
  | "primary"
  | "official"
  | "document"
  | "specialist"
  | "media"
  | "community"
  | "other";

export type ResearchIntent = {
  kind: ResearchIntentKind;
  knowledgeKind: KnowledgeKind;
  language: string;
  country: string;
  freshness: SearchFreshness;
  deep: boolean;
  companyFocus: boolean;
  statusMessage: string;
};

export type SearchPlan = {
  queries: string[];
  language: string;
  country: string;
  freshness: SearchFreshness;
  domains?: string[];
  excludeDomains?: string[];
  fetchLimit: number;
  maxRounds: number;
};

export type RankedSearchResult = SearchResult & {
  canonicalUrl: string;
  domain: string;
  trustTier: TrustTier;
  trustScore: number;
};

export type FetchedPage = {
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  headings: string[];
  text: string;
  excerpt: string;
  publishedAt?: string | null;
  retrievedAt: string;
  method: "http" | "playwright";
  status?: number;
  injectionSuspected: boolean;
  structured?: Record<string, unknown> | null;
};

export type ResearchClaim = {
  text: string;
  sourceIds: string[];
  asOf?: string | null;
};

export type ResearchContradiction = {
  topic: string;
  positions: Array<{ claim: string; sourceId: string }>;
};

export type ResearchCompany = {
  name: string;
  website?: string;
  industry?: string;
  location?: string;
  description?: string;
  services?: string;
  publicContacts?: Array<{ name?: string; role?: string; channel?: string }>;
  partnerships?: string[];
  sourceIds: string[];
};

export type ResearchMemoryCandidate = {
  type: MemoryType;
  title: string;
  content: string;
  sourceId: string;
};

export type ResearchOutput = {
  ok: boolean;
  mock: boolean;
  searchConnected: boolean;
  invented: boolean;
  answer: string;
  asOf?: string;
  confidence: "high" | "medium" | "low" | "none";
  knowledgeKind: KnowledgeKind;
  queries: string[];
  results: RankedSearchResult[];
  fetched: FetchedPage[];
  sourceIds: string[];
  claims: ResearchClaim[];
  contradictions: ResearchContradiction[];
  companies: ResearchCompany[];
  memoryCandidates: ResearchMemoryCandidate[];
  injectionSuspected: boolean;
  usedPlaywright: boolean;
  failureReason?: string;
};
