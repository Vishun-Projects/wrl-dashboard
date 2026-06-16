import { withClient } from '@/lib/read-model/db';
import {
  fetchCrmIncrementalChunk,
  planCrmIncrementalChunks,
} from '@/lib/read-model/crm-fetch';
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
import { buildNetFactDeltas, serializeFactKey } from '@/lib/read-model/metrics';
import { applyNetFactDeltas } from '@/lib/read-model/upsert-facts';
import {
  dedupeCrmRows,
  isHotEligibleRow,
  processCrmRows,
  transformCrmRowToHot,
} from '@/lib/read-model/transform';
import { endOfLocalDate, formatCrmDateTime, maxCrmWatermarks } from '@/lib/read-model/dates';
import {
  countHotRows,
  deleteHotRowsByTrn,
  fetchHotRowsByTrn,
  upsertHotRows,
} from '@/lib/read-model/upsert-hot';
import { HOT_TARGET_ROWS } from '@/lib/read-model/constants';
import type { HotRow } from '@/lib/read-model/types';

const OVERLAP_MS = 2 * 60 * 1000;
const MIN_HOT_FOR_INCREMENTAL = Math.floor(HOT_TARGET_ROWS * 0.95);
const SYNC_TX_LOCK_TIMEOUT_MS = Number(process.env.PG_SYNC_LOCK_TIMEOUT_MS ?? 120_000);

