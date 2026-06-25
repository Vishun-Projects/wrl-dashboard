import { randomUUID } from 'crypto';
import type pg from 'pg';

export type BatchHandle = {
  batchId: string;
  entity: string;
  watermarkStart: Date | null;
};

export async function startIngestBatch(
  client: pg.PoolClient,
  entity: string,
  watermarkStart: Date | null
): Promise<BatchHandle> {
  const batchId = randomUUID();
  await client.query(
    `
    INSERT INTO raw_ingest_batches (batch_id, entity, watermark_start, status)
    VALUES ($1, $2, $3, 'started')
    `,
    [batchId, entity, watermarkStart]
  );
  return { batchId, entity, watermarkStart };
}

export async function completeIngestBatch(
  client: pg.PoolClient,
  batchId: string,
  watermarkEnd: Date | null,
  rowCount: number,
  status: 'completed' | 'partial' | 'failed' = 'completed',
  checksum?: string
): Promise<void> {
  await client.query(
    `
    UPDATE raw_ingest_batches
    SET watermark_end = $2,
        row_count = $3,
        checksum = $4,
        status = $5
    WHERE batch_id = $1
    `,
    [batchId, watermarkEnd, rowCount, checksum ?? null, status]
  );
}

export async function startSyncRunLog(
  client: pg.PoolClient,
  entity: string,
  batchId: string
): Promise<number> {
  const result = await client.query(
    `
    INSERT INTO sync_run_log (entity, batch_id, status)
    VALUES ($1, $2, 'started')
    RETURNING id
    `,
    [entity, batchId]
  );
  return Number(result.rows[0].id);
}

export async function finishSyncRunLog(
  client: pg.PoolClient,
  logId: number,
  status: 'completed' | 'failed',
  opts: {
    rowsUpserted?: number;
    rowsDeleted?: number;
    errorMessage?: string;
    startedAt: Date;
  }
): Promise<void> {
  const durationMs = Date.now() - opts.startedAt.getTime();
  await client.query(
    `
    UPDATE sync_run_log
    SET finished_at = now(),
        duration_ms = $2,
        rows_upserted = $3,
        rows_deleted = $4,
        error_message = $5,
        status = $6
    WHERE id = $1
    `,
    [
      logId,
      durationMs,
      opts.rowsUpserted ?? 0,
      opts.rowsDeleted ?? 0,
      opts.errorMessage ?? null,
      status,
    ]
  );
}

export async function purgeOldSyncLogs(client: pg.PoolClient, days = 30): Promise<number> {
  const result = await client.query(
    `DELETE FROM sync_run_log WHERE started_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return result.rowCount ?? 0;
}

export async function purgeOldIngestBatches(client: pg.PoolClient, days = 90): Promise<number> {
  const result = await client.query(
    `DELETE FROM raw_ingest_batches WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return result.rowCount ?? 0;
}

/** Mark worker-crash batches as failed so admin UI does not show stuck started rows. */
export async function repairStaleIngestBatches(
  client: pg.PoolClient,
  staleMinutes = 10
): Promise<number> {
  const result = await client.query(
    `
    UPDATE raw_ingest_batches
    SET status = 'failed'
    WHERE status = 'started'
      AND created_at < now() - ($1 || ' minutes')::interval
    `,
    [String(staleMinutes)]
  );
  return result.rowCount ?? 0;
}
