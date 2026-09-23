import type { KnowledgeItemType, SourceLocation } from "@/types/knowledge";
import { clip, KNOWLEDGE_LIMITS } from "@/lib/knowledge/security";

export type SearchableItem = {
  id: string;
  organizationId: string;
  type: string;
  title: string;
  content: string;
  fulltext: string;
  entityName?: string | null;
  normalizedKey?: string | null;
  normalizedValue?: string | null;
  locationJson: string;
  excerpt?: string | null;
  confidence: number;
  sourceId: string;
  sourceName?: string;
  sourceType?: string;
  extractedAt: Date;
  createdAt: Date;
};

export type RankedKnowledgeHit = SearchableItem & {
  score: number;
  reasons: string[];
  location: SourceLocation;
};

function tokensOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function fulltextScore(query: string, item: SearchableItem): number {
  const q = query.toLowerCase();
  const hay = `${item.title} ${item.content} ${item.fulltext}`.toLowerCase();
  if (!q) return 0;
  if (hay.includes(q)) return 1;
  const tokens = tokensOf(query);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => hay.includes(token)).length;
  return hits / tokens.length;
}

export function entityScore(query: string, item: SearchableItem): number {
  const q = query.toLowerCase();
  if (item.entityName && q.includes(item.entityName.toLowerCase())) return 1;
  if (item.type === "PERSON" && /ansprechpartner|kontakt|wer ist/i.test(query)) return 0.8;
  if (item.type === "PRICE" && /preis|kostet|wie hoch/i.test(query)) return 0.9;
  if (item.type === "DEADLINE" && /deadline|frist|wann/i.test(query)) return 0.9;
  if (item.type === "DECISION" && /entscheid/i.test(query)) return 0.9;
  if (item.type === "METRIC" && /umsatz|kennzahl|märz|marz|march/i.test(query)) return 0.85;
  if (item.type === "COMPANY" && /firma|unternehmen/i.test(query)) return 0.6;
  return 0;
}

export function recencyScore(item: SearchableItem, now = Date.now()): number {
  const ageDays = Math.max(0, (now - item.extractedAt.getTime()) / 86_400_000);
  return Math.max(0, 1 - ageDays / 365);
}

export function sourceQuality(sourceType?: string): number {
  if (sourceType === "pdf" || sourceType === "docx") return 0.9;
  if (sourceType === "xlsx" || sourceType === "csv" || sourceType === "json") return 0.85;
  if (sourceType === "markdown" || sourceType === "txt") return 0.7;
  if (sourceType === "chatgpt" || sourceType === "chat") return 0.78;
  if (sourceType === "audio" || sourceType === "video" || sourceType === "image") return 0.55;
  return 0.5;
}

export function hybridScore(input: {
  query: string;
  item: SearchableItem;
  semantic?: number;
  relation?: number;
}): { score: number; reasons: string[] } {
  const full = fulltextScore(input.query, input.item);
  const entity = entityScore(input.query, input.item);
  const recency = recencyScore(input.item);
  const quality = sourceQuality(input.item.sourceType);
  const semantic = input.semantic ?? 0;
  const relation = input.relation ?? 0;
  const score =
    full * 0.28 +
    semantic * 0.22 +
    entity * 0.22 +
    relation * 0.12 +
    recency * 0.08 +
    quality * 0.08;
  const reasons = [
    full > 0 ? "fulltext" : "",
    semantic > 0.15 ? "semantic" : "",
    entity > 0 ? "entity" : "",
    relation > 0 ? "relation" : "",
    "recency",
    "source-quality",
  ].filter(Boolean);
  return { score, reasons };
}

export function parseLocation(json: string): SourceLocation {
  try {
    return JSON.parse(json) as SourceLocation;
  } catch {
    return {};
  }
}

