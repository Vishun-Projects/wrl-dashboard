import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { loadBatchFileBytes } from '@/features/mis-import/services/batch-file';
import { resolveImportDir } from '@/features/mis-import/services/file-store';
import { withAppClient } from '@/lib/read-model/db';

export function parseBytesRange(
  rangeHeader: string | null | undefined,
  total: number
): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || total <= 0) return null;
  const spec = rangeHeader.slice('bytes='.length).trim();
  if (spec.includes(',')) return null;
  const [startRaw, endRaw] = spec.split('-', 2);
  let start = startRaw === '' ? NaN : Number(startRaw);
  let end = endRaw === '' || endRaw == null ? total - 1 : Number(endRaw);
  if (!Number.isFinite(start) && Number.isFinite(end)) {
    const suffix = end;
    if (suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  }
  if (!Number.isFinite(start) || start < 0) return null;
  if (!Number.isFinite(end) || end >= total) end = total - 1;
  if (start > end) return null;
  return { start, end };
}

function contentTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.wrlmis')) return 'application/octet-stream';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

type StoredMeta = {
  file_name: string;
  stored_file_path: string | null;
  has_blob: boolean;
};

async function loadStoredMeta(batchId: string): Promise<StoredMeta | null> {
  return withAppClient(async (client) => {
    const res = await client.query<{
      file_name: string;
      stored_file_path: string | null;
      has_blob: boolean;
    }>(
      `
      SELECT b.file_name,
             b.stored_file_path,
             (b.stored_file_blob IS NOT NULL AND octet_length(b.stored_file_blob) > 0) AS has_blob
      FROM mis_client_import_batches b
      WHERE b.batch_id = $1::uuid AND b.status = 'completed'
      LIMIT 1
      `,
      [batchId]
    );
    return res.rows[0] ?? null;
  });
}

export type MisBatchDownloadResult =
  | {
      kind: 'stream';
      status: number;
      headers: Record<string, string>;
      stream: Readable;
    }
  | {
      kind: 'buffer';
      status: number;
      headers: Record<string, string>;
      buffer: Buffer;
    };

/**
 * Prefer disk stream (fast on VPS). Fall back to stored blob. No reconstruct after retention purge.
 */
export async function resolveMisBatchDownload(params: {
  batchId: string;
  rangeHeader?: string | null;
}): Promise<MisBatchDownloadResult> {
  const meta = await loadStoredMeta(params.batchId);
  if (!meta) {
    throw new Error('Batch not found');
  }

  const fileName = meta.file_name || 'import.dat';
  const contentType = contentTypeForFileName(fileName);
  const disposition = `attachment; filename="${fileName.replace(/"/g, '')}"`;

  if (meta.stored_file_path) {
    const absolutePath = path.join(resolveImportDir(), meta.stored_file_path);
    try {
      const st = await stat(absolutePath);
      if (st.isFile() && st.size > 0) {
        const total = st.size;
        const baseHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Content-Disposition': disposition,
          'Accept-Ranges': 'bytes',
        };
        const range = parseBytesRange(params.rangeHeader, total);
        if (range) {
          const length = range.end - range.start + 1;
          return {
            kind: 'stream',
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Length': String(length),
              'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
            },
            stream: createReadStream(absolutePath, {
              start: range.start,
              end: range.end,
              highWaterMark: 1024 * 1024,
            }),
          };
        }
        return {
          kind: 'stream',
          status: 200,
          headers: {
            ...baseHeaders,
            'Content-Length': String(total),
          },
          stream: createReadStream(absolutePath, { highWaterMark: 1024 * 1024 }),
        };
      }
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code !== 'ENOENT') throw err;
    }
  }

  const { buffer, reconstructed } = await loadBatchFileBytes(params.batchId);
  const total = buffer.byteLength;
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    ...(reconstructed ? { 'X-Import-File-Reconstructed': '1' } : {}),
  };

  if (!reconstructed) {
    baseHeaders['Accept-Ranges'] = 'bytes';
    const range = parseBytesRange(params.rangeHeader, total);
    if (range) {
      const slice = buffer.subarray(range.start, range.end + 1);
      return {
        kind: 'buffer',
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(slice.byteLength),
          'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
        },
        buffer: Buffer.from(slice),
      };
    }
  }

  return {
    kind: 'buffer',
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(total),
    },
    buffer,
  };
}
