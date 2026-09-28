import { gzipBlobForMisUpload } from '@/modules/mis/client-import/services/upload-gzip';
import { MIS_UPLOAD_CHUNK_BYTES } from '@/modules/mis/client-import/services/upload-chunk-constants';
import {
  SPARE_STOCK_CHUNK_SOURCE,
  type SpareStockDbDupesChoice,
  type SpareStockInFileDupesChoice,
} from '@/modules/spare-stock-analysis/types';

export const SPARE_STOCK_API = '/api/report/spare-stock-analysis';

/** Same-origin Vercel body cap is ~4.5 MB; stay under that including multipart. */
export const SPARE_STOCK_CHUNK_BYTES = MIS_UPLOAD_CHUNK_BYTES;

export type SpareStockWireUpload = {
  kind: 'direct' | 'chunked';
  fileName: string;
  encoding: 'gzip' | null;
  blob: Blob;
  uploadId: string | null;
};

export function spareStockChunkRanges(
  size: number,
  chunkBytes = SPARE_STOCK_CHUNK_BYTES
): Array<{ start: number; end: number }> {
  if (size <= 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < size; start += chunkBytes) {
    ranges.push({ start, end: Math.min(size, start + chunkBytes) });
  }
  return ranges;
}

function isPayloadTooLarge(status: number, message: string): boolean {
  return status === 413 || /payload.?too.?large|entity too large|function_payload/i.test(message);
}

function flattenApiError(data: Record<string, unknown>, status: number): string {
  const err = data.error;
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    return String(rec.code || rec.message || JSON.stringify(err));
  }
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  return `Import failed (${status})`;
}

export async function readSpareStockApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').trim().slice(0, 180) || `Request failed (${res.status})`);
  }
}

function toUploadError(err: unknown): Error {
  const wrapped = err instanceof Error ? err : new Error(String(err));
  if (wrapped.message === 'FUNCTION_PAYLOAD_TOO_LARGE' || isPayloadTooLarge(0, wrapped.message)) {
    return new Error('FUNCTION_PAYLOAD_TOO_LARGE');
  }
  return wrapped;
}

async function postForm(form: FormData): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(SPARE_STOCK_API, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await readSpareStockApiJson(res);
      const rawErr = flattenApiError(data, res.status);
      if (isPayloadTooLarge(res.status, rawErr)) {
        throw new Error('FUNCTION_PAYLOAD_TOO_LARGE');
      }
      if (!res.ok) throw new Error(rawErr);
      return data;
    } catch (err) {
      lastErr = toUploadError(err);
      if (lastErr.message === 'FUNCTION_PAYLOAD_TOO_LARGE') throw lastErr;
      const retryable =
        lastErr.name === 'TypeError' || /failed to fetch|network error|load failed/i.test(lastErr.message);
      if (!retryable || attempt === 2) throw lastErr;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('Upload failed');
}

async function postChunks(
  blob: Blob,
  fileName: string,
  encoding: 'gzip' | null,
  onProgress?: (label: string) => void
): Promise<string> {
  const uploadId = crypto.randomUUID();
  const ranges = spareStockChunkRanges(blob.size);
  const chunkTotal = ranges.length;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    onProgress?.(`Uploading ${i + 1}/${chunkTotal}…`);
    const form = new FormData();
    form.set('action', 'chunk');
    form.set('uploadId', uploadId);
    form.set('chunkIndex', String(i));
    form.set('chunkTotal', String(chunkTotal));
    form.set('fileName', fileName);
    form.set('sourceCode', SPARE_STOCK_CHUNK_SOURCE);
    if (encoding) form.set('contentEncoding', encoding);
    form.set('chunk', blob.slice(range.start, range.end), fileName);
    await postForm(form);
  }
  return uploadId;
}

export async function prepareSpareStockWireUpload(
  file: File,
  onProgress?: (label: string) => void
): Promise<SpareStockWireUpload> {
  onProgress?.('Compressing…');
  const { blob, encoding } = await gzipBlobForMisUpload(file);
  if (blob.size <= SPARE_STOCK_CHUNK_BYTES) {
    return { kind: 'direct', fileName: file.name, encoding, blob, uploadId: null };
  }
  const uploadId = await postChunks(blob, file.name, encoding, onProgress);
  return { kind: 'chunked', fileName: file.name, encoding, blob, uploadId };
}

function importForm(
  upload: SpareStockWireUpload,
  action: 'preview' | 'commit',
  choices?: { inFileDupes: SpareStockInFileDupesChoice; dbDupes: SpareStockDbDupesChoice }
): FormData {
  const form = new FormData();
  form.set('action', action);
  form.set('fileName', upload.fileName);
  if (upload.encoding) form.set('contentEncoding', upload.encoding);
  if (choices) {
    form.set('inFileDupes', choices.inFileDupes);
    form.set('dbDupes', choices.dbDupes);
  }
  if (upload.uploadId) {
    form.set('uploadId', upload.uploadId);
    return form;
  }
  form.set('file', upload.blob, upload.fileName);
  return form;
}

export async function postSpareStockImport(
  upload: SpareStockWireUpload,
  action: 'preview' | 'commit',
  choices?: { inFileDupes: SpareStockInFileDupesChoice; dbDupes: SpareStockDbDupesChoice },
  onProgress?: (label: string) => void
): Promise<Record<string, unknown>> {
  onProgress?.(action === 'preview' ? 'Checking file…' : 'Importing…');
  try {
    return await postForm(importForm(upload, action, choices));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (upload.kind === 'direct' && msg === 'FUNCTION_PAYLOAD_TOO_LARGE') {
      upload.kind = 'chunked';
      upload.uploadId = await postChunks(upload.blob, upload.fileName, upload.encoding, onProgress);
      onProgress?.(action === 'preview' ? 'Checking file…' : 'Importing…');
      return postForm(importForm(upload, action, choices));
    }
    if (msg === 'FUNCTION_PAYLOAD_TOO_LARGE') {
      throw new Error('File is too large to import. Export a shorter MB51 date range.');
    }
    throw err;
  }
}

export async function abortSpareStockUpload(upload: SpareStockWireUpload): Promise<void> {
  if (!upload.uploadId) return;
  const form = new FormData();
  form.set('action', 'abort');
  form.set('uploadId', upload.uploadId);
  try {
    await postForm(form);
  } catch {
    /* best-effort */
  }
}
