import type { Worker } from 'tesseract.js';
import { resolveTesseractPaths } from './tesseract-paths';

type GlobalOcr = typeof globalThis & {
  __barcodeOcrWorker?: Worker;
  __barcodeOcrInit?: Promise<Worker>;
  __barcodeOcrQueue?: Promise<void>;
};

const g = globalThis as GlobalOcr;
const RECYCLE_EVERY = 4;
let jobCount = 0;

/** PSM modes tuned for sticker/overlay text on field photos. */
const OCR_PSM_MODES = [11, 6] as const;

async function terminateOcrWorker(): Promise<void> {
  if (!g.__barcodeOcrWorker) return;
  try {
    await g.__barcodeOcrWorker.terminate();
  } catch {
    /* ignore */
  }
  g.__barcodeOcrWorker = undefined;
  g.__barcodeOcrInit = undefined;
}

async function createOcrWorker(): Promise<Worker> {
  const { createWorker, OEM } = await import('tesseract.js');
  const paths = resolveTesseractPaths();
  const worker = await createWorker('eng', OEM.LSTM_ONLY, paths);
  return worker;
}

export async function getOcrWorker(): Promise<Worker> {
  if (g.__barcodeOcrWorker) return g.__barcodeOcrWorker;
  if (!g.__barcodeOcrInit) {
    g.__barcodeOcrInit = createOcrWorker().then((worker) => {
      g.__barcodeOcrWorker = worker;
      return worker;
    });
  }
  return g.__barcodeOcrInit;
}

/** Run OCR on one prepared image buffer (queued — worker is not re-entrant). */
export async function ocrBuffer(buffer: Buffer): Promise<string> {
  const run = async () => {
    if (jobCount > 0 && jobCount % RECYCLE_EVERY === 0) {
      await terminateOcrWorker();
    }
    const worker = await getOcrWorker();
    jobCount += 1;

    const chunks: string[] = [];
    for (const psm of OCR_PSM_MODES) {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        tessedit_pageseg_mode: String(psm),
      });
      const { data } = await worker.recognize(buffer);
      const piece = String(data.text ?? '').trim();
      if (piece) chunks.push(piece);
    }
    return chunks.join('\n').trim();
  };

  const prev = g.__barcodeOcrQueue ?? Promise.resolve();
  const next = prev.then(run, run);
  g.__barcodeOcrQueue = next.then(() => undefined, () => undefined);
  return next;
}

export function extractOcrTokens(text: string): string[] {
  const tokens = new Set<string>();
  const normalized = text.replace(/[^A-Za-z0-9]/g, '');
  if (normalized.length >= 8) tokens.add(normalized);

  for (const match of text.match(/[A-Za-z0-9]{6,}/g) ?? []) {
    tokens.add(match);
    const norm = match.replace(/[^A-Za-z0-9]/g, '');
    if (norm.length >= 8) tokens.add(norm);
  }

  if (normalized.length >= 12) {
    for (const len of [16, 14, 12, 10, 8]) {
      if (len > normalized.length) continue;
      for (let i = 0; i <= normalized.length - len; i += 2) {
        tokens.add(normalized.slice(i, i + len));
      }
    }
  }

  return [...tokens];
}
