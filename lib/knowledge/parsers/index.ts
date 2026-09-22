import { csvParser, htmlParser, jsonParser, markdownParser, txtParser, xmlParser } from "@/lib/knowledge/parsers/text";
import { docxParser, xlsxParser } from "@/lib/knowledge/parsers/office";
import { pdfParser } from "@/lib/knowledge/parsers/pdf";
import { chatgptParser, emailParser, projectParser, zipParser } from "@/lib/knowledge/parsers/special";
import { detectSourceType, inspectUntrustedDocument, languageOf, redactKnowledgeText } from "@/lib/knowledge/security";
import type { KnowledgeParser, KnowledgeParserSource, ParsedDocument } from "@/types/knowledge";

const PARSERS: KnowledgeParser[] = [
  pdfParser,
  docxParser,
  xlsxParser,
  csvParser,
  chatgptParser,
  jsonParser,
  markdownParser,
  htmlParser,
  xmlParser,
  emailParser,
  zipParser,
  projectParser,
  txtParser,
];

const fallbackParser: KnowledgeParser = {
  id: "fallback-text",
  supports() {
    return true;
  },
  async parse(source) {
    const text = redactKnowledgeText(source.bytes.toString("utf8"));
    const binary = text.includes("\u0000") || /[\x00-\x08]/.test(text.slice(0, 200));
    if (binary) {
      return {
        title: source.name,
        documentType: "unknown",
        metadata: { parser: "skipped-binary" },
        sections: [],
        tables: [],
        entities: [],
        dates: [],
        references: [],
        fulltext: "",
        ocrRequired: false,
      };
    }
    return {
      title: source.name,
      documentType: "document",
      language: languageOf(text),
      metadata: { parser: "fallback-text" },
      sections: [{ id: "s-1", content: text, hierarchy: 1 }],
      tables: [],
      entities: [],
      dates: [],
      references: [],
      fulltext: text,
      injectionSuspected: inspectUntrustedDocument(source.name, text).injectionSuspected,
    };
  },
};

export function chooseParser(source: KnowledgeParserSource): KnowledgeParser {
  const typed: KnowledgeParserSource = {
    ...source,
    sourceType: source.sourceType ?? detectSourceType(source.originalPath ?? source.name, source.mimeType),
  };
  return PARSERS.find((parser) => parser.supports(typed)) ?? fallbackParser;
}

export async function parseKnowledgeSource(source: KnowledgeParserSource): Promise<ParsedDocument> {
  const parser = chooseParser(source);
  const parsed = await parser.parse({
    ...source,
    sourceType: source.sourceType ?? detectSourceType(source.originalPath ?? source.name, source.mimeType),
  });
  parsed.metadata = { ...parsed.metadata, parser: parsed.metadata.parser ?? parser.id };
  return parsed;
}

export function listKnowledgeParsers(): string[] {
  return PARSERS.map((parser) => parser.id);
}
