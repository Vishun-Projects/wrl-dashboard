import { createHash } from 'crypto';
import type pg from 'pg';
import { withClient } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import { fetchCrmIncrementalRows } from '@/lib/read-model/crm-fetch';
import {
  bootstrapSyncWatermarksFromHot,
  getSyncState,
  markSyncError,
  releaseStaleSyncLock,
  SYNC_WATERMARK_GUARD,
  tryAcquireSyncLock,
  updateSyncWatermarks,
  pollUntilSyncReleased,
  isSyncRunning,
} from '@/lib/read-model/lock';
import {
  factCountsFromHotRow,
  factKeyFromHotRow,
  serializeFactKey,
} from '@/lib/read-model/metrics';
import { applyFactDelta } from '@/lib/read-model/upsert-facts';
import {
  dedupeCrmRows,
  isHotEligibleRow,
  processCrmRows,
  transformCrmRowToHot,
} from '@/lib/read-model/transform';
import { parseCrmDate, currentYearStart } from '@/lib/read-model/dates';
import {
  countHotRows,
  deleteHotRowsByTrn,
  fetchHotRowsByTrn,
  upsertHotRows,
} from '@/lib/read-model/upsert-hot';
import { HOT_TARGET_ROWS } from '@/lib/read-model/sync-meta';
import type { HotRow } from '@/lib/read-model/types';

const ENTITY = 'calls_latest_hot';
const OVERLAP_MS = 2 * 60 * 1000;
const MIN_HOT_FOR_INCREMENTAL = Math.floor(HOT_TARGET_ROWS * 0.95);
const SYNC_TX_LOCK_TIMEOUT_MS = Number(process.env.PG_SYNC_LOCK_TIMEOUT_MS ?? 120_000);

function maxWatermarks(rows: Record<string, unknown>[]): {
  lastEditedon: Date | null;
  lastAddedon: Date | null;
} {
  let lastEditedon: Date | null = null;
  let lastAddedon: Date | null = null;

  for (const row of rows) {
    const edited = parseCrmDate(row.editedon ?? row.addedon);
    const added = parseCrmDate(row.addedon);
    if (edited && (!lastEditedon || edited > lastEditedon)) lastEditedon = edited;
    if (added && (!lastAddedon || added > lastAddedon)) lastAddedon = added;
  }

  return { lastEditedon, lastAddedon };
}

async function applyFactChanges(
  client: pg.PoolClient,
  oldRows: HotRow[],
  newRows: HotRow[]
): Promise<void> {
  const yearStart = currentYearStart();
  for (const row of oldRows) {
    const key = factKeyFromHotRow(row);
    if (key.fact_date < yearStart) continue;
    await applyFactDelta(client, key, factCountsFromHotRow(row), 'subtract');
  }
  for (const row of newRows) {
    const key = factKeyFromHotRow(row);
    if (key.fact_date < yearStart) continue;
    await applyFactDelta(client, key, factCountsFromHotRow(row), 'add');
  }
}

async function skipIncrementalReason(client: pg.PoolClient): Promise<string | null> {
  const state = await getSyncState(client);
  if (state?.status === 'pending_backfill' || state?.status === 'backfilling') {
    return `sync_state.status=${state.status}`;
  }
  const hotCount = await countHotRows(client);
  if (hotCount < MIN_HOT_FOR_INCREMENTAL) {
    return `hot rows ${hotCount} < ${MIN_HOT_FOR_INCREMENTAL} (backfill incomplete)`;
  }
  const watermark = state?.last_editedon;
  if (!watermark || watermark < SYNC_WATERMARK_GUARD) {
    const bootstrapped = await bootstrapSyncWatermarksFromHot(client);
    if (bootstrapped) return null;
    return `watermark not set (${watermark?.toISOString() ?? 'null'})`;
  }
  return null;
}

export function isPostgresLockError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /lock timeout|deadlock detected|could not obtain lock/i.test(message);
}

export type IncrementalSyncResult = {
  ok: boolean;
  skipped?: boolean;
  coalesced?: boolean;
  reason?: string;
  rowsUpserted?: number;
  rowsDeleted?: number;
  crmRowsFetched?: number;
};

let inFlightSync: Promise<IncrementalSyncResult> | null = null;

async function coalescedSyncResult(): Promise<IncrementalSyncResult> {
  const state = await withClient((client) => getSyncState(client));
  console.log('[sync-worker] Incremental coalesced — joined completed sync run');
  return {
    ok: true,
    coalesced: true,
    rowsUpserted: state?.rows_upserted_last ?? 0,
    rowsDeleted: 0,
  };
}

export async function runIncrementalSync(): Promise<IncrementalSyncResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    console.log('[sync-worker] SYNC_WORKER_ENABLED is not true — skipping incremental');
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }

  if (inFlightSync) {
    console.log('[sync-worker] Incremental coalesced — waiting for in-flight sync');
    return inFlightSync;
  }

  inFlightSync = runIncrementalSyncOnce().finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

