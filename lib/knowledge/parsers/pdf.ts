import { inflateSync } from "node:zlib";
import type { KnowledgeParser, KnowledgeParserSource, ParsedDocument, ParsedSection } from "@/types/knowledge";
import { inspectUntrustedDocument, languageOf, redactKnowledgeText } from "@/lib/knowledge/security";

function pdfEscapeDecode(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes = Buffer.from(clean, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return bytes.subarray(2).toString("utf16le").replace(/\0/g, "");
  }
  return bytes.toString("latin1");
}

function extractTextFromStream(content: string): string {
  const parts: string[] = [];
  const literal = /\((?:\\.|[^\\)])*\)/g;
  const hex = /<([0-9A-Fa-f\s]+)>/g;
  const tj = /\[([\s\S]*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = tj.exec(content))) {
    const inner = match[1];
    let piece: RegExpExecArray | null;
    const lit = /\((?:\\.|[^\\)])*\)/g;
    while ((piece = lit.exec(inner))) {
      parts.push(pdfEscapeDecode(piece[0].slice(1, -1)));
    }
    const hx = /<([0-9A-Fa-f\s]+)>/g;
    while ((piece = hx.exec(inner))) {
      parts.push(decodeHexString(piece[1]));
    }
    parts.push("\n");
  }
  content.replace(/BT([\s\S]*?)ET/g, (_all, block: string) => {
    let found = false;
    let piece: RegExpExecArray | null;
    literal.lastIndex = 0;
    while ((piece = literal.exec(block))) {
      if (block.includes("Tj") || block.includes("TJ") || block.includes("'")) {
        parts.push(pdfEscapeDecode(piece[0].slice(1, -1)));
        found = true;
      }
    }
    hex.lastIndex = 0;
    while ((piece = hex.exec(block))) {
      parts.push(decodeHexString(piece[1]));
      found = true;
    }
    if (found) parts.push("\n");
    return _all;
  });
  const joined = parts.join(" ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (joined) return joined;
  const fallback: string[] = [];
  literal.lastIndex = 0;
  while ((match = literal.exec(content))) {
    const text = pdfEscapeDecode(match[0].slice(1, -1)).trim();
    if (text.length > 1) fallback.push(text);
  }
  return fallback.join("\n").trim();
}

function inflatePdfStream(raw: Buffer, encoded: string): string {
  if (/\/FlateDecode/.test(encoded) || /\/Filter\s*\/FlateDecode/.test(encoded)) {
    try {
      return inflateSync(raw).toString("latin1");
    } catch {
      try {
        return inflateSync(raw.subarray(2)).toString("latin1");
      } catch {
        return raw.toString("latin1");
      }
    }
  }
  return raw.toString("latin1");
}

function parsePdfObjects(bytes: Buffer): Array<{ id: string; dict: string; stream?: string }> {
  const latin = bytes.toString("latin1");
  const objects: Array<{ id: string; dict: string; stream?: string }> = [];
  const objRe = /(\d+\s+\d+)\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objRe.exec(latin))) {
    const body = match[2];
    const streamIdx = body.indexOf("stream");
    if (streamIdx >= 0) {
      const dict = body.slice(0, streamIdx);
      let start = streamIdx + 6;
      if (body[start] === "\r") start += 1;
      if (body[start] === "\n") start += 1;
      const end = body.lastIndexOf("endstream");
      const raw = Buffer.from(body.slice(start, end < 0 ? body.length : end), "latin1");
      objects.push({ id: match[1], dict, stream: inflatePdfStream(raw, dict) });
    } else {
      objects.push({ id: match[1], dict: body });
    }
  }
  return objects;
}

export function parsePdfBuffer(source: KnowledgeParserSource): ParsedDocument {
  const objects = parsePdfObjects(source.bytes);
  const pages = objects.filter((obj) => /\/Type\s*\/Page[^s]/.test(obj.dict) || /\/Type\s*\/Page\b/.test(obj.dict));
  const sections: ParsedSection[] = [];
  const texts: string[] = [];
  const pageObjects = pages.length > 0 ? pages : objects.filter((obj) => obj.stream && /Tj|TJ/.test(obj.stream));
  pageObjects.forEach((page, index) => {
    const contentRefs = [...page.dict.matchAll(/\/Contents\s+(\d+\s+\d+)\s+R/g)].map((item) => item[1]);
    const streams = contentRefs.length
      ? objects.filter((obj) => contentRefs.includes(obj.id) && obj.stream).map((obj) => obj.stream as string)
      : page.stream
        ? [page.stream]
        : [];
    const text = redactKnowledgeText(streams.map(extractTextFromStream).filter(Boolean).join("\n"));
    if (!text) return;
    texts.push(text);
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.slice(0, 80);
    sections.push({
      id: `page-${index + 1}`,
      heading,
      content: text,
      page: index + 1,
      hierarchy: 1,
      metadata: { page: index + 1 },
    });
  });
  if (sections.length === 0) {
    const all = objects.map((obj) => (obj.stream ? extractTextFromStream(obj.stream) : "")).filter(Boolean).join("\n");
    const text = redactKnowledgeText(all);
    if (text) {
      sections.push({ id: "page-1", content: text, page: 1, hierarchy: 1 });
      texts.push(text);
    }
  }
  const fulltext = texts.join("\n\n").trim();
  const info = objects.find((obj) => /\/Title|\/Author/.test(obj.dict));
  const titleMatch = info?.dict.match(/\/Title\s*\(([^\)]*)\)/);
  const title = titleMatch?.[1] || source.name.replace(/\.pdf$/i, "");
  const untrusted = inspectUntrustedDocument(source.originalPath ?? source.name, fulltext);
  return {
    title,
    documentType: "document",
    language: languageOf(fulltext),
    metadata: {
      pages: sections.length,
      parser: "pdf",
      hasTextLayer: fulltext.length > 0,
    },
    sections,
    tables: [],
    entities: [],
    dates: [],
    references: [],
    fulltext,
    ocrRequired: fulltext.length === 0,
    injectionSuspected: untrusted.injectionSuspected,
  };
}

export const pdfParser: KnowledgeParser = {
  id: "pdf",
  supports(source) {
    return source.sourceType === "pdf" || source.name.toLowerCase().endsWith(".pdf") || source.bytes.subarray(0, 5).toString() === "%PDF-";
  },
  async parse(source) {
    return parsePdfBuffer(source);
  },
};

export function buildSimplePdf(pages: string[][], title = "NOVA Knowledge Fixture"): Buffer {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds: number[] = [];
  const fontId = 3;
  objects.push(""); // pages placeholder
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentIds: number[] = [];
  for (const lines of pages) {
    const ops = ["BT /F1 12 Tf 50 740 Td"];
    lines.forEach((line, index) => {
      const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      ops.push(index === 0 ? `(${escaped}) Tj` : `0 -18 Td (${escaped}) Tj`);
    });
    ops.push("ET");
    const stream = ops.join("\n");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(objects.length);
  }
  for (let i = 0; i < pages.length; i += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    pageIds.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects.push(`<< /Title (${title.replace(/[()]/g, "")}) >>`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
