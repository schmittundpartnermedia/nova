import type { KnowledgeItemType, ParsedDocument, ParsedEntity, SourceLocation } from "@/types/knowledge";
import { clip, inspectUntrustedDocument, KNOWLEDGE_LIMITS } from "@/lib/knowledge/security";
import type { RelationType } from "@/types";

const BOILERPLATE =
  /copyright|all rights reserved|privacy policy|cookie|navigation|unsubscribe|lorem ipsum/i;

export type ExtractedKnowledge = {
  type: KnowledgeItemType;
  title: string;
  content: string;
  normalizedKey?: string;
  normalizedValue?: string;
  entityName?: string;
  location: SourceLocation;
  excerpt: string;
  confidence: number;
  relations: Array<{ from: string; type: RelationType; to: string }>;
  epistemicStatus?: import("@/types/knowledge").EpistemicStatus;
};

const PRICE_RE = /(?:preis|price|kosten|fee)\s*[:is]*\s*(\d+[.,]?\d*)\s*(€|eur|usd|\$)?/i;
const BARE_PRICE_RE = /(\d+[.,]\d{2}|\d{2,6})\s*(€|eur)/i;
const DEADLINE_RE =
  /(?:deadline|frist|fällig(?:keit)?|bis zum|due)\s*[:\s]*(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})/i;
const PERSON_RE =
  /(?:ansprechpartner(?:in)?|kontakt|contact|founder)\s*[:\s]+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'-]+)+)/i;
const COMPANY_RE = /(?:firma|unternehmen|company)\s*[:\s]+([^\n]+)/i;
const COMPANY_NAME_RE = /\b([A-ZÄÖÜ][\wÄÖÜäöüß&-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß&-]*)*\s+(?:GmbH|AG|Inc\.?|Ltd\.?|UG))\b/;
const PROJECT_RE = /(?:projekt|project)\s*[:\s]+([^\n]+)/i;
const PRODUCT_RE = /(?:produkt|product)\s*[:\s]+([^\n]+)/i;
const DECISION_RE = /(?:entscheidung|beschlossen|entschieden)\s*[:\s]+([^\n]+)/i;
const TASK_RE = /(?:aufgabe|todo|task)\s*[:\s]+([^\n]+)/i;
const COMMITMENT_RE = /(?:verpflichtung|zusage|commitment)\s*[:\s]+([^\n]+)/i;
const METRIC_RE = /(?:umsatz|revenue|metric)\s*[:\s]+([^\n]+)/i;

function locationFromSection(parsed: ParsedDocument, sectionId?: string, extra?: SourceLocation): SourceLocation {
  const section = parsed.sections.find((item) => item.id === sectionId);
  return {
    page: extra?.page ?? section?.page,
    heading: extra?.heading ?? section?.heading,
    sectionId: extra?.sectionId ?? section?.id,
    lineStart: extra?.lineStart ?? section?.lineStart,
    lineEnd: extra?.lineEnd ?? section?.lineEnd,
    sheet: extra?.sheet ?? (typeof section?.metadata?.sheet === "string" ? section.metadata.sheet : undefined),
    row: extra?.row ?? (typeof section?.metadata?.row === "number" ? section.metadata.row : undefined),
    column: extra?.column,
    cell: extra?.cell,
    path: extra?.path,
  };
}

function pushItem(
  items: ExtractedKnowledge[],
  parsed: ParsedDocument,
  input: Omit<ExtractedKnowledge, "excerpt" | "location"> & { location?: SourceLocation; sectionId?: string; excerpt?: string },
) {
  const content = input.content.trim();
  if (content.length < 3 || BOILERPLATE.test(content)) return;
  if (inspectUntrustedDocument(parsed.title, content).injectionSuspected && input.type !== "REFERENCE") {
    items.push({
      type: "REFERENCE",
      title: "Untrusted document instruction",
      content: "Dokument enthält eine Anweisung. Sie wird nur als Inhalt behandelt, nicht ausgeführt.",
      location: input.location ?? locationFromSection(parsed, input.sectionId),
      excerpt: clip(content, KNOWLEDGE_LIMITS.maxExcerptChars),
      confidence: 0.9,
      relations: [],
    });
    return;
  }
  items.push({
    ...input,
    content,
    location: input.location ?? locationFromSection(parsed, input.sectionId),
    excerpt: input.excerpt ?? clip(content, KNOWLEDGE_LIMITS.maxExcerptChars),
  });
}

