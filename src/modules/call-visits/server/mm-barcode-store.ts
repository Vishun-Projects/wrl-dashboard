import { withAppClient } from '@/lib/read-model/db';
import type { PoolClient } from 'pg';
import type {
  MmDocBarcodeImportMeta,
  MmDocBarcodeRow,
} from '@/modules/call-visits/mm-barcode-types';

export type { MmDocBarcodeImportMeta, MmDocBarcodeRow };

const BATCH_SIZE = 1_000;
const SAVE_STATEMENT_TIMEOUT_MS = 300_000;

async function insertRowBatch(
  client: PoolClient,
  importId: string,
  rows: MmDocBarcodeRow[],
  seqOffset: number
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i]!;
      const seq = seqOffset + offset + i;
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++}::date,$${p++},$${p++},$${p++},$${p++})`
      );
      values.push(
        importId,
        row.plant,
        row.storageLocation,
        row.materialDocument,
        row.postingDate,
        row.material,
        row.objectDescription,
        row.movementType,
        seq
      );
    }
    if (!placeholders.length) continue;
    await client.query(
      `INSERT INTO mm_doc_barcode_rows (
         import_id, plant, storage_location, material_document, posting_date,
         material, object_description, movement_type, seq_order
       ) VALUES ${placeholders.join(',')}`,
      values
    );
  }
}

async function fetchMeta(client: PoolClient, importId: string): Promise<MmDocBarcodeImportMeta> {
  const res = await client.query<{
    id: string;
    file_name: string;
    row_count: number;
    imported_at: Date;
  }>(
    `SELECT id, file_name, row_count, imported_at FROM mm_doc_barcode_imports WHERE id = $1`,
    [importId]
  );
  const row = res.rows[0];
  if (!row) throw new Error('MM barcode import not found');
  return {
    id: row.id,
    fileName: row.file_name,
    rowCount: row.row_count,
    importedAt: row.imported_at.toISOString(),
  };
}

export async function fetchLatestMmDocBarcodeMeta(): Promise<MmDocBarcodeImportMeta | null> {
  return withAppClient(async (client) => {
    const res = await client.query<{
      id: string;
      file_name: string;
      row_count: number;
      imported_at: Date;
    }>(
      `SELECT id, file_name, row_count, imported_at
       FROM mm_doc_barcode_imports
       ORDER BY imported_at DESC
       LIMIT 1`
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      fileName: row.file_name,
      rowCount: row.row_count,
      importedAt: row.imported_at.toISOString(),
    };
  });
}

export async function saveMmDocBarcodeImport(opts: {
  fileName: string;
  uploadedBy?: string | null;
  rows: MmDocBarcodeRow[];
  replaceExisting?: boolean;
  importId?: string | null;
  seqOffset?: number;
  expectedTotal?: number;
}): Promise<MmDocBarcodeImportMeta> {
  const {
    fileName,
    uploadedBy = null,
    rows,
    replaceExisting = true,
    importId: existingImportId,
    seqOffset = 0,
    expectedTotal,
  } = opts;

  return withAppClient(
    async (client) => {
      async function refreshCount(id: string, rowCount: number) {
        await client.query(`UPDATE mm_doc_barcode_imports SET row_count = $2 WHERE id = $1`, [
          id,
          rowCount,
        ]);
      }

      if (existingImportId) {
        await client.query('BEGIN');
        try {
          const exists = await client.query<{ id: string }>(
            `SELECT id FROM mm_doc_barcode_imports WHERE id = $1`,
            [existingImportId]
          );
          if (!exists.rows[0]) throw new Error(`MM barcode import ${existingImportId} not found`);
          await insertRowBatch(client, existingImportId, rows, seqOffset);
          const saved = seqOffset + rows.length;
          await refreshCount(existingImportId, saved);
          if (expectedTotal != null && saved >= expectedTotal) {
            const actual = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM mm_doc_barcode_rows WHERE import_id = $1`,
              [existingImportId]
            );
            if (actual.rows[0]?.n !== expectedTotal) {
              throw new Error(
                `MM barcode import incomplete: expected ${expectedTotal}, have ${actual.rows[0]?.n ?? 0}`
              );
            }
          }
          await client.query('COMMIT');
          return await fetchMeta(client, existingImportId);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      await client.query('BEGIN');
      try {
        if (replaceExisting) {
          await client.query('DELETE FROM mm_doc_barcode_imports');
        }
        const ins = await client.query<{ id: string }>(
          `INSERT INTO mm_doc_barcode_imports (file_name, uploaded_by, row_count)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [fileName, uploadedBy, rows.length]
        );
        const importId = ins.rows[0]?.id;
        if (!importId) throw new Error('Failed to create MM barcode import');
        await insertRowBatch(client, importId, rows, seqOffset);
        const saved = seqOffset + rows.length;
        await refreshCount(importId, saved);
        if (expectedTotal != null && saved >= expectedTotal) {
          const actual = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM mm_doc_barcode_rows WHERE import_id = $1`,
            [importId]
          );
          if (actual.rows[0]?.n !== expectedTotal) {
            throw new Error(
              `MM barcode import incomplete: expected ${expectedTotal}, have ${actual.rows[0]?.n ?? 0}`
            );
          }
        }
        await client.query('COMMIT');
        return await fetchMeta(client, importId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: SAVE_STATEMENT_TIMEOUT_MS }
  );
}
