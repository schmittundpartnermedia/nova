import type { KnowledgeParser, ParsedDocument, ParsedSection, ParsedTable } from "@/types/knowledge";
import { inspectUntrustedDocument, languageOf, redactKnowledgeText } from "@/lib/knowledge/security";
import { unzipSync, zipStore } from "@/lib/knowledge/zip";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_all, num) => String.fromCharCode(Number(num)));
}

function xmlTexts(xml: string, tag: string): string[] {
  const matches = [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))];
  return matches.map((item) => decodeXmlEntities(item[1].replace(/<[^>]+>/g, "")));
}

export const docxParser: KnowledgeParser = {
  id: "docx",
  supports(source) {
    return source.sourceType === "docx" || /\.docx$/i.test(source.name);
  },
  async parse(source) {
    const entries = unzipSync(source.bytes);
    const document = entries.find((entry) => entry.name === "word/document.xml");
    if (!document) throw new Error("DOCX ohne document.xml");
    const xml = document.data.toString("utf8");
    const core = entries.find((entry) => entry.name === "docProps/core.xml")?.data.toString("utf8") ?? "";
    const title = xmlTexts(core, "dc:title")[0] || source.name.replace(/\.docx$/i, "");
    const body = xml.match(/<w:body[\s\S]*<\/w:body>/)?.[0] ?? xml;
    const blocks = body.split(/<\/w:p>|<\/w:tbl>/);
    const sections: ParsedSection[] = [];
    const tables: ParsedTable[] = [];
    let order = 0;
    for (const block of blocks) {
      if (block.includes("<w:tbl")) {
        const rows = [...block.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)].map((row) =>
          [...row[0].matchAll(/<w:tc[\s\S]*?<\/w:tc>/g)].map((cell) =>
            decodeXmlEntities(
              [...cell[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(""),
            ).trim(),
          ),
        );
        if (rows.length) {
          const headers = rows[0];
          tables.push({
            id: `tbl-${tables.length + 1}`,
            headers,
            rows: rows.slice(1),
          });
        }
        continue;
      }
      const text = decodeXmlEntities(
        [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((item) => item[1]).join(""),
      ).trim();
      if (!text) continue;
      const heading = /w:val="Heading(\d)"/.exec(block)?.[1];
      sections.push({
        id: `p-${order + 1}`,
        heading: heading ? text : undefined,
        content: text,
        hierarchy: heading ? Number(heading) : 3,
        metadata: { order },
      });
      order += 1;
    }
    const fulltext = redactKnowledgeText(sections.map((section) => section.content).join("\n"));
    const untrusted = inspectUntrustedDocument(source.originalPath ?? source.name, fulltext);
    return {
      title,
      documentType: "document",
      language: languageOf(fulltext),
      metadata: { parser: "docx", coreTitle: title },
      sections,
      tables,
      entities: [],
      dates: [],
      references: [],
      fulltext,
      injectionSuspected: untrusted.injectionSuspected,
    };
  },
};

function colNameToIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const xlsxParser: KnowledgeParser = {
  id: "xlsx",
  supports(source) {
    return source.sourceType === "xlsx" || /\.xlsx$/i.test(source.name);
  },
  async parse(source) {
    const entries = unzipSync(source.bytes);
    const shared = entries.find((entry) => entry.name === "xl/sharedStrings.xml")?.data.toString("utf8") ?? "";
    const strings = [...shared.matchAll(/<si[\s\S]*?<\/si>/g)].map((item) =>
      decodeXmlEntities([...item[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
    const workbook = entries.find((entry) => entry.name === "xl/workbook.xml")?.data.toString("utf8") ?? "";
    const sheets = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((item) => ({
      name: item[1],
      id: item[2],
    }));
    const rels = entries.find((entry) => entry.name === "xl/_rels/workbook.xml.rels")?.data.toString("utf8") ?? "";
    const relMap = new Map(
      [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((item) => [item[1], item[2].replace(/^\//, "")]),
    );
    const tables: ParsedTable[] = [];
    const sections: ParsedSection[] = [];
    const sheetFiles = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
    sheetFiles.forEach((file, index) => {
      const rel = [...relMap.entries()].find(([, target]) => file.name.endsWith(target.replace(/^xl\//, "")) || file.name.endsWith(target));
      const sheetName = sheets.find((sheet) => sheet.id === rel?.[0])?.name ?? `Sheet${index + 1}`;
      const xml = file.data.toString("utf8");
      const cells = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)];
      const grid = new Map<string, string>();
      let maxRow = 0;
      let maxCol = 0;
      for (const cell of cells) {
        const col = cell[1];
        const row = Number(cell[2]);
        const attrs = cell[3];
        const inner = cell[4];
        const isShared = /\bt="s"/.test(attrs);
        const raw = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        const inline = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join("");
        const value = isShared ? (strings[Number(raw)] ?? "") : decodeXmlEntities(inline || raw);
        grid.set(`${col}${row}`, value);
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, colNameToIndex(col) + 1);
      }
      const colNames = Array.from({ length: maxCol }, (_, i) => String.fromCharCode(65 + i));
      const headers = colNames.map((col) => grid.get(`${col}1`) ?? col);
      const rows: string[][] = [];
      for (let row = 2; row <= maxRow; row += 1) {
        rows.push(colNames.map((col) => grid.get(`${col}${row}`) ?? ""));
      }
      tables.push({ id: `sheet-${index + 1}`, title: sheetName, sheet: sheetName, headers, rows });
      rows.forEach((row, rowIndex) => {
        if (!row.some(Boolean)) return;
        sections.push({
          id: `${sheetName}-r${rowIndex + 2}`,
          heading: `${sheetName} ${headers[0] ?? "Zeile"}=${row[0]}`,
          content: headers.map((header, col) => `${header}: ${row[col] ?? ""}`).join(" | "),
          hierarchy: 2,
          metadata: {
            sheet: sheetName,
            row: rowIndex + 2,
            cells: Object.fromEntries(headers.map((header, col) => [header, { column: colNames[col], cell: `${colNames[col]}${rowIndex + 2}`, value: row[col] }])),
          },
        });
      });
    });
    const fulltext = redactKnowledgeText(sections.map((section) => section.content).join("\n"));
    const untrusted = inspectUntrustedDocument(source.originalPath ?? source.name, fulltext);
    return {
      title: source.name.replace(/\.xlsx$/i, ""),
      documentType: "spreadsheet",
      language: languageOf(fulltext),
      metadata: { parser: "xlsx", sheets: tables.map((table) => table.sheet) },
      sections,
      tables,
      entities: [],
      dates: [],
      references: [],
      fulltext,
      injectionSuspected: untrusted.injectionSuspected,
    };
  },
};

export function buildSimpleDocx(paragraphs: Array<{ text: string; heading?: number }>, tables: Array<{ headers: string[]; rows: string[][] }> = []): Buffer {
  const body: string[] = [];
  for (const para of paragraphs) {
    const style = para.heading ? `<w:pPr><w:pStyle w:val="Heading${para.heading}"/></w:pPr>` : "";
    body.push(`<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(para.text)}</w:t></w:r></w:p>`);
  }
  for (const table of tables) {
    const rows = [table.headers, ...table.rows]
      .map(
        (row) =>
          `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`,
      )
      .join("");
    body.push(`<w:tbl>${rows}</w:tbl>`);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}</w:body></w:document>`;
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: documentXml },
  ]);
}

export function buildSimpleXlsx(sheets: Array<{ name: string; headers: string[]; rows: string[][] }>): Buffer {
  const sheetFiles = sheets.map((sheet, index) => {
    const rows = [sheet.headers, ...sheet.rows];
    const cells = rows
      .map((row, rowIndex) => {
        const items = row
          .map((value, col) => {
            const ref = `${String.fromCharCode(65 + col)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${items}</row>`;
      })
      .join("");
    return {
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`,
    };
  });
  const workbookSheets = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  const rels = sheets
    .map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("");
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_sheet, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    },
    ...sheetFiles,
  ]);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseDocxDocument(source: Parameters<KnowledgeParser["parse"]>[0]): Promise<ParsedDocument> {
  return docxParser.parse(source);
}
