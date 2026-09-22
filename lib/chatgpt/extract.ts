import { extractKnowledgeItems, isDurableKnowledge, type ExtractedKnowledge } from "@/lib/knowledge/extract";
import { inspectUntrustedDocument } from "@/lib/knowledge/security";
import type { ImportedConversation, ImportedMessage, ConversationKnowledgeDraft } from "@/types/chatgpt";
import type { EpistemicStatus, ParsedDocument, ParsedSection } from "@/types/knowledge";
import type { KnowledgeItemType } from "@/types/knowledge";
import type { RelationType } from "@/types";

const LOW_VALUE =
  /^(ok(ay)?|ja|nein|danke|thanks|thx|bitte|hmm+|lol|hi|hallo|hey|sure|cool|super|genau|alles\s+klar)\.?$/i;

const ASSISTANT_FLUFF =
  /^(verstanden\.?|gerne\.?|hier ist|ich habe|natürlich\.?|alles klar\.?)$/i;

function roleStatus(role: string): EpistemicStatus {
  if (role === "user") return "USER_STATED";
  if (role === "assistant") return "ASSISTANT_SUGGESTED";
  if (role === "tool") return "TOOL_VERIFIED";
  return "SYSTEM_OBSERVED";
}

export function isLowValueMessage(message: ImportedMessage): boolean {
  const text = message.content.trim();
  if (!text) return true;
  if (LOW_VALUE.test(text)) return true;
  if (message.role === "assistant" && ASSISTANT_FLUFF.test(text) && text.length < 80) return true;
  return false;
}

export function conversationToParsedDocument(conversation: ImportedConversation): ParsedDocument {
  const messages = conversation.primaryPath.filter((message) => !isLowValueMessage(message));
  const sections: ParsedSection[] = messages.map((message, index) => ({
    id: message.externalId,
    heading: `${message.role} · ${conversation.title}`,
    content: message.content,
    lineStart: index + 1,
    hierarchy: 1,
    metadata: {
      conversationId: conversation.externalId,
      messageId: message.externalId,
      role: message.role,
      createdAt: message.createdAt.toISOString(),
      branch: message.branch,
      isPrimary: message.isPrimary,
      links: message.links,
      codeBlocks: message.codeBlocks,
    },
  }));
  const fulltext = sections.map((section) => `${section.heading}\n${section.content}`).join("\n\n");
  return {
    title: conversation.title,
    documentType: "chat",
    language: /[äöüß]|und |für |nicht |entscheid/i.test(fulltext) ? "de" : "en",
    metadata: {
      parser: "chatgpt-import",
      source: "CHATGPT",
      conversationId: conversation.externalId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    sections,
    tables: [],
    entities: [],
    dates: [],
    references: messages.flatMap((message) => message.links),
    fulltext,
    injectionSuspected: messages.some((message) => message.injectionSuspected),
  };
}

function optionsFromText(text: string): string[] {
  const pair = /(?:option|vorschlag)\s*([A-Z])\s*(?:oder|vs\.?|\/)\s*(?:option|vorschlag)?\s*([A-Z])/i.exec(text)
    ?? /\b([A-Z])\s+oder\s+([A-Z])\b/.exec(text);
  if (pair) return [pair[1].toUpperCase(), pair[2].toUpperCase()];
  const listed = Array.from(text.matchAll(/\boption\s+([A-Z])\b/gi)).map((item) => item[1].toUpperCase());
  return Array.from(new Set(listed));
}

function selectedOption(text: string): string | null {
  const match =
    /wir (?:nehmen|wählen|machen)\s+(?:option\s+)?([A-Z][\w-]*)/i.exec(text) ??
    /(?:entscheiden uns für|entscheidung(?:[:\s]+für)?)\s+(?:option\s+)?([A-Z][\w-]*)/i.exec(text) ??
    /ja mach(?:en)? wir\b.*\b([A-Z])\b/i.exec(text);
  return match ? match[1] : null;
}

function rejectedOption(text: string): string | null {
  const match =
    /(?:option|vorschlag)\s+([A-Z][\w-]*)\s+(?:verwerfen|verworfen|ablehnen|abgelehnt)/i.exec(text) ??
    /(?:verwerfen|nicht)\s+(?:option\s+)?([A-Z])\b/i.exec(text);
  return match ? match[1] : null;
}

function projectName(text: string): string | null {
  const match = /(?:für |bei |projekt[:\s]+)projekt\s+([A-ZÄÖÜ][\wÄÖÜäöüß&-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß&-]*)*)/i.exec(text)
    ?? /projekt\s+([A-ZÄÖÜ][\wÄÖÜäöüß&-]+)/i.exec(text);
  return match ? match[1].trim() : null;
}

function toDraft(item: ExtractedKnowledge, message: ImportedMessage | undefined, epistemic: EpistemicStatus): ConversationKnowledgeDraft {
  return {
    type: item.type,
    title: item.title,
    content: item.content,
    normalizedKey: item.normalizedKey,
    normalizedValue: item.normalizedValue,
    entityName: item.entityName,
    epistemicStatus: epistemic,
    messageExternalIds: message ? [message.externalId] : [],
    excerpt: item.excerpt,
    confidence: item.confidence,
    relations: item.relations,
    occurredAt: message?.createdAt,
  };
}

