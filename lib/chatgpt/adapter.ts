import fs from "node:fs";
import path from "node:path";
import { checksumBytes, inspectUntrustedDocument, isLowValueBinary, isSecretPath, redactKnowledgeText } from "@/lib/knowledge/security";
import { listZipEntries, readZipEntry, readZipEntryByName } from "@/lib/knowledge/zip";
import { asRawConversations, reconstructConversation } from "@/lib/chatgpt/graph";
import type { ChatGPTExportManifest, ImportedAttachment, ImportedConversation, ImportedMessage } from "@/types/chatgpt";

export const CHATGPT_LIMITS = {
  maxZipBytes: 2 * 1024 * 1024 * 1024,
  maxConversationsJsonBytes: 800 * 1024 * 1024,
  maxConversations: 50_000,
  batchSize: 8,
} as const;

export type ChatGPTExportSource = {
  zipBytes?: Buffer;
  jsonBytes?: Buffer;
  filePath?: string;
};

function looksLikeZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isChatGPTExportZip(bytes: Buffer): boolean {
  if (!looksLikeZip(bytes)) return false;
  try {
    const inspected = inspectChatGPTExport({ zipBytes: bytes });
    return inspected.kind === "zip" && Boolean(inspected.manifest.conversationsPath);
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".Spotlight-V100", ".fseventsd", ".Trashes"]);

export function findChatGPTExportFile(root: string): string | null {
  const resolved = path.resolve(root);
  let best: string | null = null;
  const walk = (dir: string, depth: number) => {
    if (best && /chatgpt/i.test(best)) return;
    if (depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const ordered = [...entries].sort((a, b) => Number(/chatgpt/i.test(b.name)) - Number(/chatgpt/i.test(a.name)));
    for (const entry of ordered) {
      if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.zip$/i.test(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size < 32 || stat.size > CHATGPT_LIMITS.maxZipBytes) continue;
        if (/chatgpt/i.test(full) || /chatgpt/i.test(dir)) {
          best = full;
          return;
        }
        if (!best) best = full;
      } catch {
        continue;
      }
    }
  };
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile() && /\.zip$/i.test(resolved)) return resolved;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) walk(resolved, 0);
  } catch {
    return null;
  }
  return best;
}

function sanitizeMessage(message: ImportedMessage): ImportedMessage {
  const untrusted = inspectUntrustedDocument(`chatgpt:${message.externalId}`, message.content);
  const redacted = redactKnowledgeText(message.content);
  return {
    ...message,
    content: redacted,
    injectionSuspected: untrusted.injectionSuspected,
    secretRedacted: redacted !== message.content,
    codeBlocks: message.codeBlocks.map((block) => ({
      ...block,
      code: redactKnowledgeText(block.code),
    })),
    links: message.links,
  };
}

function sanitizeConversation(conversation: ImportedConversation): ImportedConversation {
  return {
    ...conversation,
    primaryPath: conversation.primaryPath.map(sanitizeMessage),
    alternativeBranches: conversation.alternativeBranches.map((branch) => branch.map(sanitizeMessage)),
  };
}

function discoverFromNames(names: string[]): ChatGPTExportManifest {
  const normalized = names.map((name) => name.replace(/\\/g, "/"));
  const conversationsPath = normalized.find((name) => /(^|\/)conversations\.json$/i.test(name));
  const userPath = normalized.find((name) => /(^|\/)user\.json$/i.test(name));
  const htmlPath = normalized.find((name) => /(^|\/)chat\.html$/i.test(name));
  const attachmentPaths = normalized.filter((name) => {
    if (name.endsWith("/")) return false;
    if (/\.json$/i.test(name) || /\.html$/i.test(name)) return false;
    return /(^|\/)(files|uploads|attachments)\//i.test(name) || /\.(pdf|docx|xlsx|csv|txt|md|json|png|jpg|jpeg|webp)$/i.test(name);
  });
  const otherJson = normalized.filter((name) => /\.json$/i.test(name) && !/(^|\/)conversations\.json$/i.test(name));
  return {
    conversationsPath,
    userPath,
    htmlPath,
    attachmentPaths,
    otherJson,
    conversationCount: 0,
  };
}

