import { gzipBlobForMisUpload } from '@/modules/mis/client-import/services/upload-gzip';
import { parseMb51FileInBatches } from '@/modules/spare-stock-analysis/parse-mb51';
import type {
  SpareStockDbDupesChoice,
  SpareStockInFileDupesChoice,
  SpareStockParsedRow,
} from '@/modules/spare-stock-analysis/types';

export const SPARE_STOCK_API = '/api/report/spare-stock-analysis';

export type SpareStockSessionUpload = {
  uploadId: string;
  fileName: string;
};

function isVercelWireLimit(message: string): boolean {
  return /function_payload|payload.?too.?large|entity too large/i.test(message);
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
  if (isVercelWireLimit(wrapped.message)) {
    return new Error('FUNCTION_PAYLOAD_TOO_LARGE');
  }
  return wrapped;
}

async function postForm(formOrFactory: FormData | (() => FormData)): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = typeof formOrFactory === 'function' ? formOrFactory() : formOrFactory;
      const res = await fetch(SPARE_STOCK_API, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await readSpareStockApiJson(res);
      const rawErr = flattenApiError(data, res.status);
      if (isVercelWireLimit(rawErr)) {
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

function pct(bytesRead: number, fileBytes: number): string {
  if (fileBytes <= 0) return '0';
  return String(Math.min(99, Math.floor((bytesRead / fileBytes) * 100)));
}

async function postRowBatch(
  uploadId: string,
  fileName: string,
  rows: SpareStockParsedRow[],
  skippedDelta: number
): Promise<void> {
  const json = new Blob([JSON.stringify(rows)], { type: 'application/json' });
  const { blob, encoding } = await gzipBlobForMisUpload(json);
  try {
    await postForm(() => {
      const form = new FormData();
      form.set('action', 'rows');
      form.set('uploadId', uploadId);
      form.set('fileName', fileName);
      form.set('skipped', String(skippedDelta));
      if (encoding) form.set('contentEncoding', encoding);
      form.set('rows', blob, 'rows.json');
      return form;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (rows.length > 1 && (msg === 'FUNCTION_PAYLOAD_TOO_LARGE' || /too large/i.test(msg))) {
      const mid = Math.ceil(rows.length / 2);
      await postRowBatch(uploadId, fileName, rows.slice(0, mid), skippedDelta);
      await postRowBatch(uploadId, fileName, rows.slice(mid), 0);
      return;
    }
    throw err;
  }
}

export async function prepareSpareStockSessionUpload(
  file: File,
  onProgress?: (label: string) => void
): Promise<SpareStockSessionUpload> {
  const uploadId = crypto.randomUUID();
  const upload = { uploadId, fileName: file.name };
  try {
    onProgress?.('Parsing MB51…');
    const result = await parseMb51FileInBatches(
      file,
      async (rows, skippedDelta, progress) => {
        onProgress?.(
          `Parsing ${pct(progress.bytesRead, progress.fileBytes)}% · ${progress.rows.toLocaleString()} rows…`
        );
        if (rows.length === 0 && skippedDelta === 0) return;
        await postRowBatch(uploadId, file.name, rows, skippedDelta);
      },
      (progress) => {
        onProgress?.(
          `Parsing ${pct(progress.bytesRead, progress.fileBytes)}% · ${progress.rows.toLocaleString()} rows…`
        );
      }
    );
    if (result.parsed === 0 && result.skipped === 0) {
      await postRowBatch(uploadId, file.name, [], 0);
    }
    return upload;
  } catch (err) {
    await abortSpareStockUpload(upload);
    throw err;
  }
}

export async function postSpareStockImport(
  upload: SpareStockSessionUpload,
  action: 'preview' | 'commit',
  choices?: { inFileDupes: SpareStockInFileDupesChoice; dbDupes: SpareStockDbDupesChoice },
  onProgress?: (label: string) => void
): Promise<Record<string, unknown>> {
  onProgress?.(action === 'preview' ? 'Checking rows…' : 'Importing…');
  const form = new FormData();
  form.set('action', action);
  form.set('uploadId', upload.uploadId);
  form.set('fileName', upload.fileName);
  if (choices) {
    form.set('inFileDupes', choices.inFileDupes);
    form.set('dbDupes', choices.dbDupes);
  }
  return postForm(form);
}

export async function abortSpareStockUpload(upload: SpareStockSessionUpload): Promise<void> {
  const form = new FormData();
  form.set('action', 'abort');
  form.set('uploadId', upload.uploadId);
  try {
    await postForm(form);
  } catch {
    /* best-effort */
  }
}