export function extractConversationKnowledge(conversation: ImportedConversation): ConversationKnowledgeDraft[] {
  const drafts: ConversationKnowledgeDraft[] = [];
  const parsed = conversationToParsedDocument(conversation);
  const heuristic = extractKnowledgeItems(parsed);
  const bySection = new Map(conversation.primaryPath.map((message) => [message.externalId, message]));

  for (const item of heuristic) {
    const message = item.location.sectionId ? bySection.get(item.location.sectionId) : undefined;
    if (message?.secretRedacted && item.type !== "REFERENCE") continue;
    if (message && inspectUntrustedDocument(conversation.title, message.content).injectionSuspected && item.type !== "REFERENCE") {
      continue;
    }
    let epistemic: EpistemicStatus = message ? roleStatus(message.role) : "UNCERTAIN";
    if (item.type === "DECISION" && message?.role === "assistant") epistemic = "ASSISTANT_SUGGESTED";
    drafts.push(toDraft(item, message, epistemic));
  }

  const primary = conversation.primaryPath.filter((message) => !isLowValueMessage(message));
  for (let index = 0; index < primary.length; index += 1) {
    const message = primary[index];
    const previous = primary[index - 1];
    if (message.injectionSuspected) {
      drafts.push({
        type: "REFERENCE",
        title: "Untrusted historical instruction",
        content: "Historische Nachricht enthält eine Anweisung. Sie wird nur als Inhalt gespeichert, nicht ausgeführt.",
        epistemicStatus: "SYSTEM_OBSERVED",
        messageExternalIds: [message.externalId],
        excerpt: message.content.slice(0, 180),
        confidence: 0.99,
        relations: [],
        occurredAt: message.createdAt,
      });
      continue;
    }
    if (message.secretRedacted) continue;

    const options = optionsFromText(`${previous?.content ?? ""}\n${message.content}`);
    const selected = selectedOption(message.content);
    const rejected = rejectedOption(message.content) ?? (selected && options.length === 2 ? options.find((item) => item !== selected) ?? null : null);
    const userConfirmed =
      message.role === "user" &&
      (Boolean(selected) || /ja mach(?:en)? wir|nehmen wir|machen wir|einverstanden|passt/i.test(message.content));
    const assistantOffered = previous?.role === "assistant" && options.length >= 2;
    if (selected && (userConfirmed || (message.role === "user" && rejected))) {
      const project = projectName(`${conversation.title}\n${message.content}\n${previous?.content ?? ""}`);
      const content = project
        ? `Entscheidung für Projekt ${project}: ${selected} gewählt${rejected ? `, Option ${rejected} verworfen` : ""}.`
        : `Entscheidung: ${selected} gewählt${rejected ? `, Option ${rejected} verworfen` : ""}.`;
      const reason = /weil ([^\n.]+)/i.exec(message.content)?.[1];
      drafts.push({
        type: "DECISION",
        title: project ? `Entscheidung ${project}` : "Entscheidung",
        content: reason ? `${content} Grund: ${reason.trim()}` : content,
        normalizedKey: `DECISION:${(project ?? conversation.title).toLowerCase()}`,
        normalizedValue: selected,
        entityName: project ?? undefined,
        epistemicStatus: assistantOffered || previous?.role === "assistant" ? "JOINTLY_DECIDED" : "USER_STATED",
        messageExternalIds: [previous?.externalId, message.externalId].filter((id): id is string => Boolean(id)),
        excerpt: message.content.slice(0, 240),
        confidence: 0.94,
        relations: project ? [{ from: content, type: "relates_to", to: project }] : [],
        occurredAt: message.createdAt,
      });
    }

    const belongs = /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+)+)\s+(?:arbeitet bei|gehört zu|ist Ansprechpartner(?:in)? bei)\s+(?:Firma\s+)?([^\n.]+)/i.exec(
      message.content,
    );
    if (belongs) {
      drafts.push({
        type: "PERSON",
        title: belongs[1].trim(),
        content: `${belongs[1].trim()} gehört zu ${belongs[2].trim()}`,
        entityName: belongs[1].trim(),
        normalizedKey: `PERSON:${belongs[1].trim().toLowerCase()}`,
        normalizedValue: belongs[1].trim(),
        epistemicStatus: roleStatus(message.role),
        messageExternalIds: [message.externalId],
        excerpt: belongs[0],
        confidence: 0.9,
        relations: [{ from: belongs[1].trim(), type: "works_at", to: belongs[2].trim() }],
        occurredAt: message.createdAt,
      });
      drafts.push({
        type: "COMPANY",
        title: belongs[2].trim(),
        content: `Firma ${belongs[2].trim()}`,
        entityName: belongs[2].trim(),
        normalizedKey: `COMPANY:${belongs[2].trim().toLowerCase()}`,
        normalizedValue: belongs[2].trim(),
        epistemicStatus: roleStatus(message.role),
        messageExternalIds: [message.externalId],
        excerpt: belongs[0],
        confidence: 0.88,
        relations: [],
        occurredAt: message.createdAt,
      });
    }
  }

  const unique = new Map<string, ConversationKnowledgeDraft>();
  for (const draft of drafts) {
    const key = `${draft.type}:${draft.normalizedKey ?? draft.title}:${draft.normalizedValue ?? draft.content}`;
    if (!unique.has(key)) unique.set(key, draft);
  }
  return Array.from(unique.values());
}

export function isDurableConversationKnowledge(draft: ConversationKnowledgeDraft): boolean {
  if (draft.epistemicStatus === "ASSISTANT_SUGGESTED") return false;
  return isDurableKnowledge(draft.type as KnowledgeItemType);
}

export function estimatedTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const CHATGPT_RELATION_TYPES: RelationType[] = [
  "works_at",
  "belongs_to",
  "relates_to",
  "product_of",
  "mentions",
  "has_deadline",
  "attached_to",
  "considered_as_partner_for",
  "used_by",
  "supersedes",
];
