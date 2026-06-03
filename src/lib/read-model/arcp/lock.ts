import type pg from 'pg';
import type { SyncStateRow } from '@/lib/read-model/types';
import { SYNC_WATERMARK_GUARD } from '@/lib/read-model/lock';

export const ARCP_ENTITY = 'arcp_lines_hot';
const ADVISORY_KEY = 'read_model_sync_arcp';

export const ARCP_STALE_LOCK_MS = Number(process.env.SYNC_STALE_LOCK_MS ?? 5 * 60 * 1000);

import { sleep } from '@/lib/utils/async';

export async function releaseStaleArcpSyncLock(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query(
    `
    UPDATE sync_state
    SET is_running = false
    WHERE entity = $1
      AND is_running = true
      AND (
        last_run_at IS NULL
        OR last_run_at < now() - ($2::int * interval '1 millisecond')
      )
    RETURNING entity
    `,
    [ARCP_ENTITY, ARCP_STALE_LOCK_MS]
  );
  if ((result.rowCount ?? 0) > 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_KEY]);
    console.log('[arcp-sync] Released stale sync lock');
    return true;
  }
  return false;
}

export async function tryAcquireArcpSyncLock(client: pg.PoolClient): Promise<boolean> {
  const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [
    ADVISORY_KEY,
  ]);
  if (!lock.rows[0]?.locked) return false;

  const updated = await client.query(
    `
    UPDATE sync_state
    SET is_running = true
    WHERE entity = $1 AND is_running = false
    RETURNING entity
    `,
    [ARCP_ENTITY]
  );
  if ((updated.rowCount ?? 0) === 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_KEY]);
    return false;
  }
  return true;
}

export async function getArcpSyncState(client: pg.PoolClient): Promise<SyncStateRow | null> {
  const result = await client.query(`SELECT * FROM sync_state WHERE entity = $1`, [ARCP_ENTITY]);
  return (result.rows[0] as SyncStateRow | undefined) ?? null;
}

export async function isArcpSyncRunning(client: pg.PoolClient): Promise<boolean> {
  await releaseStaleArcpSyncLock(client);
  const state = await getArcpSyncState(client);
  return state?.is_running === true;
}

export async function readArcpTableWatermarks(
  client: pg.PoolClient
): Promise<{ lastEditedon: Date | null; lastAddedon: Date | null }> {
  const result = await client.query(`
    SELECT
      MAX(COALESCE(source_editedon, synced_at)) AS last_editedon,
      MAX(COALESCE(added_at, synced_at)) AS last_addedon
    FROM arcp_lines_hot
  `);
  const row = result.rows[0] ?? {};
  return {
    lastEditedon: row.last_editedon ? new Date(row.last_editedon) : null,
    lastAddedon: row.last_addedon ? new Date(row.last_addedon) : null,
  };
}

export async function bootstrapArcpWatermarksFromHot(
  client: pg.PoolClient
): Promise<{ lastEditedon: Date; lastAddedon: Date | null } | null> {
  const { lastEditedon, lastAddedon } = await readArcpTableWatermarks(client);
  if (!lastEditedon || lastEditedon < SYNC_WATERMARK_GUARD) return null;
  await updateArcpSyncWatermarks(client, lastEditedon, lastAddedon, 0);
  console.log(
    `[arcp-sync] Bootstrapped watermarks from arcp_lines_hot — edited ${lastEditedon.toISOString()}`
  );
  return { lastEditedon, lastAddedon };
}

export async function updateArcpSyncWatermarks(
  client: pg.PoolClient,
  lastEditedon: Date | null,
  lastAddedon: Date | null,
  rowsUpserted: number
): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET last_editedon = $2,
        last_addedon = $3,
        last_run_at = now(),
        is_running = false,
        rows_upserted_last = $4,
        status = 'ok'
    WHERE entity = $1
    `,
    [ARCP_ENTITY, lastEditedon, lastAddedon, rowsUpserted]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_KEY]);
}

export async function markArcpSyncError(client: pg.PoolClient, message: string): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET is_running = false, status = 'error', last_run_at = now()
    WHERE entity = $1
    `,
    [ARCP_ENTITY]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_KEY]);
  console.error('[arcp-sync] sync_state error:', message);
}

export async function pollUntilArcpSyncReleased(
  isRunning: () => Promise<boolean>,
  timeoutMs = Number(process.env.SYNC_WAIT_TIMEOUT_MS) || ARCP_STALE_LOCK_MS + 5 * 60 * 1000,
  pollMs = 2000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isRunning())) return true;
    await sleep(pollMs);
  }
  return false;
}
