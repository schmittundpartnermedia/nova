import { createHash } from "node:crypto";
import type { ImportedConversation, ImportedMessage, ImportedMessageRole } from "@/types/chatgpt";

type RawNode = {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: {
    id?: string;
    author?: { role?: string; name?: string };
    create_time?: number | null;
    update_time?: number | null;
    content?: {
      content_type?: string;
      parts?: unknown[];
      text?: string;
    };
    metadata?: Record<string, unknown> | null;
    status?: string;
  } | null;
};

export type RawChatGPTConversation = {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, RawNode>;
  is_archived?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function unixToDate(value: unknown, fallback: Date): Date {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

export function mapRole(raw?: string): ImportedMessageRole {
  const role = (raw ?? "").toLowerCase();
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool" || role === "function") return "tool";
  return "system";
}

function partToText(part: unknown): string {
  if (typeof part === "string") return part;
  const record = asRecord(part);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (record.content_type === "image_asset_pointer") {
    return typeof record.asset_pointer === "string" ? `[image:${record.asset_pointer}]` : "[image]";
  }
  if (typeof record.asset_pointer === "string") return `[file:${record.asset_pointer}]`;
  return "";
}

export function extractMessageText(node: RawNode): string {
  const content = node.message?.content;
  if (!content) return "";
  if (typeof content.text === "string" && content.text.trim()) return content.text;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts.map(partToText).filter(Boolean).join("\n").trim();
}

export function extractCodeBlocks(text: string): Array<{ language?: string; code: string }> {
  const blocks: Array<{ language?: string; code: string }> = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    blocks.push({ language: match[1] || undefined, code: match[2].trim() });
  }
  return blocks;
}

export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s)>\]]+/gi) ?? [];
  return Array.from(new Set(found.map((item) => item.replace(/[.,;]+$/, ""))));
}

