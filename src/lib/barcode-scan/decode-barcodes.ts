import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  InvertedLuminanceSource,
  MultiFormatOneDReader,
  NotFoundException,
  RGBLuminanceSource,
} from '@zxing/library';
import { luminanceFromBuffer, regionBuffers } from './preprocess-image';

/** Sticker photos use linear 1D barcodes — skip QR/DataMatrix to avoid noisy false attempts. */
const ONE_D_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
    ],
  ],
]);

function isDecodeMiss(err: unknown): boolean {
  if (
    err instanceof NotFoundException ||
    err instanceof ChecksumException ||
    err instanceof FormatException
  ) {
    return true;
  }
  if (!err || typeof err !== 'object') return false;
  const name = (err as { constructor?: { name?: string }; kind?: string }).constructor?.name;
  return (
    name === 'NotFoundException' ||
    name === 'ChecksumException' ||
    name === 'FormatException'
  );
}

function tryDecode(bitmap: BinaryBitmap): string | null {
  const reader = new MultiFormatOneDReader();
  reader.setHints(ONE_D_HINTS);
  try {
    return reader.decode(bitmap).getText();
  } catch (err) {
    if (isDecodeMiss(err)) return null;
    return null;
  }
}

function decodeWithSource(source: RGBLuminanceSource): string[] {
  const found: string[] = [];

  for (const Binarizer of [HybridBinarizer, GlobalHistogramBinarizer]) {
    const text = tryDecode(new BinaryBitmap(new Binarizer(source)));
    if (text) found.push(text);

    const inverted = new InvertedLuminanceSource(source);
    const invertedText = tryDecode(new BinaryBitmap(new Binarizer(inverted)));
    if (invertedText) found.push(invertedText);
  }

  return found;
}

function decodeLuminance(lumPack: { lum: Uint8ClampedArray; width: number; height: number }): string[] {
  const source = new RGBLuminanceSource(lumPack.lum, lumPack.width, lumPack.height);
  return decodeWithSource(source);
}

/** Decode 1D barcodes from a JPEG buffer (tries full frame + top/bottom halves). */
export async function decodeBarcodesFromImage(buffer: Buffer): Promise<string[]> {
  const results = new Set<string>();
  const regions = await regionBuffers(buffer);

  for (const region of regions) {
    try {
      const lumPack = await luminanceFromBuffer(region);
      if (!lumPack) continue;
      for (const text of decodeLuminance(lumPack)) {
        const trimmed = String(text || '').trim();
        if (trimmed) results.add(trimmed);
      }
    } catch {
      /* try next region */
    }
  }

  return [...results];
}
