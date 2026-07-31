import { withAppClient } from '@/lib/read-model/db';
import { deleteImportFile } from '@/features/mis-import/services/file-store';
import { IMPORT_FILE_RETENTION_DAYS } from '@/features/mis-import/services/file-retention';

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
};

/**
 * Drop original upload files (disk path + bytea blob) older than retention.
 * Imported rows stay; download falls back to reconstructing from `raw`.
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
      stored_file_path: string | null;
      has_blob: boolean;
    }>(
      `
      SELECT batch_id,
             stored_file_path,
             (stored_file_blob IS NOT NULL AND octet_length(stored_file_blob) > 0) AS has_blob
      FROM mis_client_import_batches
      WHERE created_at < now() - ($1::int * interval '1 day')
        AND (
          NULLIF(btrim(COALESCE(stored_file_path, '')), '') IS NOT NULL
          OR (stored_file_blob IS NOT NULL AND octet_length(stored_file_blob) > 0)
        )
      ORDER BY created_at ASC
      `,
      [retentionDays]
    );

    let filesDeleted = 0;
    let blobsCleared = 0;

    for (const row of res.rows) {
      if (dryRun) {
        if (row.stored_file_path) filesDeleted += 1;
        if (row.has_blob) blobsCleared += 1;
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

      if (row.has_blob) blobsCleared += 1;
    }

    return {
      retentionDays,
      dryRun,
      candidates: res.rows.length,
      filesDeleted,
      blobsCleared,
    };
  });
}