function normalizePrice(raw: string): string {
  const num = raw.replace(",", ".");
  const value = Number.parseFloat(num);
  return Number.isFinite(value) ? String(value) : raw;
}

function isoDate(raw: string): string {
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(raw);
  if (dotted) {
    const year = dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3];
    return `${year}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`;
  }
  return raw;
}

export function extractKnowledgeItems(parsed: ParsedDocument): ExtractedKnowledge[] {
  const items: ExtractedKnowledge[] = [];
  const seen = new Set<string>();

  const consider = (text: string, sectionId?: string, location?: SourceLocation) => {
    const add = (item: Omit<ExtractedKnowledge, "excerpt" | "location" | "relations"> & { relations?: ExtractedKnowledge["relations"] }) => {
      const key = `${item.type}:${item.normalizedKey ?? item.title}:${item.normalizedValue ?? item.content}`;
      if (seen.has(key)) return;
      seen.add(key);
      pushItem(items, parsed, { ...item, relations: item.relations ?? [], sectionId, location });
    };

    const price = PRICE_RE.exec(text) ?? BARE_PRICE_RE.exec(text);
    if (price && /preis|price|€|eur/i.test(text)) {
      const value = normalizePrice(price[1]);
      add({
        type: "PRICE",
        title: "Preis",
        content: `Preis ${value} ${price[2] ?? "€"}`.trim(),
        normalizedKey: "PRICE",
        normalizedValue: value,
        confidence: 0.92,
      });
    }

    const deadline = DEADLINE_RE.exec(text);
    if (deadline) {
      add({
        type: "DEADLINE",
        title: "Deadline",
        content: `Deadline ${deadline[1]}`,
        normalizedKey: "DEADLINE",
        normalizedValue: isoDate(deadline[1]),
        confidence: 0.9,
      });
    }

    const person = PERSON_RE.exec(text);
    if (person) {
      add({
        type: "PERSON",
        title: person[1].trim(),
        content: `Ansprechpartner: ${person[1].trim()}`,
        entityName: person[1].trim(),
        normalizedKey: `PERSON:${person[1].trim().toLowerCase()}`,
        normalizedValue: person[1].trim(),
        confidence: 0.88,
      });
      add({
        type: "CONTACT",
        title: person[1].trim(),
        content: `Kontakt ${person[1].trim()}`,
        entityName: person[1].trim(),
        normalizedKey: `CONTACT:${person[1].trim().toLowerCase()}`,
        confidence: 0.8,
      });
    }

    const companyLabel = COMPANY_RE.exec(text);
    const companyName = companyLabel?.[1]?.trim() || COMPANY_NAME_RE.exec(text)?.[1];
    if (companyName) {
      add({
        type: "COMPANY",
        title: companyName,
        content: `Firma ${companyName}`,
        entityName: companyName,
        normalizedKey: `COMPANY:${companyName.toLowerCase()}`,
        normalizedValue: companyName,
        confidence: 0.9,
      });
    }

    const project = PROJECT_RE.exec(text);
    if (project) {
      add({
        type: "PROJECT",
        title: project[1].trim(),
        content: `Projekt ${project[1].trim()}`,
        entityName: project[1].trim(),
        normalizedKey: `PROJECT:${project[1].trim().toLowerCase()}`,
        confidence: 0.86,
      });
    }

    const product = PRODUCT_RE.exec(text);
    if (product) {
      add({
        type: "PRODUCT",
        title: product[1].trim(),
        content: `Produkt ${product[1].trim()}`,
        entityName: product[1].trim(),
        normalizedKey: `PRODUCT:${product[1].trim().toLowerCase()}`,
        confidence: 0.84,
      });
    }

    const decision = DECISION_RE.exec(text);
    if (decision) {
      add({
        type: "DECISION",
        title: "Entscheidung",
        content: decision[1].trim(),
        normalizedKey: `DECISION:${decision[1].trim().toLowerCase().slice(0, 80)}`,
        confidence: 0.9,
      });
    }

    const task = TASK_RE.exec(text);
    if (task) {
      add({
        type: "TASK",
        title: "Aufgabe",
        content: task[1].trim(),
        confidence: 0.82,
      });
    }

    const commitment = COMMITMENT_RE.exec(text);
    if (commitment) {
      add({
        type: "COMMITMENT",
        title: "Verpflichtung",
        content: commitment[1].trim(),
        confidence: 0.8,
      });
    }

    const metric = METRIC_RE.exec(text);
    if (metric) {
      add({
        type: "METRIC",
        title: "Kennzahl",
        content: metric[0],
        normalizedKey: "METRIC",
        normalizedValue: metric[1].trim(),
        confidence: 0.85,
      });
    }
  };

  for (const section of parsed.sections) {
    consider(`${section.heading ?? ""}\n${section.content}`, section.id, locationFromSection(parsed, section.id));
  }
  for (const table of parsed.tables) {
    table.rows.forEach((row, rowIndex) => {
      table.headers.forEach((header, col) => {
        const value = row[col] ?? "";
        if (!header || !value) return;
        const cell = `${String.fromCharCode(65 + col)}${rowIndex + 2}`;
        consider(`${header}: ${value}`, undefined, {
          sheet: table.sheet,
          row: rowIndex + 2,
          column: header,
          cell,
          heading: table.title,
        });
        if (/umsatz|revenue/i.test(header) || /umsatz|revenue/i.test(table.title ?? "")) {
          const month = table.headers.find((item) => /monat|month/i.test(item));
          const monthVal = month ? row[table.headers.indexOf(month)] : undefined;
          pushItem(items, parsed, {
            type: "METRIC",
            title: monthVal ? `Umsatz ${monthVal}` : "Umsatz",
            content: `Umsatz${monthVal ? ` ${monthVal}` : ""}: ${value}`,
            normalizedKey: `METRIC:umsatz:${(monthVal ?? "").toLowerCase()}`,
            normalizedValue: value.replace(/[^\d.,-]/g, ""),
            confidence: 0.93,
            relations: [],
            location: { sheet: table.sheet, row: rowIndex + 2, column: header, cell, heading: table.title },
          });
        }
      });
    });
  }

  const person = items.find((item) => item.type === "PERSON");
  const company = items.find((item) => item.type === "COMPANY");
  const project = items.find((item) => item.type === "PROJECT");
  const product = items.find((item) => item.type === "PRODUCT");
  const deadline = items.find((item) => item.type === "DEADLINE");
  const decision = items.find((item) => item.type === "DECISION");
  if (person && company) person.relations.push({ from: person.entityName ?? person.title, type: "works_at", to: company.entityName ?? company.title });
  if (product && company) product.relations.push({ from: product.entityName ?? product.title, type: "product_of", to: company.entityName ?? company.title });
  if (decision && project) decision.relations.push({ from: decision.content, type: "relates_to", to: project.entityName ?? project.title });
  if (deadline && (project || product || company)) {
    deadline.relations.push({
      from: (project ?? product ?? company)?.title ?? parsed.title,
      type: "has_deadline",
      to: deadline.normalizedValue ?? deadline.content,
    });
  }
  if (company) {
    items.push({
      type: "REFERENCE",
      title: `Dokument erwähnt ${company.title}`,
      content: `${parsed.title} mentions ${company.title}`,
      entityName: company.title,
      location: company.location,
      excerpt: company.excerpt,
      confidence: 0.7,
      relations: [{ from: parsed.title, type: "mentions", to: company.title }],
    });
  }

  return items.filter((item) => item.content.length > 0);
}

export function entitiesFromExtraction(items: ExtractedKnowledge[]): ParsedEntity[] {
  return items
    .filter((item) => item.entityName)
    .map((item) => ({
      type: item.type,
      name: item.entityName as string,
      value: item.normalizedValue,
      location: item.location,
      confidence: item.confidence,
    }));
}

export function isDurableKnowledge(type: KnowledgeItemType): boolean {
  return [
    "DECISION",
    "PERSON",
    "COMPANY",
    "CONTACT",
    "PROJECT",
    "PREFERENCE",
    "COMMITMENT",
    "DEADLINE",
    "PROCESS",
    "POLICY",
    "TECHNICAL_FACT",
    "PRODUCT",
    "CONTRACT",
  ].includes(type);
}
