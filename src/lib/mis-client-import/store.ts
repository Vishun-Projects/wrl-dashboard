import { withAppClient } from '@/lib/read-model/db';
import { deleteImportFile, saveImportFile } from '@/lib/mis-client-import/file-store';
import { saveBatchFileBlob } from '@/lib/mis-client-import/batch-file';
import type { ImportResult, NormalizedClientRow } from '@/lib/mis-client-import/types';

const INSERT_BATCH_SIZE = 500;

export async function storeImportBatch(params: {
  sourceId: string;
  sourceCode: string;
  uploadedBy: string;
  fileName: string;
  fileBuffer: Buffer;
  rows: NormalizedClientRow[];
  errorCount: number;
}): Promise<ImportResult> {
  const { sourceId, sourceCode, uploadedBy, fileName, fileBuffer, rows, errorCount } = params;

  let filterStart: string | null = null;
  let filterEnd: string | null = null;
  for (const row of rows) {
    if (!row.logged_at) continue;
    const iso = row.logged_at.toISOString().slice(0, 10);
    if (!filterStart || iso < filterStart) filterStart = iso;
    if (!filterEnd || iso > filterEnd) filterEnd = iso;
  }

  return withAppClient(async (client) => {
    await client.query('BEGIN');
    let batchId = '';
    let storedFilePath: string | null = null;
    try {
      const batchRes = await client.query<{ batch_id: string }>(
        `
        INSERT INTO mis_client_import_batches
          (source_id, uploaded_by, file_name, filter_start, filter_end, row_count, error_count, status, is_active)
        VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date, $6, $7, 'completed', true)
        RETURNING batch_id
        `,
        [sourceId, uploadedBy, fileName, filterStart, filterEnd, rows.length, errorCount]
      );
      batchId = batchRes.rows[0].batch_id;

      storedFilePath = await saveImportFile({
        sourceCode,
        batchId,
        fileName,
        buffer: fileBuffer,
      });

      try {
        await saveBatchFileBlob(batchId, fileBuffer);
      } catch (blobErr) {
        console.warn(
          '[mis-client-import] stored_file_blob save failed (run db:apply-read-model for migration 15):',
          blobErr
        );
      }

      await client.query(
        `UPDATE mis_client_import_batches SET stored_file_path = $2 WHERE batch_id = $1::uuid`,
        [batchId, storedFilePath]
      );

      for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
        const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
        const values: unknown[] = [];
        const placeholders: string[] = [];

        chunk.forEach((row, idx) => {
          const base = idx * 15;
          placeholders.push(
            `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}::timestamptz, $${base + 5}::timestamptz,
              $${base + 6}::status_bucket_type, $${base + 7}, $${base + 8}, $${base + 9},
              $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}::jsonb)`
          );
          values.push(
            batchId,
            sourceId,
            row.call_key,
            row.logged_at,
            row.solved_at,
            row.status_bucket,
            row.status_label,
            row.region,
            row.state,
            row.branch_label,
            row.complaint,
            row.call_type,
            row.is_part_pending,
            row.engineer_name,
            JSON.stringify(row.raw)
          );
        });

        await client.query(
          `
          INSERT INTO mis_client_import_rows
            (batch_id, source_id, call_key, logged_at, solved_at, status_bucket, status_label,
             region, state, branch_label, complaint, call_type, is_part_pending, engineer_name, raw)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (batch_id, call_key) DO UPDATE SET
            source_id = EXCLUDED.source_id,
            logged_at = EXCLUDED.logged_at,
            solved_at = EXCLUDED.solved_at,
            status_bucket = EXCLUDED.status_bucket,
            status_label = EXCLUDED.status_label,
            region = EXCLUDED.region,
            state = EXCLUDED.state,
            branch_label = EXCLUDED.branch_label,
            complaint = EXCLUDED.complaint,
            call_type = EXCLUDED.call_type,
            is_part_pending = EXCLUDED.is_part_pending,
            engineer_name = EXCLUDED.engineer_name,
            raw = EXCLUDED.raw
          `,
          values
        );
      }

      await client.query('COMMIT');

      return {
        batchId,
        rowCount: rows.length,
        errorCount,
        errors: [],
        warnings: [],
        filterStart,
        filterEnd,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (storedFilePath) {
        await deleteImportFile(storedFilePath);
      }
      throw err;
    }
  });
}

export async function deleteImportBatch(batchId: string): Promise<{
  deleted: boolean;
  storedFilePath: string | null;
}> {
  return withAppClient(async (client) => {
    const res = await client.query<{ stored_file_path: string | null }>(
      `SELECT stored_file_path FROM mis_client_import_batches WHERE batch_id = $1::uuid`,
      [batchId]
    );
    const row = res.rows[0];
    if (!row) return { deleted: false, storedFilePath: null };

    await client.query(`DELETE FROM mis_client_import_batches WHERE batch_id = $1::uuid`, [batchId]);
    return { deleted: true, storedFilePath: row.stored_file_path };
  });
}