export function formatSourceLocation(name: string, location: SourceLocation): string {
  const parts = [name];
  if (location.page) parts.push(`Seite ${location.page}`);
  if (location.heading) parts.push(`Abschnitt „${location.heading}“`);
  if (location.sheet) parts.push(`Tabelle ${location.sheet}`);
  if (location.cell) parts.push(`Zelle ${location.cell}`);
  if (location.row && !location.cell) parts.push(`Zeile ${location.row}`);
  if (location.conversationTitle) parts.push(`Gespräch „${location.conversationTitle}“`);
  if (location.messageId) parts.push(`Nachricht ${location.messageId}`);
  if (location.occurredAt) parts.push(location.occurredAt.slice(0, 10));
  return parts.join(", ");
}

export function formatKnowledgeAnswer(input: {
  query: string;
  hits: RankedKnowledgeHit[];
  contradictions?: Array<{ topic: string; values: string[] }>;
}): string {
  if (input.hits.length === 0) {
    return "Dazu habe ich in den Unterlagen nichts gefunden.";
  }
  const lines: string[] = [];
  const byType = (type: KnowledgeItemType | string) => input.hits.filter((hit) => hit.type === type);
  if (/preis|wie hoch/i.test(input.query) && byType("PRICE").length) {
    const prices = [...byType("PRICE")].sort((a, b) => a.extractedAt.getTime() - b.extractedAt.getTime());
    if (prices.length >= 2 && /alt|aktuell|später|geändert/i.test(input.query)) {
      const oldest = prices[0];
      const newest = prices[prices.length - 1];
      lines.push(`Alter Preis: ${oldest.content}. Aktueller Preis: ${newest.content}. Quelle: ${formatSourceLocation(newest.sourceName ?? "Dokument", newest.location)}.`);
    } else {
      for (const hit of prices) {
        lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
      }
    }
  } else if (/deadline|frist|wann/i.test(input.query) && byType("DEADLINE").length) {
    for (const hit of byType("DEADLINE")) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  } else if (/ansprechpartner|kontakt|wer/i.test(input.query) && (byType("PERSON").length || byType("CONTACT").length)) {
    for (const hit of [...byType("PERSON"), ...byType("CONTACT")].slice(0, 3)) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  } else if (/entscheid/i.test(input.query) && byType("DECISION").length) {
    for (const hit of byType("DECISION")) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  } else if (/umsatz|märz|marz|march/i.test(input.query) && byType("METRIC").length) {
    for (const hit of byType("METRIC").slice(0, 4)) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  } else if (/gespräch|woher|quelle|damals/i.test(input.query) && input.hits.length) {
    for (const hit of input.hits.slice(0, 4)) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  } else {
    for (const hit of input.hits.slice(0, 4)) {
      lines.push(`${hit.content} Quelle: ${formatSourceLocation(hit.sourceName ?? "Dokument", hit.location)}.`);
    }
  }
  if (input.contradictions && input.contradictions.length > 0) {
    for (const item of input.contradictions) {
      lines.push(`Widerspruch bei ${item.topic}: ${item.values.join(" vs. ")}. Beide Aussagen bleiben erhalten.`);
    }
  }
  return clip(lines.join(" "), KNOWLEDGE_LIMITS.maxContextChars);
}

export function formatImportSummary(input: {
  filesTotal: number;
  relevantFiles: number;
  itemsCreated: number;
  filesFailed: number;
  filesSkipped: number;
  projectName?: string;
  duplicates?: number;
}): string {
  const project = input.projectName ? ` zu ${input.projectName}` : "";
  const main = `Ich habe ${input.filesTotal} Dateien analysiert. ${input.relevantFiles} waren relevant. Daraus habe ich ${input.itemsCreated} Wissenseinträge${project} erstellt.`;
  if (input.filesFailed > 0) return `${main} ${input.filesFailed} Dateien konnte ich nicht lesen.`;
  if (input.duplicates) return `${main} Identische Dateien habe ich nicht doppelt übernommen.`;
  return main;
}

export function formatChatGPTImportSummary(input: {
  conversations: number;
  messages: number;
  items: number;
  decisions: number;
  entities: number;
  contradictions: number;
}): string {
  return `ChatGPT-Verlauf importiert. ${input.conversations} Gespräche, ${input.messages} Nachrichten, ${input.items} relevante Wissenseinträge, ${input.decisions} Entscheidungen, ${input.entities} Projekte/Firmen erkannt, ${input.contradictions} Widersprüche erkannt.`;
}
