export type ConnectorType =
  | "mail"
  | "calendar"
  | "search"
  | "storage"
  | "tasks"
  | "contacts"
  | "browser";

export type MailDeliveryStatus =
  | "PREPARED"
  | "WAITING_FOR_APPROVAL"
  | "SENDING"
  | "SENT"
  | "VERIFIED"
  | "FAILED";

export type MailAddress = {
  name?: string;
  email: string;
};

export type MailSendInput = {
  organizationId: string;
  accountId?: string;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
};

export type MailSendResult = {
  ok: boolean;
  executed: boolean;
  messageId?: string;
  messageUrl?: string;
  reason: string;
  mock: boolean;
  status: MailDeliveryStatus;
};

export type MailProviderFolder = {
  id: string;
  name: string;
  role: "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash" | "other";
};

export type MailProviderAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
};

export type MailProviderMessage = {
  providerMessageId: string;
  providerThreadId: string;
  internetMessageId?: string;
  folder: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  sentAt?: string;
  receivedAt?: string;
  isRead: boolean;
  direction: "inbound" | "outbound";
  headers: Record<string, string>;
  attachments: MailProviderAttachment[];
  uid?: number;
  uidValidity?: string;
  inReplyTo?: string;
  references?: string[];
};

export type MailProviderDraft = {
  providerMessageId: string;
  providerThreadId?: string;
  subject: string;
  body: string;
};

export type MailListQuery = {
  organizationId: string;
  accountId: string;
  folder?: string;
  sinceUid?: number;
  uidValidity?: string;
  limit?: number;
};

export type MailActionResult = {
  ok: boolean;
  executed: boolean;
  reason: string;
};

export interface MailProvider {
  id: string;
  mock: boolean;
  authStatus(organizationId: string): Promise<{ connected: boolean; reason: string }>;
  listAccounts(organizationId: string): Promise<Array<{ id: string; emailAddress: string; displayName?: string }>>;
  listFolders(organizationId: string, accountId: string): Promise<MailProviderFolder[]>;
  listMessages(query: MailListQuery): Promise<MailProviderMessage[]>;
  getMessage(organizationId: string, accountId: string, providerMessageId: string): Promise<MailProviderMessage | null>;
  getThread(organizationId: string, threadId: string): Promise<MailProviderMessage[] | null>;
  search(organizationId: string, query: string): Promise<MailProviderMessage[]>;
  createDraft(input: MailSendInput): Promise<MailProviderDraft>;
  updateDraft(organizationId: string, draftId: string, patch: Partial<MailSendInput>): Promise<MailProviderDraft>;
  sendDraft(organizationId: string, draftId: string): Promise<MailSendResult>;
  send(input: MailSendInput): Promise<MailSendResult>;
  reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult>;
  forward(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult>;
  markRead(organizationId: string, accountId: string, providerMessageId: string): Promise<MailActionResult>;
  archive(organizationId: string, accountId: string, providerMessageId: string): Promise<MailActionResult>;
  attachmentMetadata(organizationId: string, accountId: string, providerMessageId: string): Promise<MailProviderAttachment[]>;
  downloadAttachment(input: {
    organizationId: string;
    accountId: string;
    providerMessageId: string;
    attachmentId: string;
  }): Promise<{ ok: boolean; bytes?: Buffer; filename?: string; mimeType?: string; reason: string }>;
  healthCheck(organizationId: string, accountId?: string): Promise<{ ok: boolean; live: boolean; reason: string }>;
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
