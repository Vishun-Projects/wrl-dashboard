import type pg from 'pg';
import type { SyncStateRow } from '@/lib/read-model/types';
import {
  CALLS_MIRROR_ENTITY,
  CALLS_MIRROR_LOCK_KEY,
} from '@/lib/read-model/calls-mirror/constants';
import { STALE_LOCK_MS } from '@/lib/read-model/lock';

export async function releaseStaleMirrorLock(client: pg.PoolClient): Promise<boolean> {
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
    [CALLS_MIRROR_ENTITY, STALE_LOCK_MS]
  );
  if ((result.rowCount ?? 0) > 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
    console.log('[calls-mirror] Released stale sync lock');
    return true;
  }
  return false;
}

export async function tryAcquireMirrorLock(client: pg.PoolClient): Promise<boolean> {
  const lock = await client.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
    [CALLS_MIRROR_LOCK_KEY]
  );
  if (!lock.rows[0]?.locked) return false;

  const updated = await client.query(
    `
    UPDATE sync_state
    SET is_running = true
    WHERE entity = $1 AND is_running = false
    RETURNING entity
    `,
    [CALLS_MIRROR_ENTITY]
  );
  if ((updated.rowCount ?? 0) === 0) {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
    return false;
  }
  return true;
}

export async function releaseMirrorLock(
  client: pg.PoolClient,
  status: string,
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
    [CALLS_MIRROR_ENTITY, rowsUpserted, status]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
}

export async function getMirrorSyncState(client: pg.PoolClient): Promise<SyncStateRow | null> {
  const result = await client.query(`SELECT * FROM sync_state WHERE entity = $1`, [
    CALLS_MIRROR_ENTITY,
  ]);
  return (result.rows[0] as SyncStateRow | undefined) ?? null;
}

export async function updateMirrorWatermarks(
  client: pg.PoolClient,
  lastEditedon: Date | null,
  lastAddedon: Date | null,
  rowsUpserted: number,
  status = 'ok'
): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET last_editedon = $2,
        last_addedon = $3,
        last_run_at = now(),
        is_running = false,
        rows_upserted_last = $4,
        status = $5
    WHERE entity = $1
    `,
    [CALLS_MIRROR_ENTITY, lastEditedon, lastAddedon, rowsUpserted, status]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
}

export async function markMirrorError(client: pg.PoolClient, message: string): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET is_running = false, status = 'error', last_run_at = now()
    WHERE entity = $1
    `,
    [CALLS_MIRROR_ENTITY]
  );
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
  console.error('[calls-mirror] sync_state error:', message);
}

/** Backfill resume cursor: last completed dtrndate calendar day (stored in last_addedon). */
export async function writeMirrorBackfillCursor(
  client: pg.PoolClient,
  completedDay: string,
  rowsUpserted: number
): Promise<void> {
  await client.query(
    `
    UPDATE sync_state
    SET last_addedon = $2::timestamptz,
        last_run_at = now(),
        rows_upserted_last = $3,
        status = 'backfilling',
        is_running = true
    WHERE entity = $1
    `,
    [CALLS_MIRROR_ENTITY, `${completedDay}T00:00:00`, rowsUpserted]
  );
}

/**
 * Mark mirror ready for editedon incremental.
 * Prefer `watermarkFrom` = backfill job start (minus small overlap) so CRM edits
 * during the long dtrndate backfill are not skipped by MAX(source_editedon).
 */
export async function finishMirrorBackfill(
  client: pg.PoolClient,
  opts?: { watermarkFrom?: Date | null }
): Promise<Date | null> {
  let stamp = opts?.watermarkFrom ?? null;
  if (!stamp || Number.isNaN(stamp.getTime())) {
    const result = await client.query<{ last_editedon: Date | null }>(`
      SELECT MAX(COALESCE(source_editedon, edited_at, synced_at)) AS last_editedon
      FROM calls_crm_mirror
    `);
    stamp = result.rows[0]?.last_editedon
      ? new Date(result.rows[0].last_editedon)
      : null;
  }
  if (!stamp || Number.isNaN(stamp.getTime())) return null;
  await client.query(
    `
    UPDATE sync_state
    SET last_editedon = $2,
        last_run_at = now(),
        status = 'ok',
        is_running = false
    WHERE entity = $1
    `,
    [CALLS_MIRROR_ENTITY, stamp]
  );
  return stamp;
}

/** @deprecated use finishMirrorBackfill */
export async function bootstrapMirrorEditedonFromTable(
  client: pg.PoolClient
): Promise<Date | null> {
  return finishMirrorBackfill(client);
}
