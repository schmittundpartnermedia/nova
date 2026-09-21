export type ConnectorType =
  | "mail"
  | "calendar"
  | "search"
  | "storage"
  | "tasks"
  | "contacts"
  | "browser";

export type MailSendInput = {
  organizationId: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
};

export type MailSendResult = {
  ok: boolean;
  executed: boolean;
  messageId?: string;
  messageUrl?: string;
  reason: string;
  mock: boolean;
};

export interface MailProvider {
  id: string;
  send(input: MailSendInput): Promise<MailSendResult>;
  search(organizationId: string, query: string): Promise<unknown[]>;
  getThread(organizationId: string, threadId: string): Promise<unknown | null>;
  getMessageUrl(organizationId: string, messageId: string): Promise<string | null>;
}

export interface CalendarProvider {
  id: string;
  list(organizationId: string, from: Date, to: Date): Promise<unknown[]>;
  create(organizationId: string, event: Record<string, unknown>): Promise<{ ok: boolean; executed: boolean; eventUrl?: string; reason: string }>;
  update(organizationId: string, eventId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; executed: boolean; reason: string }>;
  cancel(organizationId: string, eventId: string): Promise<{ ok: boolean; executed: boolean; reason: string }>;
  getEventUrl(organizationId: string, eventId: string): Promise<string | null>;
}

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

export interface StorageProvider {
  id: string;
  search(organizationId: string, query: string): Promise<unknown[]>;
  read(organizationId: string, path: string): Promise<string | null>;
  create(organizationId: string, input: { title: string; content: string }): Promise<{ ok: boolean; executed: boolean; url?: string; reason: string }>;
  getUrl(organizationId: string, path: string): Promise<string | null>;
}

export interface TaskProvider {
  id: string;
  list(organizationId: string): Promise<unknown[]>;
}

export interface ContactsProvider {
  id: string;
  search(organizationId: string, query: string): Promise<unknown[]>;
}

export interface BrowserProvider {
  id: string;
  open(organizationId: string, url: string): Promise<{ ok: boolean; executed: boolean; reason: string }>;
}
