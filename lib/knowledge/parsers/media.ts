import type { KnowledgeParser, ParsedDocument } from "@/types/knowledge";
import { detectSourceType, languageOf } from "@/lib/knowledge/security";

function kindLabel(sourceType: string): string {
  if (sourceType === "audio") return "Audiodatei";
  if (sourceType === "video") return "Videodatei";
  if (sourceType === "image") return "Bild";
  return "Datei";
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} Byte`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function mediaCatalogDocument(input: {
  name: string;
  sourceType: string;
  mimeType?: string;
  size: number;
  originalPath?: string;
}): ParsedDocument {
  const kind = kindLabel(input.sourceType);
  const fulltext = [
    `${kind} ${input.name}`,
    input.mimeType ? `Typ: ${input.mimeType}` : "",
    `Größe: ${formatBytes(input.size)}`,
    input.originalPath ? `Ablage: ${input.originalPath}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    title: input.name,
    documentType: "unknown",
    language: languageOf(input.name),
    metadata: {
      parser: "media-catalog",
      sourceType: input.sourceType,
      mimeType: input.mimeType,
      cataloged: true,
    },
    sections: [{ id: "media-1", heading: kind, content: fulltext, hierarchy: 1 }],
    tables: [],
    entities: [],
    dates: [],
    references: [],
    fulltext,
    ocrRequired: input.sourceType === "image",
  };
}

export const mediaParser: KnowledgeParser = {
  id: "media",
  supports(source) {
    const type = source.sourceType ?? detectSourceType(source.originalPath ?? source.name, source.mimeType);
    return type === "audio" || type === "video" || type === "image";
  },
  async parse(source) {
    const sourceType = source.sourceType ?? detectSourceType(source.originalPath ?? source.name, source.mimeType);
    return mediaCatalogDocument({
      name: source.name,
      sourceType,
      mimeType: source.mimeType,
      size: source.bytes.length,
      originalPath: source.originalPath,
    });
  },
};
