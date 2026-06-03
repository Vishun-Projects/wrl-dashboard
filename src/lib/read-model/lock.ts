import type pg from 'pg';
import type { SyncStateRow } from '@/lib/read-model/types';

const ENTITY = 'calls_latest_hot';
/** How long is_running may stay true before a crashed worker's lock is cleared (default 5 min). */
export const STALE_LOCK_MS = Number(process.env.SYNC_STALE_LOCK_MS ?? 5 * 60 * 1000);
const SYNC_WAIT_POLL_MS = 2000;
/** Max wait when another sync holds the lock (stale threshold + 5 min buffer). */
export const SYNC_WAIT_TIMEOUT_MS =
  Number(process.env.SYNC_WAIT_TIMEOUT_MS) || STALE_LOCK_MS + 5 * 60 * 1000;
export const SYNC_WATERMARK_GUARD = new Date('2020-01-01T00:00:00.000Z');

import { sleep } from '@/lib/utils/async';

export async function releaseStaleSyncLock(client: pg.PoolClient): Promise<boolean> {
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
    [ENTITY, STALE_LOCK_MS]
  );
  if ((result.rowCount ?? 0) > 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`);
    console.log('[sync-worker] Released stale sync lock');
    return true;
  }
  return false;
}

export async function tryAcquireSyncLock(client: pg.PoolClient): Promise<boolean> {
  const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext('read_model_sync')) AS locked`);
  if (!lock.rows[0]?.locked) return false;

  const updated = await client.query(
    `
    UPDATE sync_state
    SET is_running = true
    WHERE entity = $1 AND is_running = false
    RETURNING entity
    `,
    [ENTITY]
  );
  if ((updated.rowCount ?? 0) === 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`);
    return false;
  }
  return true;
}

export async function releaseSyncLock(
  client: pg.PoolClient,
  status: 'ok' | 'error',
  rowsUpserted = 0
): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET is_running = false,
        last_run_at = now(),
        rows_upserted_last = $2,
        status = $3
    WHERE entity = $1
    `,
    [ENTITY, rowsUpserted, status]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`);
}

export async function getSyncState(client: pg.PoolClient): Promise<SyncStateRow | null> {
  const result = await client.query(`SELECT * FROM sync_state WHERE entity = $1`, [ENTITY]);
  return (result.rows[0] as SyncStateRow | undefined) ?? null;
}

export async function isSyncRunning(client: pg.PoolClient): Promise<boolean> {
  await releaseStaleSyncLock(client);
  const state = await getSyncState(client);
  return state?.is_running === true;
}

/** Poll until sync_state.is_running is false (or stale lock is cleared). */
export async function waitForSyncRelease(
  client: pg.PoolClient,
  timeoutMs = SYNC_WAIT_TIMEOUT_MS,
  pollMs = SYNC_WAIT_POLL_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isSyncRunning(client))) return true;
    await sleep(pollMs);
  }
  return false;
}

/** Poll using a fresh connection each check (does not hold a pool slot while sleeping). */
export async function pollUntilSyncReleased(
  isRunning: () => Promise<boolean>,
  timeoutMs = SYNC_WAIT_TIMEOUT_MS,
  pollMs = SYNC_WAIT_POLL_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isRunning())) return true;
    await sleep(pollMs);
  }
  return false;
}

export async function readHotTableWatermarks(
  client: pg.PoolClient
): Promise<{ lastEditedon: Date | null; lastAddedon: Date | null }> {
  const result = await client.query(`
    SELECT
      MAX(COALESCE(source_editedon, edited_at, synced_at)) AS last_editedon,
      MAX(COALESCE(added_at, logged_at, synced_at)) AS last_addedon
    FROM calls_latest_hot
  `);
  const row = result.rows[0] ?? {};
  return {
    lastEditedon: row.last_editedon ? new Date(row.last_editedon) : null,
    lastAddedon: row.last_addedon ? new Date(row.last_addedon) : null,
  };
}

/** Repair sync_state when backfill loaded hot rows but CRM editedon watermarks were empty. */
export async function bootstrapSyncWatermarksFromHot(
  client: pg.PoolClient
): Promise<{ lastEditedon: Date; lastAddedon: Date | null } | null> {
  const { lastEditedon, lastAddedon } = await readHotTableWatermarks(client);
  if (!lastEditedon || lastEditedon < SYNC_WATERMARK_GUARD) return null;

  await updateSyncWatermarks(client, lastEditedon, lastAddedon, 0);
  console.log(
    `[sync-worker] Bootstrapped watermarks from hot table — edited ${lastEditedon.toISOString()}`
  );
  return { lastEditedon, lastAddedon };
}

export async function updateSyncWatermarks(
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
    [ENTITY, lastEditedon, lastAddedon, rowsUpserted]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`);
}

export async function markSyncError(client: pg.PoolClient, message: string): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET is_running = false, status = 'error', last_run_at = now()
    WHERE entity = $1
    `,
    [ENTITY]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`);
  console.error('[sync-worker] sync_state error:', message);
}