async function runIncrementalSyncOnce(): Promise<IncrementalSyncResult> {
  const prep = await withClient(async (client) => {
    await releaseStaleSyncLock(client);

    const skipReason = await skipIncrementalReason(client);
    if (skipReason) {
      return { kind: 'skip' as const, reason: skipReason };
    }

    if (await isSyncRunning(client)) {
      return { kind: 'wait' as const };
    }

    return { kind: 'proceed' as const };
  });

  if (prep.kind === 'wait') {
    console.log('[sync-worker] Incremental waiting — another sync run is in progress');
    const released = await pollUntilSyncReleased(() => withClient((client) => isSyncRunning(client)));
    if (!released) {
      console.log('[sync-worker] Incremental skipped — timed out waiting for sync to finish');
      return {
        ok: false,
        skipped: true,
        reason: 'timed out waiting for sync to finish',
        rowsUpserted: 0,
        rowsDeleted: 0,
      };
    }
    return coalescedSyncResult();
  }

  if (prep.kind === 'skip') {
    console.log(`[sync-worker] Incremental skipped — ${prep.reason}`);
    return { ok: true, skipped: true, reason: prep.reason, rowsUpserted: 0, rowsDeleted: 0 };
  }

  return withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      console.log('[sync-worker] Incremental coalesced — lock taken before run started');
      return await coalescedSyncResult();
    }

    const startedAt = new Date();
    const state = await getSyncState(client);
    const watermarkBase = state?.last_editedon ?? new Date(0);
    const watermarkStart = new Date(watermarkBase.getTime() - OVERLAP_MS);
    const batch = await startIngestBatch(client, ENTITY, watermarkStart);
    const logId = await startSyncRunLog(client, ENTITY, batch.batchId);

    let rowsUpserted = 0;
    let rowsDeleted = 0;

    try {
      console.log(`[sync-worker] Incremental fetch from ${watermarkStart.toISOString()}`);
      const rawRows = await fetchCrmIncrementalRows(watermarkStart, (rows) => {
        console.log(`[sync-worker] CRM returned ${rows} changed rows`);
      });

      const deduped = dedupeCrmRows(rawRows);
      const trns = deduped
        .map((row) => String(row.vtrnno ?? row.UniqueCallNo ?? '').trim())
        .filter(Boolean);

      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL lock_timeout = '${SYNC_TX_LOCK_TIMEOUT_MS}'`);

        const existingHot = await fetchHotRowsByTrn(client, trns);
        const existingByTrn = new Map(existingHot.map((row) => [row.vtrnno, row]));

        const upsertRows: HotRow[] = [];
        const deleteTrns: string[] = [];

        for (const row of deduped) {
          const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
          if (!trn) continue;
          if (isHotEligibleRow(row)) {
            const hot = transformCrmRowToHot(row);
            if (hot) upsertRows.push(hot);
            else if (existingByTrn.has(trn)) deleteTrns.push(trn);
          } else if (existingByTrn.has(trn)) {
            deleteTrns.push(trn);
          }
        }

        rowsUpserted = await upsertHotRows(client, upsertRows);
        rowsDeleted = await deleteHotRowsByTrn(client, deleteTrns);

        const oldFactRows: HotRow[] = [];
        const newFactRows: HotRow[] = [];
        for (const row of upsertRows) {
          const old = existingByTrn.get(row.vtrnno);
          if (old) oldFactRows.push(old);
          newFactRows.push(row);
        }
        for (const trn of deleteTrns) {
          const old = existingByTrn.get(trn);
          if (old) oldFactRows.push(old);
        }
        await applyFactChanges(client, oldFactRows, newFactRows);

        const watermarks = maxWatermarks(deduped);
        const nextEdited =
          watermarks.lastEditedon && state?.last_editedon && watermarks.lastEditedon < state.last_editedon
            ? state.last_editedon
            : watermarks.lastEditedon ?? state?.last_editedon ?? null;
        const nextAdded =
          watermarks.lastAddedon && state?.last_addedon && watermarks.lastAddedon < state.last_addedon
            ? state.last_addedon
            : watermarks.lastAddedon ?? state?.last_addedon ?? null;

        if (deduped.length > 0) {
          await updateSyncWatermarks(client, nextEdited, nextAdded, rowsUpserted);
        } else {
          await updateSyncWatermarks(client, state?.last_editedon ?? null, state?.last_addedon ?? null, 0);
        }

        const checksum = createHash('sha256')
          .update(
            upsertRows
              .map((r) => r.vtrnno)
              .sort()
              .join(',')
          )
          .digest('hex');

        await completeIngestBatch(client, batch.batchId, nextEdited, rowsUpserted, 'completed', checksum);
        await finishSyncRunLog(client, logId, 'completed', {
          startedAt,
          rowsUpserted,
          rowsDeleted,
        });

        await client.query('COMMIT');

        console.log(
          `[sync-worker] Incremental complete — upserted ${rowsUpserted}, deleted ${rowsDeleted}, watermark ${nextEdited?.toISOString() ?? 'unchanged'}`
        );
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      return {
        ok: true,
        rowsUpserted,
        rowsDeleted,
        crmRowsFetched: deduped.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await completeIngestBatch(client, batch.batchId, null, 0, 'failed');
        await finishSyncRunLog(client, logId, 'failed', { startedAt, errorMessage: message });
      } catch (cleanupErr) {
        console.error('[sync-worker] Failed to record sync failure:', cleanupErr);
      }
      await markSyncError(client, message);
      throw err;
    }
  });
}

/** Process-only path for tests without lock (not exported for production). */
export function buildIncrementalPreview(rows: Record<string, unknown>[]) {
  return processCrmRows(rows);
}

export { serializeFactKey };
