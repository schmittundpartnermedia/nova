import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isHardBlockedPath } from "@/lib/workspace/hard-blocks";
import { isInjectionAttempt, wrapExternalContent } from "@/lib/research/injection";
import { resolveWorkspacePath } from "@/lib/workspace/paths";
import { looksLikeSecret, redactSecrets, shouldRedactFilePath } from "@/lib/mail/redaction";
import type { KnowledgeSourceType } from "@/types/knowledge";

export const KNOWLEDGE_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxImportFiles: 500,
  maxParseChars: 500_000,
  maxAiExtractChars: 20_000,
  maxEmbedChars: 8_000,
  maxFolderDepth: 8,
  batchSize: 8,
  maxContextChars: 4_000,
  maxExcerptChars: 400,
} as const;

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".astro",
  "coverage",
  "cache",
  ".cache",
  "tmp",
  "temp",
  "vendor",
  ".nova",
  ".turbo",
  ".vercel",
  "__pycache__",
  ".DS_Store",
];

const SECRET_NAMES = [
  /^\.env(?:\.|$)/i,
  /\.pem$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /credentials/i,
  /\.netrc$/i,
  /cookies?\.sqlite$/i,
  /^authorized_keys$/i,
  /\.p12$/i,
  /\.key$/i,
];

const BINARY_WITHOUT_VALUE = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".mp3",
  ".mp4",
  ".mov",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".lock",
];

export function checksumBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function shouldIgnoreName(name: string, extra: string[] = []): boolean {
  const lower = name.toLowerCase();
  if (name === "." || name === "..") return true;
  if (DEFAULT_IGNORE.includes(name) || extra.includes(name) || extra.includes(lower)) return true;
  if (SECRET_NAMES.some((pattern) => pattern.test(name))) return true;
  return false;
}

export function isSecretPath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (shouldRedactFilePath(filePath)) return true;
  if (SECRET_NAMES.some((pattern) => pattern.test(base))) return true;
  if (isHardBlockedPath(filePath)) return true;
  return false;
}

export function isLowValueBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_WITHOUT_VALUE.includes(ext);
}

export function detectSourceType(filePath: string, mimeType?: string): KnowledgeSourceType {
  const ext = path.extname(filePath).toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === ".pdf" || mime.includes("pdf")) return "pdf";
  if (ext === ".docx" || mime.includes("wordprocessingml")) return "docx";
  if (ext === ".xlsx" || mime.includes("spreadsheetml")) return "xlsx";
  if (ext === ".csv" || mime.includes("csv")) return "csv";
  if (ext === ".json" || mime.includes("json")) return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".txt" || mime.startsWith("text/plain")) return "txt";
  if (ext === ".html" || ext === ".htm" || mime.includes("html")) return "html";
  if (ext === ".xml" || mime.includes("xml")) return "xml";
  if (ext === ".eml" || ext === ".mbox") return "email";
  if (ext === ".zip") return "zip";
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(ext)) return "repository";
  if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext) || mime.startsWith("audio/")) return "audio";
  if ([".mp4", ".mov", ".webm", ".m4v", ".avi"].includes(ext) || mime.startsWith("video/")) return "video";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".psd"].includes(ext) || mime.startsWith("image/")) return "image";
  return "unknown";
}

export function assertKnowledgePath(requested: string) {
  const resolved = resolveWorkspacePath({ requested, mustExist: true });
  if (resolved.blocked) {
    throw new Error(`Pfad ist hart geschützt: ${resolved.resolved}`);
  }
  if (!resolved.withinAllowed) {
    throw new Error(`Pfad liegt außerhalb erlaubter Arbeitsverzeichnisse: ${resolved.resolved}`);
  }
  if (!resolved.exists) {
    throw new Error(`Pfad existiert nicht: ${resolved.resolved}`);
  }
  if (isSecretPath(resolved.resolved)) {
    throw new Error("Geheimnisse und geschützte Dateien werden nicht ingestiert.");
  }
  return resolved;
}

export function readAllowedFile(requested: string, maxBytes = KNOWLEDGE_LIMITS.maxFileBytes): {
  path: string;
  bytes: Buffer;
  size: number;
  mtime: Date;
} {
  const resolved = assertKnowledgePath(requested);
  const stat = fs.statSync(resolved.resolved);
  if (!stat.isFile()) {
    throw new Error(`Kein Datei-Pfad: ${resolved.resolved}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`Datei überschreitet das Import-Limit (${maxBytes} Bytes).`);
  }
  const bytes = fs.readFileSync(resolved.resolved);
  return { path: resolved.resolved, bytes, size: stat.size, mtime: stat.mtime };
}

export function redactKnowledgeText(text: string): string {
  return redactSecrets(text).slice(0, KNOWLEDGE_LIMITS.maxParseChars);
}

export function documentLooksLikeSecret(text: string): boolean {
  return looksLikeSecret(text);
}

export function inspectUntrustedDocument(origin: string, text: string) {
  const wrapped = wrapExternalContent(origin, text);
  return {
    ...wrapped,
    injectionSuspected: wrapped.injectionSuspected || isInjectionAttempt(text),
  };
}

export function versionLabelFromName(name: string): { group: string; label: string | null; number: number } {
  const base = path.basename(name).replace(/\.[^.]+$/, "");
  const match = base.match(/^(.*?)[-_. ]v(?:ersion)?[-_. ]?(\d+)$/i) ?? base.match(/^(.*?)\((\d+)\)$/);
  if (match) {
    return { group: match[1].trim().toLowerCase().replace(/\s+/g, "-"), label: `v${match[2]}`, number: Number(match[2]) };
  }
  return { group: base.trim().toLowerCase().replace(/\s+/g, "-"), label: null, number: 1 };
}

export function languageOf(text: string): string {
  return /[äöüß]|und |für |nicht |entscheid/i.test(text) ? "de" : "en";
}

export function clip(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}
