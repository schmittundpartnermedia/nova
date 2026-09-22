export type OcrAdapter = {
  id: string;
  available(): boolean;
  recognize(input: { bytes: Buffer; page?: number }): Promise<string>;
};

export const ocrFallback: OcrAdapter = {
  id: "none",
  available() {
    return false;
  },
  async recognize() {
    throw new Error("OCR ist vorbereitet, aber nicht konfiguriert. PDFs ohne Text-Layer werden nicht blind OCRt.");
  },
};

export function shouldRunOcr(input: { hasTextLayer: boolean; ocrRequested?: boolean }): boolean {
  return input.hasTextLayer === false && input.ocrRequested === true && ocrFallback.available();
}
