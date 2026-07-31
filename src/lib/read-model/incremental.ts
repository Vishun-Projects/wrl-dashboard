import { withClient } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import {
  fetchCrmIncrementalEditedonDelta,
  planCrmIncrementalEditedonDelta,
} from '@/lib/read-model/crm-fetch';
import {
  bootstrapSyncWatermarksFromHot,
  getSyncState,
  markSyncError,
  releaseStaleSyncLock,
  SYNC_WATERMARK_GUARD,
  tryAcquireSyncLock,
  pollUntilSyncReleased,
  isSyncRunning,
  releaseSyncLock,
} from '@/lib/read-model/lock';
import { buildNetFactDeltas, serializeFactKey } from '@/lib/read-model/metrics';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { processCrmRows } from '@/lib/read-model/transform';
import { countHotRows } from '@/lib/read-model/upsert-hot';
import { HOT_TARGET_ROWS } from '@/lib/read-model/sync-meta';
import { runPipelineReconcile } from '@/lib/read-model/pipeline-reconcile';
import { runReconcileTechSolved } from '@/lib/read-model/reconcile-tech-solved';
import { runEditedonCatchupStep } from '@/lib/read-model/editedon-catchup';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import { checkMajorRepairRepeatAlerts } from '@/lib/read-model/major-repair-repeat-alert';
import { runReconcileMajor } from '@/lib/read-model/reconcile-major';