function matchAttachment(entries: Array<{ name: string }>, attachment: ImportedAttachment): string | undefined {
  const id = attachment.externalId.replace(/^file-service:\/\//, "").toLowerCase();
  const base = path.basename(attachment.name).toLowerCase();
  const hit = entries.find((entry) => {
    const name = entry.name.replace(/\\/g, "/").toLowerCase();
    return name.includes(id) || path.basename(name) === base;
  });
  return hit?.name;
}

export function inspectChatGPTExport(source: ChatGPTExportSource): { kind: "zip" | "json"; manifest: ChatGPTExportManifest; bytes: Buffer } {
  let bytes = source.zipBytes ?? source.jsonBytes;
  let filePath = source.filePath;
  if (!bytes && filePath) {
    const located = findChatGPTExportFile(filePath);
    if (located) filePath = located;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      throw new Error("Kein ChatGPT-Export gefunden.");
    }
    if (stat.size > CHATGPT_LIMITS.maxZipBytes) {
      throw new Error("ChatGPT-Export überschreitet das Import-Limit.");
    }
    bytes = fs.readFileSync(filePath);
  }
  if (!bytes || !bytes.length) {
    throw new Error("Kein ChatGPT-Export gefunden.");
  }
  if (looksLikeZip(bytes)) {
    const names = listZipEntries(bytes).map((entry) => entry.name);
    return { kind: "zip", manifest: discoverFromNames(names), bytes };
  }
  return {
    kind: "json",
    manifest: discoverFromNames([source.filePath ? path.basename(source.filePath) : "conversations.json"]),
    bytes,
  };
}

export function parseChatGPTExport(source: ChatGPTExportSource): {
  conversations: ImportedConversation[];
  manifest: ChatGPTExportManifest;
  zipBytes?: Buffer;
} {
  const inspected = inspectChatGPTExport(source);
  let jsonBytes: Buffer | null = inspected.kind === "json" ? inspected.bytes : null;
  if (inspected.kind === "zip") {
    if (!inspected.manifest.conversationsPath) {
      throw new Error("ZIP enthält keine conversations.json. chat.html allein reicht nicht.");
    }
    jsonBytes = readZipEntryByName(inspected.bytes, inspected.manifest.conversationsPath);
  }
  if (!jsonBytes) {
    throw new Error("conversations.json konnte nicht gelesen werden.");
  }
  if (jsonBytes.length > CHATGPT_LIMITS.maxConversationsJsonBytes) {
    throw new Error("conversations.json ist zu groß.");
  }
  const rawText = jsonBytes.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("conversations.json ist kein gültiges JSON.");
  }
  const conversations = asRawConversations(parsed)
    .slice(0, CHATGPT_LIMITS.maxConversations)
    .map(reconstructConversation)
    .filter((item): item is ImportedConversation => Boolean(item))
    .map(sanitizeConversation);

  if (inspected.kind === "zip") {
    const zipEntries = listZipEntries(inspected.bytes);
    for (const conversation of conversations) {
      for (const message of [...conversation.primaryPath, ...conversation.alternativeBranches.flat()]) {
        for (const attachment of message.attachments) {
          const zipPath = matchAttachment(zipEntries, attachment);
          if (zipPath) {
            attachment.zipPath = zipPath;
            try {
              const data = readZipEntry(inspected.bytes, zipEntries.find((entry) => entry.name === zipPath)!);
              attachment.size = data.length;
              attachment.checksum = checksumBytes(data);
            } catch {
              attachment.zipPath = zipPath;
            }
          }
        }
      }
    }
  }

  return {
    conversations,
    manifest: { ...inspected.manifest, conversationCount: conversations.length },
    zipBytes: inspected.kind === "zip" ? inspected.bytes : undefined,
  };
}

export function loadAttachmentBytes(zipBytes: Buffer | undefined, attachment: ImportedAttachment): Buffer | null {
  if (!zipBytes || !attachment.zipPath) return null;
  if (isSecretPath(attachment.zipPath) || isSecretPath(attachment.name)) return null;
  try {
    const bytes = readZipEntryByName(zipBytes, attachment.zipPath);
    return bytes && bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

export function isImageAttachment(attachment: ImportedAttachment): boolean {
  const name = attachment.name || attachment.zipPath || "";
  return isLowValueBinary(name) && /\.(png|jpe?g|gif|webp|ico)$/i.test(name);
}
