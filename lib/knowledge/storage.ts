import fs from "node:fs";
import path from "node:path";

function safeFileName(name: string): string {
  const base = path.basename(name).trim() || "datei";
  return base.replace(/[^\w.\- ()äöüÄÖÜß]+/g, "_").slice(0, 180);
}

export function knowledgeUploadRoot(): string {
  const dir = path.join(process.cwd(), ".nova", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function persistKnowledgeUpload(input: { importId: string; filename: string; bytes: Buffer }): string {
  const dir = path.join(knowledgeUploadRoot(), input.importId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safeFileName(input.filename));
  fs.writeFileSync(filePath, input.bytes);
  return filePath;
}
