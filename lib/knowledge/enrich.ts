import { detectSourceType } from "@/lib/knowledge/security";
import { extractEmbeddedImages, getOcrAdapter } from "@/lib/knowledge/ocr";
import { canTranscribeMedia, getTranscribeAdapter } from "@/lib/knowledge/transcribe";
import type { KnowledgeParserSource, ParsedDocument } from "@/types/knowledge";

export async function enrichDocumentContent(
  source: KnowledgeParserSource,
  parsed: ParsedDocument,
): Promise<ParsedDocument> {
  const sourceType = source.sourceType ?? detectSourceType(source.originalPath ?? source.name, source.mimeType);
  const parts: string[] = [];
  let extractor = "";

  const wantsOcr = sourceType === "image" || parsed.ocrRequired;
  if (wantsOcr) {
    const ocr = getOcrAdapter();
    if (ocr.available()) {
      const images =
        sourceType === "image"
          ? [{ bytes: source.bytes, mimeType: source.mimeType || "image/png" }]
          : extractEmbeddedImages(source.bytes);
      for (const image of images.slice(0, 3)) {
        if (image.bytes.length < 32 || image.bytes.length > 4_000_000) continue;
        try {
          const text = await ocr.recognize({
            bytes: image.bytes,
            mimeType: image.mimeType,
          });
          if (text.trim()) parts.push(text.trim());
          extractor = ocr.id;
        } catch {
          // OCR ist best-effort: Katalog bleibt, Inhalt wird nicht erfunden.
        }
      }
    }
  }

  if (sourceType === "audio" || sourceType === "video") {
    const transcribe = getTranscribeAdapter();
    if (transcribe.available() && canTranscribeMedia(source.bytes.length)) {
      try {
        const text = await transcribe.transcribe({
          bytes: source.bytes,
          filename: source.name,
          mimeType: source.mimeType,
        });
        if (text.trim()) parts.push(text.trim());
        extractor = transcribe.id;
      } catch {
        // Transkript fehlt: Dateiname bleibt im Katalog.
      }
    }
  }

  const extra = parts.join("\n\n").trim();
  if (!extra) return parsed;

  return {
    ...parsed,
    fulltext: [parsed.fulltext, extra].filter(Boolean).join("\n\n"),
    sections: [
      ...parsed.sections,
      {
        id: "extracted-content",
        heading: sourceType === "image" || parsed.ocrRequired ? "OCR" : "Transkript",
        content: extra,
        hierarchy: 1,
      },
    ],
    ocrRequired: false,
    metadata: {
      ...parsed.metadata,
      contentExtractor: extractor,
      extracted: true,
    },
  };
}
