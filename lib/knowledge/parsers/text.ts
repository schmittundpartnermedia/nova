import type {
  KnowledgeParser,
  KnowledgeParserSource,
  ParsedDocument,
  ParsedSection,
  ParsedTable,
} from "@/types/knowledge";
import { inspectUntrustedDocument, languageOf, redactKnowledgeText } from "@/lib/knowledge/security";

function splitParagraphs(text: string): ParsedSection[] {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((content, index) => {
    const heading = /^#{1,6}\s+/.test(content) || /^.+\n[-=]{3,}$/.test(content) ? content.split("\n")[0].replace(/^#+\s*/, "") : undefined;
    return {
      id: `s-${index + 1}`,
      heading,
      content,
      lineStart: index + 1,
      hierarchy: heading ? 1 : 2,
    };
  });
}

function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let quoted = false;
  const pushCell = () => {
    current.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (current.some((item) => item.trim())) rows.push(current);
    current = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") pushCell();
    else if (ch === "\n") pushRow();
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || current.length) pushRow();
  const headers = (rows.shift() ?? []).map((item) => item.trim());
  return { headers, rows: rows.map((row) => headers.map((_, index) => (row[index] ?? "").trim())) };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function baseDoc(source: KnowledgeParserSource, fulltext: string, extra: Partial<ParsedDocument>): ParsedDocument {
  const text = redactKnowledgeText(fulltext);
  const untrusted = inspectUntrustedDocument(source.originalPath ?? source.name, text);
  return {
    title: source.name.replace(/\.[^.]+$/, ""),
    documentType: extra.documentType ?? "document",
    language: languageOf(text),
    metadata: { parser: extra.metadata?.parser ?? "text", ...(extra.metadata ?? {}) },
    sections: extra.sections ?? splitParagraphs(text),
    tables: extra.tables ?? [],
    entities: extra.entities ?? [],
    dates: extra.dates ?? [],
    references: extra.references ?? [],
    fulltext: text,
    injectionSuspected: untrusted.injectionSuspected,
  };
}

export const txtParser: KnowledgeParser = {
  id: "txt",
  supports(source) {
    return source.sourceType === "txt" || /\.txt$/i.test(source.name);
  },
  async parse(source) {
    return baseDoc(source, source.bytes.toString("utf8"), { metadata: { parser: "txt" } });
  },
};

export const markdownParser: KnowledgeParser = {
  id: "markdown",
  supports(source) {
    return source.sourceType === "markdown" || /\.(md|markdown)$/i.test(source.name);
  },
  async parse(source) {
    const text = source.bytes.toString("utf8");
    const sections: ParsedSection[] = [];
    const lines = text.split(/\r?\n/);
    let current: ParsedSection | null = null;
    lines.forEach((line, index) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        if (current) sections.push(current);
        current = {
          id: `h-${sections.length + 1}`,
          heading: heading[2],
          content: heading[2],
          lineStart: index + 1,
          hierarchy: heading[1].length,
        };
      } else if (current) {
        current.content = `${current.content}\n${line}`.trim();
        current.lineEnd = index + 1;
      } else if (line.trim()) {
        current = { id: `s-${sections.length + 1}`, content: line, lineStart: index + 1, hierarchy: 2 };
      }
    });
    if (current) sections.push(current);
    return baseDoc(source, text, { sections, metadata: { parser: "markdown" } });
  },
};

export const csvParser: KnowledgeParser = {
  id: "csv",
  supports(source) {
    return source.sourceType === "csv" || /\.csv$/i.test(source.name);
  },
  async parse(source) {
    const text = source.bytes.toString("utf8");
    const parsed = parseCsvText(text);
    const table: ParsedTable = {
      id: "csv-1",
      title: source.name,
      sheet: "Sheet1",
      headers: parsed.headers,
      rows: parsed.rows,
    };
    const sections: ParsedSection[] = parsed.rows.map((row, index) => ({
      id: `row-${index + 1}`,
      heading: parsed.headers[0] ? `${parsed.headers[0]}=${row[0]}` : `Zeile ${index + 1}`,
      content: parsed.headers.map((header, col) => `${header}: ${row[col] ?? ""}`).join(" | "),
      lineStart: index + 2,
      hierarchy: 2,
      metadata: { row: index + 2, sheet: "Sheet1" },
    }));
    return baseDoc(source, text, {
      documentType: "spreadsheet",
      tables: [table],
      sections,
      metadata: { parser: "csv", rows: parsed.rows.length, columns: parsed.headers },
    });
  },
};

export const jsonParser: KnowledgeParser = {
  id: "json",
  supports(source) {
    return source.sourceType === "json" || /\.json$/i.test(source.name);
  },
  async parse(source) {
    const raw = source.bytes.toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return baseDoc(source, raw, { metadata: { parser: "json", invalid: true } });
    }
    const records = Array.isArray(value) ? value : [value];
    const sections: ParsedSection[] = [];
    const tables: ParsedTable[] = [];
    if (records.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      const keys = Array.from(new Set(records.flatMap((item) => Object.keys(item as Record<string, unknown>))));
      tables.push({
        id: "json-records",
        title: "JSON Records",
        headers: keys,
        rows: records.map((item) => keys.map((key) => stringifyValue((item as Record<string, unknown>)[key]))),
      });
      records.slice(0, 200).forEach((item, index) => {
        const record = item as Record<string, unknown>;
        sections.push({
          id: `record-${index + 1}`,
          heading: String(record.name ?? record.title ?? record.id ?? `Record ${index + 1}`),
          content: keys.map((key) => `${key}: ${stringifyValue(record[key])}`).join("\n"),
          hierarchy: 2,
          metadata: { recordIndex: index, keys },
        });
      });
    } else {
      sections.push({
        id: "json-root",
        heading: "JSON",
        content: JSON.stringify(value, null, 2).slice(0, 20_000),
        hierarchy: 1,
      });
    }
    return baseDoc(source, raw, {
      documentType: "structured",
      sections,
      tables,
      metadata: { parser: "json", schema: inferSchema(value), recordCount: records.length },
    });
  },
};

export const htmlParser: KnowledgeParser = {
  id: "html",
  supports(source) {
    return source.sourceType === "html" || /\.(html|htm)$/i.test(source.name);
  },
  async parse(source) {
    const raw = source.bytes.toString("utf8");
    const text = stripTags(raw);
    return baseDoc(source, text, { metadata: { parser: "html" } });
  },
};

export const xmlParser: KnowledgeParser = {
  id: "xml",
  supports(source) {
    return source.sourceType === "xml" || /\.xml$/i.test(source.name);
  },
  async parse(source) {
    const raw = source.bytes.toString("utf8");
    const text = stripTags(raw);
    return baseDoc(source, text, { documentType: "structured", metadata: { parser: "xml" } });
  },
};

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function inferSchema(value: unknown): Record<string, string> | string {
  if (Array.isArray(value)) return { type: "array", item: typeof value[0] };
  if (value && typeof value === "object") {
    const schema: Record<string, string> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      schema[key] = Array.isArray(nested) ? "array" : typeof nested;
    }
    return schema;
  }
  return typeof value;
}
