import type { EpistemicStatus } from "@/types/knowledge";

export type ChatGPTSource = "CHATGPT";

export type ImportedMessageBranch = "primary" | "alternative";

export type ImportedMessageRole = "user" | "assistant" | "system" | "tool";

export type ImportedAttachment = {
  externalId: string;
  name: string;
  mimeType?: string;
  zipPath?: string;
  size?: number;
  checksum?: string;
};

export type ImportedCodeBlock = {
  language?: string;
  code: string;
};

export type ImportedMessage = {
  externalId: string;
  conversationExternalId: string;
  parentExternalId?: string;
  role: ImportedMessageRole;
  content: string;
  createdAt: Date;
  updatedAt?: Date;
  model?: string;
  branch: ImportedMessageBranch;
  isPrimary: boolean;
  attachments: ImportedAttachment[];
  codeBlocks: ImportedCodeBlock[];
  links: string[];
  injectionSuspected: boolean;
  secretRedacted: boolean;
  metadata: Record<string, unknown>;
};

export type ImportedConversation = {
  externalId: string;
  source: ChatGPTSource;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  checksum: string;
  primaryPath: ImportedMessage[];
  alternativeBranches: ImportedMessage[][];
  attachments: ImportedAttachment[];
  metadata: Record<string, unknown>;
};

export type ChatGPTExportManifest = {
  conversationsPath?: string;
  userPath?: string;
  htmlPath?: string;
  attachmentPaths: string[];
  otherJson: string[];
  conversationCount: number;
};

export type ChatGPTImportPhase =
  | "VALIDATING"
  | "EXTRACTING_ARCHIVE"
  | "DISCOVERING"
  | "PARSING_CONVERSATIONS"
  | "IMPORTING_ARCHIVE"
  | "PROCESSING_KNOWLEDGE"
  | "RESOLVING_ENTITIES"
  | "BUILDING_RELATIONS"
  | "UPDATING_MEMORY"
  | "INDEXING"
  | "VERIFYING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

export type ChatGPTImportCheckpoint = {
  phase: ChatGPTImportPhase;
  processedExternalIds: string[];
  failedExternalIds: string[];
  conversationsTotal: number;
  conversationsImported: number;
  conversationsSkipped: number;
  messagesImported: number;
  attachmentsImported: number;
  itemsCreated: number;
  memoryUpdates: number;
  decisions: number;
  entities: number;
  contradictions: number;
  tokensPrompt: number;
  tokensCompletion: number;
  summary?: string;
};

export type ChatGPTImportResult = {
  ok: boolean;
  cancelled: boolean;
  resumed: boolean;
  incremental: boolean;
  importId: string;
  summary: string;
  reply: string;
  conversationsTotal: number;
  conversationsImported: number;
  conversationsSkipped: number;
  messagesImported: number;
  itemsCreated: number;
  memoryUpdates: number;
  decisions: number;
  entities: number;
  contradictions: number;
  attachmentsImported: number;
  duplicates: number;
  tokensPrompt: number;
  tokensCompletion: number;
  sourceIds: string[];
};

export type ConversationKnowledgeDraft = {
  type: string;
  title: string;
  content: string;
  normalizedKey?: string;
  normalizedValue?: string;
  entityName?: string;
  epistemicStatus: EpistemicStatus;
  messageExternalIds: string[];
  excerpt: string;
  confidence: number;
  relations: Array<{ from: string; type: string; to: string }>;
  occurredAt?: Date;
};
