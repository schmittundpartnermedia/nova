export type KnowledgeSourceType =
  | "pdf"
  | "txt"
  | "markdown"
  | "docx"
  | "xlsx"
  | "csv"
  | "json"
  | "html"
  | "xml"
  | "email"
  | "chat"
  | "chatgpt"
  | "zip"
  | "folder"
  | "repository"
  | "unknown";

export type KnowledgeSourceStatus =
  | "DISCOVERED"
  | "IMPORTING"
  | "PARSED"
  | "PROCESSING"
  | "INDEXED"
  | "FAILED"
  | "ARCHIVED";

export type KnowledgeImportStatus =
  | "DISCOVERING"
  | "PARSING"
  | "EXTRACTING"
  | "STRUCTURING"
  | "INDEXING"
  | "MEMORY_PROCESSING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED";

export type KnowledgeItemType =
  | "FACT"
  | "DECISION"
  | "TASK"
  | "COMMITMENT"
  | "DEADLINE"
  | "PERSON"
  | "COMPANY"
  | "CONTACT"
  | "PROJECT"
  | "PRODUCT"
  | "SERVICE"
  | "MEETING"
  | "CONTRACT"
  | "PRICE"
  | "METRIC"
  | "PREFERENCE"
  | "PROCESS"
  | "POLICY"
  | "TECHNICAL_FACT"
  | "REFERENCE";

export type KnowledgeDocumentType =
  | "document"
  | "spreadsheet"
  | "structured"
  | "code"
  | "project"
  | "email"
  | "chat"
  | "archive"
  | "unknown";

export type SourceLocation = {
  page?: number;
  heading?: string;
  sectionId?: string;
  lineStart?: number;
  lineEnd?: number;
  sheet?: string;
  row?: number;
  column?: string;
  cell?: string;
  path?: string;
  conversationId?: string;
  messageId?: string;
};

export type ParsedSection = {
  id: string;
  heading?: string;
  content: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  hierarchy: number;
  metadata?: Record<string, unknown>;
};

export type ParsedTable = {
  id: string;
  title?: string;
  sheet?: string;
  page?: number;
  headers: string[];
  rows: string[][];
  metadata?: Record<string, unknown>;
};

export type ParsedEntity = {
  type: KnowledgeItemType;
  name: string;
  value?: string;
  location?: SourceLocation;
  confidence: number;
};

export type ParsedDate = {
  label?: string;
  iso: string;
  raw: string;
  location?: SourceLocation;
};

export type ParsedDocument = {
  sourceId?: string;
  title: string;
  documentType: KnowledgeDocumentType;
  language?: string;
  metadata: Record<string, unknown>;
  sections: ParsedSection[];
  tables: ParsedTable[];
  entities: ParsedEntity[];
  dates: ParsedDate[];
  references: string[];
  fulltext: string;
  ocrRequired?: boolean;
  injectionSuspected?: boolean;
};

export type KnowledgeParserSource = {
  name: string;
  originalPath?: string;
  mimeType?: string;
  bytes: Buffer;
  sourceType?: KnowledgeSourceType;
};

export interface KnowledgeParser {
  id: string;
  supports(source: KnowledgeParserSource): boolean;
  parse(source: KnowledgeParserSource): Promise<ParsedDocument>;
}
