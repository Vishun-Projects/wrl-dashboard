import { withAppClient } from '@/lib/read-model/db';
import { deleteImportFile } from '@/modules/mis/client-import/services/file-store';
import { IMPORT_FILE_RETENTION_DAYS } from '@/modules/mis/client-import/services/file-retention';
import { recomputeBatchRowStatsForSource } from '@/modules/mis/client-import/services/config';

export { IMPORT_FILE_RETENTION_DAYS };
export const DEFAULT_IMPORT_FILE_RETENTION_DAYS = IMPORT_FILE_RETENTION_DAYS;

export function resolveImportFileRetentionDays(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.MIS_CLIENT_IMPORT_FILE_RETENTION_DAYS?.trim();
  const n = raw ? Number(raw) : DEFAULT_IMPORT_FILE_RETENTION_DAYS;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IMPORT_FILE_RETENTION_DAYS;
}

export type PurgeExpiredImportFilesResult = {
  retentionDays: number;
  dryRun: boolean;
  candidates: number;
  filesDeleted: number;
  blobsCleared: number;
  rowsPurgedBatches?: number;
};

/**
 * Drop original upload files (disk path + bytea blob) and import rows older than retention.
 * Data is completely purged, but the batch metadata and UI row counts stay.
 */
export async function purgeExpiredImportStoredFiles(opts?: {
  retentionDays?: number;
  dryRun?: boolean;
}): Promise<PurgeExpiredImportFilesResult> {
  const retentionDays = opts?.retentionDays ?? resolveImportFileRetentionDays();
  const dryRun = Boolean(opts?.dryRun);

  return withAppClient(async (client) => {
    const res = await client.query<{
      batch_id: string;
      source_id: string;
      stored_file_path: string | null;
      has_blob: boolean;
      has_rows: boolean;
    }>(
      `
      SELECT b.batch_id,
             b.source_id,
             b.stored_file_path,
             (b.stored_file_blob IS NOT NULL AND octet_length(b.stored_file_blob) > 0) AS has_blob,
             EXISTS(SELECT 1 FROM mis_client_import_rows r WHERE r.batch_id = b.batch_id) AS has_rows
      FROM mis_client_import_batches b
      JOIN (
        SELECT source_id, MAX(created_at) as latest_upload_at
        FROM mis_client_import_batches
        WHERE status = 'completed'
        GROUP BY source_id
      ) latest ON latest.source_id = b.source_id
      WHERE b.created_at < latest.latest_upload_at - ($1::int * interval '1 day')
        AND (
          NULLIF(btrim(COALESCE(b.stored_file_path, '')), '') IS NOT NULL
          OR (b.stored_file_blob IS NOT NULL AND octet_length(b.stored_file_blob) > 0)
          OR EXISTS(SELECT 1 FROM mis_client_import_rows r WHERE r.batch_id = b.batch_id)
        )
      ORDER BY b.created_at ASC
      `,
      [retentionDays]
    );

    let filesDeleted = 0;
    let blobsCleared = 0;
    let rowsPurgedBatches = 0;
    const affectedSources = new Set<string>();

    for (const row of res.rows) {
      if (dryRun) {
        if (row.stored_file_path) filesDeleted += 1;
        if (row.has_blob) blobsCleared += 1;
        if (row.has_rows) rowsPurgedBatches += 1;
        continue;
      }

      if (row.stored_file_path) {
        await deleteImportFile(row.stored_file_path);
        filesDeleted += 1;
      }

      await client.query(
        `
        UPDATE mis_client_import_batches
        SET stored_file_path = NULL,
            stored_file_blob = NULL
        WHERE batch_id = $1::uuid
        `,
        [row.batch_id]
      );

      if (row.has_rows) {
        await client.query(
          `DELETE FROM mis_client_import_rows WHERE batch_id = $1::uuid`,
          [row.batch_id]
        );
        affectedSources.add(row.source_id);
        rowsPurgedBatches += 1;
      }

      if (row.has_blob) blobsCleared += 1;
    }

    if (!dryRun) {
      for (const sourceId of affectedSources) {
        await recomputeBatchRowStatsForSource(sourceId, client);
      }
    }

    return {
      retentionDays,
      dryRun,
      candidates: res.rows.length,
      filesDeleted,
      blobsCleared,
      rowsPurgedBatches, // Note: Added to PurgeExpiredImportFilesResult implicitly by returning it, assuming PurgeExpiredImportFilesResult allows it or we update it
    } as PurgeExpiredImportFilesResult & { rowsPurgedBatches: number };
  });
}