async function skipIncrementalReason(client: import('pg').PoolClient): Promise<string | null> {
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
  partial?: boolean;
  reason?: string;
  rowsUpserted?: number;
  rowsDeleted?: number;
  crmRowsFetched?: number;
  chunksCompleted?: number;
  chunksTotal?: number;
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

async function writeIncrementalRows(
  client: import('pg').PoolClient,
  deduped: Record<string, unknown>[],
  opts: {
    state: Awaited<ReturnType<typeof getSyncState>>;
    emptyChunkEndDate?: string;
  }
): Promise<{ rowsUpserted: number; rowsDeleted: number; nextEdited: Date | null; nextAdded: Date | null }> {
  const { state, emptyChunkEndDate } = opts;
  const trns = deduped
    .map((row) => String(row.vtrnno ?? row.UniqueCallNo ?? '').trim())
    .filter(Boolean);

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '${SYNC_TX_LOCK_TIMEOUT_MS}'`);
    await client.query(
      `SET LOCAL statement_timeout = '${Number(process.env.SYNC_PG_STATEMENT_TIMEOUT_MS ?? 600_000)}'`
    );

    const existingHot = trns.length > 0 ? await fetchHotRowsByTrn(client, trns) : [];
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

    const rowsUpserted = await upsertHotRows(client, upsertRows);
    const rowsDeleted = await deleteHotRowsByTrn(client, deleteTrns);

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

    const netFacts = buildNetFactDeltas(oldFactRows, newFactRows);
    await applyNetFactDeltas(client, netFacts);

    const watermarks = maxCrmWatermarks(deduped);
    let nextEdited =
      watermarks.lastEditedon && state?.last_editedon && watermarks.lastEditedon < state.last_editedon
        ? state.last_editedon
        : watermarks.lastEditedon ?? state?.last_editedon ?? null;
    let nextAdded =
      watermarks.lastAddedon && state?.last_addedon && watermarks.lastAddedon < state.last_addedon
        ? state.last_addedon
        : watermarks.lastAddedon ?? state?.last_addedon ?? null;

    if (deduped.length === 0 && emptyChunkEndDate) {
      const chunkEnd = endOfLocalDate(emptyChunkEndDate);
      if (!nextEdited || chunkEnd > nextEdited) {
        nextEdited = chunkEnd;
      }
    }

    await updateSyncWatermarks(client, nextEdited, nextAdded, rowsUpserted);
    await client.query('COMMIT');

    return { rowsUpserted, rowsDeleted, nextEdited, nextAdded };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
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

  const watermarkStart = await withClient(async (client) => {
    const state = await getSyncState(client);
    const watermarkBase = state?.last_editedon ?? new Date(0);
    return new Date(watermarkBase.getTime() - OVERLAP_MS);
  });

  console.log(`[sync-worker] Incremental fetch from ${watermarkStart.toISOString()}`);
  const plan = planCrmIncrementalChunks(watermarkStart);
  if (plan.catchUpDays > 1) {
    console.log(
      `[sync-worker] CRM catch-up mode: ~${plan.catchUpDays} day(s), ${plan.chunks.length} chunk(s) (${plan.chunkDays}-day windows, ${plan.startDate}..${plan.endDate})`
    );
    console.log(
      `[sync-worker] CRM load estimate: ~${plan.estimatedCrmRequests} sequential DBQUERY requests (lightweight sync query, rate-limited)`
    );
  }

  let totalUpserted = 0;
  let totalDeleted = 0;
  let totalFetched = 0;
  let chunksCompleted = 0;
  let currentWatermark = plan.watermark;

  for (const chunk of plan.chunks) {
    let rawRows: Record<string, unknown>[];
    try {
      rawRows = await fetchCrmIncrementalChunk(currentWatermark, chunk);
    } catch (err) {
      if (chunksCompleted > 0) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[sync-worker] Incremental partial — ${chunksCompleted}/${plan.chunks.length} chunks synced before CRM error: ${message}`
        );
        return {
          ok: true,
          partial: true,
          rowsUpserted: totalUpserted,
          rowsDeleted: totalDeleted,
          crmRowsFetched: totalFetched,
          chunksCompleted,
          chunksTotal: plan.chunks.length,
          reason: message,
        };
      }
      throw err;
    }

    const deduped = dedupeCrmRows(rawRows);
    totalFetched += deduped.length;
    console.log(
      `[sync-worker] CRM chunk ${chunk.start}..${chunk.end}: ${deduped.length} rows — writing to Postgres`
    );

    const chunkResult = await withClient(async (client) => {
      const acquired = await tryAcquireSyncLock(client);
      if (!acquired) {
        return { kind: 'coalesced' as const };
      }

      const state = await getSyncState(client);
      try {
        const written = await writeIncrementalRows(client, deduped, {
          state,
          emptyChunkEndDate: deduped.length === 0 ? chunk.end : undefined,
        });
        return { kind: 'written' as const, ...written };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markSyncError(client, message);
        throw err;
      }
    });

    if (chunkResult.kind === 'coalesced') {
      console.log('[sync-worker] Incremental coalesced — lock taken during chunk write');
      return await coalescedSyncResult();
    }

    totalUpserted += chunkResult.rowsUpserted;
    totalDeleted += chunkResult.rowsDeleted;
    chunksCompleted += 1;
    if (chunkResult.nextEdited) {
      currentWatermark = formatCrmDateTime(
        new Date(chunkResult.nextEdited.getTime() - OVERLAP_MS)
      );
    }

    console.log(
      `[sync-worker] Chunk ${chunk.start}..${chunk.end} done — upserted ${chunkResult.rowsUpserted}, deleted ${chunkResult.rowsDeleted}, watermark ${chunkResult.nextEdited?.toISOString() ?? 'unchanged'}`
    );
  }

  console.log(
    `[sync-worker] Incremental complete — upserted ${totalUpserted}, deleted ${totalDeleted}, fetched ${totalFetched}, ${chunksCompleted}/${plan.chunks.length} chunks`
  );

  return {
    ok: true,
    rowsUpserted: totalUpserted,
    rowsDeleted: totalDeleted,
    crmRowsFetched: totalFetched,
    chunksCompleted,
    chunksTotal: plan.chunks.length,
  };
}

/** Process-only path for tests without lock (not exported for production). */
export function buildIncrementalPreview(rows: Record<string, unknown>[]) {
  return processCrmRows(rows);
}

export { serializeFactKey };