export function extractAttachmentPointers(node: RawNode): Array<{ externalId: string; name: string; mimeType?: string }> {
  const out: Array<{ externalId: string; name: string; mimeType?: string }> = [];
  const metadata = node.message?.metadata ?? {};
  const attachments = Array.isArray((metadata as { attachments?: unknown }).attachments)
    ? ((metadata as { attachments: unknown[] }).attachments)
    : [];
  for (const item of attachments) {
    const record = asRecord(item);
    if (!record) continue;
    const id = String(record.id ?? record.file_id ?? record.asset_pointer ?? "");
    const name = String(record.name ?? record.file_name ?? id);
    if (!id && !name) continue;
    out.push({
      externalId: id || name,
      name,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : typeof record.mime_type === "string" ? record.mime_type : undefined,
    });
  }
  const parts = node.message?.content?.parts ?? [];
  for (const part of parts) {
    const record = asRecord(part);
    const pointer = typeof record?.asset_pointer === "string" ? record.asset_pointer : "";
    const fileId = pointer.replace(/^file-service:\/\//, "");
    if (fileId && !out.some((item) => item.externalId === fileId)) {
      out.push({ externalId: fileId, name: fileId });
    }
  }
  return out;
}

function walkPrimaryPath(mapping: Record<string, RawNode>, currentNode?: string | null): string[] {
  const nodes = Object.keys(mapping);
  if (nodes.length === 0) return [];
  let leaf = currentNode && mapping[currentNode] ? currentNode : "";
  if (!leaf) {
    const candidates = nodes.filter((id) => {
      const node = mapping[id];
      return Boolean(node.message) && (!node.children || node.children.length === 0);
    });
    leaf =
      candidates.sort((a, b) => {
        const ta = mapping[a]?.message?.create_time ?? 0;
        const tb = mapping[b]?.message?.create_time ?? 0;
        return tb - ta;
      })[0] ?? nodes[nodes.length - 1];
  }
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = leaf;
  while (cursor && mapping[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);
    cursor = mapping[cursor].parent ?? null;
  }
  path.reverse();
  return path;
}

function collectAlternativeBranches(mapping: Record<string, RawNode>, primary: Set<string>): string[][] {
  const branches: string[][] = [];
  const seen = new Set<string>();
  for (const [id, node] of Object.entries(mapping)) {
    if (primary.has(id) || !node.message || seen.has(id)) continue;
    const branch: string[] = [];
    let cursor: string | null | undefined = id;
    const local = new Set<string>();
    while (cursor && mapping[cursor] && !local.has(cursor) && !primary.has(cursor)) {
      local.add(cursor);
      branch.unshift(cursor);
      cursor = mapping[cursor].parent;
    }
    for (const item of branch) seen.add(item);
    if (branch.length) branches.push(branch);
  }
  return branches;
}

function nodeToMessage(input: {
  nodeId: string;
  node: RawNode;
  conversationId: string;
  branch: "primary" | "alternative";
  fallbackDate: Date;
}): ImportedMessage {
  const text = extractMessageText(input.node);
  const createdAt = unixToDate(input.node.message?.create_time, input.fallbackDate);
  const updatedAt = input.node.message?.update_time
    ? unixToDate(input.node.message.update_time, createdAt)
    : undefined;
  const metadata = input.node.message?.metadata ?? {};
  const model =
    typeof (metadata as { model_slug?: unknown }).model_slug === "string"
      ? (metadata as { model_slug: string }).model_slug
      : undefined;
  return {
    externalId: String(input.node.message?.id ?? input.node.id ?? input.nodeId),
    conversationExternalId: input.conversationId,
    parentExternalId: input.node.parent ? String(input.node.parent) : undefined,
    role: mapRole(input.node.message?.author?.role),
    content: text,
    createdAt,
    updatedAt,
    model,
    branch: input.branch,
    isPrimary: input.branch === "primary",
    attachments: extractAttachmentPointers(input.node),
    codeBlocks: extractCodeBlocks(text),
    links: extractLinks(text),
    injectionSuspected: false,
    secretRedacted: false,
    metadata: {
      nodeId: input.nodeId,
      authorName: input.node.message?.author?.name,
      contentType: input.node.message?.content?.content_type,
      status: input.node.message?.status,
    },
  };
}

export function reconstructConversation(raw: RawChatGPTConversation): ImportedConversation | null {
  const mapping = raw.mapping ?? {};
  const externalId = String(raw.conversation_id ?? raw.id ?? "");
  if (!externalId) return null;
  const createdAt = unixToDate(raw.create_time, new Date(0));
  const updatedAt = unixToDate(raw.update_time, createdAt);
  const primaryIds = walkPrimaryPath(mapping, raw.current_node);
  const primarySet = new Set(primaryIds);
  const toMessages = (ids: string[], branch: "primary" | "alternative") =>
    ids
      .map((id) => {
        const node = mapping[id];
        if (!node?.message) return null;
        return nodeToMessage({
          nodeId: id,
          node,
          conversationId: externalId,
          branch,
          fallbackDate: createdAt,
        });
      })
      .filter((message): message is ImportedMessage => Boolean(message && (message.content || message.attachments.length)));
  const primaryPath = toMessages(primaryIds, "primary");
  const alternativeBranches = collectAlternativeBranches(mapping, primarySet).map((ids) => toMessages(ids, "alternative"));
  const attachments = [
    ...primaryPath.flatMap((item) => item.attachments),
    ...alternativeBranches.flatMap((branch) => branch.flatMap((item) => item.attachments)),
  ];
  const uniqueAttachments = attachments.filter(
    (item, index) => attachments.findIndex((other) => other.externalId === item.externalId && other.name === item.name) === index,
  );
  const checksum = createHash("sha256")
    .update(
      JSON.stringify({
        id: externalId,
        updatedAt: updatedAt.toISOString(),
        primary: primaryPath.map((item) => ({ id: item.externalId, content: item.content })),
      }),
    )
    .digest("hex");
  return {
    externalId,
    source: "CHATGPT",
    title: (raw.title ?? "").trim() || "ChatGPT Konversation",
    createdAt,
    updatedAt,
    checksum,
    primaryPath,
    alternativeBranches: alternativeBranches.filter((branch) => branch.length > 0),
    attachments: uniqueAttachments,
    metadata: {
      archived: Boolean(raw.is_archived),
      currentNode: raw.current_node ?? null,
      nodeCount: Object.keys(mapping).length,
    },
  };
}

export function asRawConversations(parsed: unknown): RawChatGPTConversation[] {
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is RawChatGPTConversation => Boolean(asRecord(item)));
  }
  const record = asRecord(parsed);
  if (!record) return [];
  if (Array.isArray(record.conversations)) {
    return record.conversations.filter((item): item is RawChatGPTConversation => Boolean(asRecord(item)));
  }
  if (record.mapping || record.conversation_id || record.id) {
    return [record as RawChatGPTConversation];
  }
  return [];
}