const OVERLAP_MS = 2 * 60 * 1000;
const MIN_HOT_FOR_INCREMENTAL = Math.floor(HOT_TARGET_ROWS * 0.95);
const INCREMENTAL_ENTITY = 'calls_latest_hot';

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
  pipelineReconciled?: number;
  techSolvedReconciled?: number;
  editedonCatchup?: number;
  majorReconciled?: number;
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

  const watermarkStart = await withClient(async (client) => {
    const state = await getSyncState(client);
    const watermarkBase = state?.last_editedon ?? new Date(0);
    return new Date(watermarkBase.getTime() - OVERLAP_MS);
  });

  const startedAt = new Date();
  const audit = await withClient(async (client) => {
    const batch = await startIngestBatch(client, INCREMENTAL_ENTITY, watermarkStart);
    const logId = await startSyncRunLog(client, INCREMENTAL_ENTITY, batch.batchId);
    return { batchId: batch.batchId, logId };
  });

  const finishIncrementalAudit = async (
    status: 'completed' | 'partial' | 'failed',
    opts: {
      watermarkEnd?: Date | null;
      rowsUpserted: number;
      rowsDeleted?: number;
      errorMessage?: string;
    }
  ) => {
    await withClient(async (client) => {
      await completeIngestBatch(
        client,
        audit.batchId,
        opts.watermarkEnd ?? null,
        opts.rowsUpserted,
        status === 'partial' ? 'partial' : status === 'completed' ? 'completed' : 'failed'
      );
      await finishSyncRunLog(client, audit.logId, status === 'failed' ? 'failed' : 'completed', {
        startedAt,
        rowsUpserted: opts.rowsUpserted,
        rowsDeleted: opts.rowsDeleted ?? 0,
        errorMessage: opts.errorMessage,
      });
    });
  };

  const plan = planCrmIncrementalEditedonDelta(watermarkStart);
  console.log(
    `[sync-worker] Incremental editedon delta from ${plan.watermark} (catch-up ~${plan.catchUpDays} day(s), ${plan.estimatedCrmRequests} ncode shards)`
  );

  let rawRows: Record<string, unknown>[];
  try {
    rawRows = await fetchCrmIncrementalEditedonDelta(plan.watermark);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishIncrementalAudit('failed', {
      rowsUpserted: 0,
      rowsDeleted: 0,
      errorMessage: message,
    });
    throw err;
  }

  console.log(`[sync-worker] CRM editedon delta: ${rawRows.length} rows — writing to Postgres`);

  const writeResult = await withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      return { kind: 'coalesced' as const };
    }

    const state = await getSyncState(client);
    try {
      const written = await applyCrmRowsToHot(client, rawRows, { state, advanceWatermarks: true });
      const repaired = await repairHotCancelFromNcrReason(client);
      if (repaired > 0) {
        console.log(`[sync-worker] Repaired ${repaired} hot row(s) — ncancelreason → cancelled`);
      }
      await releaseSyncLock(client, 'ok', written.rowsUpserted);
      return { kind: 'written' as const, ...written };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markSyncError(client, message);
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });

  if (writeResult.kind === 'coalesced') {
    console.log('[sync-worker] Incremental coalesced — lock taken during write');
    return await coalescedSyncResult();
  }

  console.log(
    `[sync-worker] Incremental complete — upserted ${writeResult.rowsUpserted}, deleted ${writeResult.rowsDeleted}, fetched ${rawRows.length}, watermark ${writeResult.nextEdited?.toISOString() ?? 'unchanged'}`
  );

  await finishIncrementalAudit('completed', {
    watermarkEnd: writeResult.nextEdited,
    rowsUpserted: writeResult.rowsUpserted,
    rowsDeleted: writeResult.rowsDeleted,
  });

  try {
    await checkMajorRepairRepeatAlerts(writeResult.upsertedRows ?? []);
  } catch (err) {
    console.warn(
      '[sync-worker] major-repair-repeat-alert failed (incremental succeeded):',
      err instanceof Error ? err.message : err
    );
  }

  let pipelineReconciled = 0;
  let pipelineDeleted = 0;
  try {
    const pipeline = await runPipelineReconcile();
    pipelineReconciled = pipeline.refreshed ?? 0;
    pipelineDeleted = pipeline.rowsDeleted ?? 0;
    if (pipelineReconciled > 0 || pipelineDeleted > 0) {
      console.log(
        `[sync-worker] Pipeline reconcile — refreshed ${pipelineReconciled}, deleted ${pipelineDeleted}`
      );
    }
  } catch (err) {
    console.warn(
      '[sync-worker] Pipeline reconcile failed (incremental succeeded):',
      err instanceof Error ? err.message : err
    );
  }

  let techSolvedReconciled = 0;
  if (process.env.SYNC_TECH_SOLVED_RECONCILE_ENABLED !== 'false') {
    try {
      const perRun = Math.max(200, Number(process.env.RECONCILE_TECH_SOLVED_PER_RUN ?? 800) || 800);
      const tech = await runReconcileTechSolved({ apply: true, limit: perRun });
      techSolvedReconciled = tech.rowsUpserted ?? 0;
      if (techSolvedReconciled > 0 || (tech.stale ?? 0) > 0) {
        console.log(
          `[sync-worker] tech_solved reconcile — checked ${tech.checked}, stale ${tech.stale}, upserted ${techSolvedReconciled}`
        );
      }
    } catch (err) {
      console.warn(
        '[sync-worker] tech_solved reconcile failed (incremental succeeded):',
        err instanceof Error ? err.message : err
      );
    }
  }

  let editedonCatchup = 0;
  try {
    const catchup = await runEditedonCatchupStep();
    editedonCatchup = catchup.rowsUpserted ?? 0;
    if (catchup.daysProcessed) {
      console.log(
        `[sync-worker] Editedon catch-up step ${catchup.fromDay}..${catchup.toDay} — upserted ${editedonCatchup}`
      );
    }
  } catch (err) {
    console.warn(
      '[sync-worker] Editedon catch-up failed (incremental succeeded):',
      err instanceof Error ? err.message : err
    );
  }

  let majorReconciled = 0;
  try {
    const major = await runReconcileMajor();
    majorReconciled = major.rowsUpserted ?? 0;
    if ((major.refreshed ?? 0) > 0 || majorReconciled > 0) {
      console.log(
        `[sync-worker] Major reconcile — refreshed ${major.refreshed ?? 0}, upserted ${majorReconciled}`
      );
    }
  } catch (err) {
    console.warn(
      '[sync-worker] Major reconcile failed (incremental succeeded):',
      err instanceof Error ? err.message : err
    );
  }

  return {
    ok: true,
    rowsUpserted: writeResult.rowsUpserted,
    rowsDeleted: writeResult.rowsDeleted,
    crmRowsFetched: rawRows.length,
    pipelineReconciled,
    techSolvedReconciled,
    editedonCatchup,
    majorReconciled,
  };
}

/** Process-only path for tests without lock (not exported for production). */
export function buildIncrementalPreview(rows: Record<string, unknown>[]) {
  return processCrmRows(rows);
}

export { serializeFactKey, buildNetFactDeltas };
