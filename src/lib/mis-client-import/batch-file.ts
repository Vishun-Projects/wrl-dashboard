import * as XLSX from 'xlsx';
import { readImportFile } from '@/lib/mis-client-import/file-store';
import { withAppClient } from '@/lib/read-model/db';

type BatchFileMeta = {
  file_name: string;
  stored_file_path: string | null;
  stored_file_blob: Buffer | null;
  file_kind: 'csv' | 'xlsx';
  delimiter: string | null;
};

function contentTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.wrlmis')) return 'application/octet-stream';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function orderedRawKeys(rawRows: Record<string, string>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function escapeDelimitedField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rawRowsToCsvBuffer(
  rawRows: Record<string, string>[],
  delimiter = ','
): Buffer {
  const keys = orderedRawKeys(rawRows);
  const lines = [
    keys.map((key) => escapeDelimitedField(key, delimiter)).join(delimiter),
    ...rawRows.map((row) =>
      keys.map((key) => escapeDelimitedField(row[key] ?? '', delimiter)).join(delimiter)
    ),
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}

export function rawRowsToXlsxBuffer(rawRows: Record<string, string>[]): Buffer {
  const keys = orderedRawKeys(rawRows);
  const matrix = [keys, ...rawRows.map((row) => keys.map((key) => row[key] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

async function loadBatchMeta(batchId: string): Promise<BatchFileMeta | null> {
  return withAppClient(async (client) => {
    const res = await client.query<{
      file_name: string;
      stored_file_path: string | null;
      stored_file_blob: Buffer | null;
      file_kind: 'csv' | 'xlsx';
      delimiter: string | null;
    }>(
      `
      SELECT b.file_name, b.stored_file_path, b.stored_file_blob,
             s.file_kind, s.delimiter
      FROM mis_client_import_batches b
      JOIN mis_client_sources s ON s.id = b.source_id
      WHERE b.batch_id = $1::uuid AND b.status = 'completed'
      LIMIT 1
      `,
      [batchId]
    );
    return res.rows[0] ?? null;
  });
}

async function loadBatchRawRows(batchId: string): Promise<Record<string, string>[]> {
  return withAppClient(async (client) => {
    const res = await client.query<{ raw: Record<string, string> }>(
      `
      SELECT raw
      FROM mis_client_import_rows
      WHERE batch_id = $1::uuid
      ORDER BY id
      `,
      [batchId]
    );
    return res.rows.map((row) => row.raw ?? {});
  });
}

async function reconstructBatchFile(meta: BatchFileMeta, batchId: string): Promise<Buffer> {
  const rawRows = await loadBatchRawRows(batchId);
  if (rawRows.length === 0) {
    throw new Error('No imported rows found for this batch');
  }

  const lower = meta.file_name.toLowerCase();
  if (meta.file_kind === 'xlsx' || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return rawRowsToXlsxBuffer(rawRows);
  }
  return rawRowsToCsvBuffer(rawRows, meta.delimiter?.trim() || ',');
}

export async function saveBatchFileBlob(batchId: string, buffer: Buffer): Promise<void> {
  await withAppClient(async (client) => {
    await client.query(
      `UPDATE mis_client_import_batches SET stored_file_blob = $2 WHERE batch_id = $1::uuid`,
      [batchId, buffer]
    );
  });
}

export async function loadBatchFileBytes(batchId: string): Promise<{
  buffer: Buffer;
  fileName: string;
  contentType: string;
  reconstructed: boolean;
}> {
  const meta = await loadBatchMeta(batchId);
  if (!meta) {
    throw new Error('Batch not found');
  }

  const fileName = meta.file_name || 'import.dat';
  const contentType = contentTypeForFileName(fileName);

  if (meta.stored_file_blob && meta.stored_file_blob.length > 0) {
    return {
      buffer: meta.stored_file_blob,
      fileName,
      contentType,
      reconstructed: false,
    };
  }

  if (meta.stored_file_path) {
    try {
      const buffer = await readImportFile(meta.stored_file_path);
      return { buffer, fileName, contentType, reconstructed: false };
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      if (code !== 'ENOENT') throw err;
    }
  }

  const buffer = await reconstructBatchFile(meta, batchId);
  return { buffer, fileName, contentType, reconstructed: true };
}
