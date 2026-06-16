import { decodeBarcodesFromImage } from './decode-barcodes';
import { barcodeMatchesOcrText } from './match-barcode-text';
import { buildScanVariants } from './preprocess-image';
import { extractOcrTokens, ocrBuffer } from './tesseract-server';

export type ImageScanResult = {
  text: string;
  tokens: string[];
  barcodes: string[];
  matchesNew?: boolean;
};

function buildResult(texts: string[], barcodes: Set<string>, targetBarcode?: string): ImageScanResult {
  const text = texts.join('\n').trim();
  const barcodeList = [...barcodes];
  const tokens = extractOcrTokens(text);
  for (const code of barcodeList) {
    tokens.push(code);
    const norm = code.replace(/[^A-Za-z0-9]/g, '');
    if (norm.length >= 6) tokens.push(norm);
  }
  const uniqueTokens = [...new Set(tokens)];
  return {
    text,
    tokens: uniqueTokens,
    barcodes: barcodeList,
    matchesNew: targetBarcode
      ? barcodeMatchesOcrText(targetBarcode, text, uniqueTokens, barcodeList)
      : undefined,
  };
}

function matched(result: ImageScanResult): boolean {
  return result.matchesNew === true;
}

/**
 * Scan a field photo for barcode serials: ZXing on rotated/cropped variants first, then OCR.
 * Stops early when targetBarcode matches.
 */
export async function scanImage(buffer: Buffer, targetBarcode?: string): Promise<ImageScanResult> {
  let variants: Buffer[];
  try {
    variants = await buildScanVariants(buffer);
  } catch {
    variants = [buffer];
  }
  if (!variants.length) variants = [buffer];

  const texts: string[] = [];
  const barcodes = new Set<string>();

  for (const variant of variants) {
    try {
      const decoded = await decodeBarcodesFromImage(variant);
      for (const code of decoded) barcodes.add(code);
      if (targetBarcode) {
        const hit = buildResult(texts, barcodes, targetBarcode);
        if (matched(hit)) return hit;
      }
    } catch {
      /* try next variant */
    }
  }

  for (const variant of variants) {
    try {
      const piece = await ocrBuffer(variant);
      if (piece) texts.push(piece);
      if (targetBarcode) {
        const hit = buildResult(texts, barcodes, targetBarcode);
        if (matched(hit)) return hit;
      }
    } catch {
      /* try next variant */
    }
  }

  return buildResult(texts, barcodes, targetBarcode);
}

/** @deprecated Use scanImage */
export async function recognizeImage(buffer: Buffer): Promise<string> {
  const result = await scanImage(buffer);
  return result.text;
}
