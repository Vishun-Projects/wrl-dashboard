import { prisma } from '@/lib/db/prisma';
import { releaseStaleArcpSyncLock } from '@/lib/read-model/arcp/lock';
import { arcpBackfillStartDate } from '@/lib/read-model/arcp/dates';
import { withClient } from '@/lib/read-model/db';
import { releaseStaleSyncLock } from '@/lib/read-model/lock';
import { repairStaleIngestBatches } from '@/lib/read-model/batches';
import type { ArcpPostgresCoverage } from '@/lib/read-model/arcp/coverage-shared';
import {
  readDimsFromPostgres,
  readArcpFromPostgres,
  readDistributionFromPostgres,
  readRegisterFromPostgres,
  readSummaryFromPostgres,
} from '@/lib/read-model/flags';

/** Target row count for calls_latest_hot backfill progress. */
export const HOT_TARGET_ROWS = 139_509;

export type SyncMeta = {
  lastSyncedAt: string | null;
  status: string | null;
  lagMinutes: number | null;
};

export type ReadModelProgress = {
  generatedAt: string;
  hot: {
    count: number;
    target: number;
    percent: number;
  };
  facts: {
    grainCount: number;
    ytdCallEstimate: number | null;
  };
  dimensions: {
    offices: number;
    engineers: number;
    callTypes: number;
  };
  syncState: Array<{
    entity: string;
    status: string | null;
    isRunning: boolean;
    lastRunAt: string | null;
    lastEditedon: string | null;
    rowsUpsertedLast: number;
  }>;
  recentRuns: Array<{
    id: number;
    entity: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    rowsUpserted: number;
    rowsDeleted: number;
    errorMessage: string | null;
  }>;
  recentBatches: Array<{
    batchId: string;
    entity: string;
    status: string;
    watermarkStart: string | null;
    watermarkEnd: string | null;
    rowCount: number;
    createdAt: string;
  }>;
  appFlags: {
    summary: string;
    register: string;
    distribution: string;
    dims: string;
    arcp: string;
  };
  phase: 'pending_backfill' | 'backfilling' | 'ready' | 'error' | 'syncing';
  message: string;
  arcp: ArcpPostgresCoverage | null;
};

export async function getSyncMeta(): Promise<SyncMeta> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ last_run_at: Date | null; status: string | null }>
  >(`SELECT last_run_at, status FROM sync_state WHERE entity = 'calls_latest_hot' LIMIT 1`);

  const row = rows[0];
  const lastSyncedAt = row?.last_run_at ? new Date(row.last_run_at).toISOString() : null;
  const lagMinutes =
    row?.last_run_at != null
      ? Math.max(0, Math.round((Date.now() - new Date(row.last_run_at).getTime()) / 60000))
      : null;

  return {
    lastSyncedAt,
    status: row?.status ?? null,
    lagMinutes,
  };
}

export async function getHotRowCount(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COALESCE(n_live_tup, 0)::int AS count FROM pg_stat_user_tables WHERE relname = 'calls_latest_hot'`
  );
  const estimate = rows[0]?.count ?? 0;
  if (estimate > 0) return estimate;

  const exact = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM calls_latest_hot`
  );
  return exact[0]?.count ?? 0;
}

const PROGRESS_CACHE_MS = Number(process.env.READ_MODEL_PROGRESS_CACHE_MS ?? 45_000) || 45_000;
let progressCache: { at: number; data: ReadModelProgress } | null = null;

function arcpDateYmd(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadReadModelProgressUncached(): Promise<ReadModelProgress> {
  /** One pool checkout — remote DB round-trips dominate on Vercel. */
  const {
    hotCount,
    factGrains,
    dims,
    syncStates,
    runs,
    batches,
    arcp,
  } = await withClient(async (client) => {
    await releaseStaleSyncLock(client);
    await releaseStaleArcpSyncLock(client);
    await repairStaleIngestBatches(client);

    const hotEst = await client.query<{ count: number }>(
      `SELECT COALESCE(n_live_tup, 0)::int AS count FROM pg_stat_user_tables WHERE relname = 'calls_latest_hot'`
    );
    let hotCount = hotEst.rows[0]?.count ?? 0;
    if (hotCount <= 0) {
      const exact = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM calls_latest_hot`
      );
      hotCount = exact.rows[0]?.count ?? 0;
    }

    const factGrains = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM call_metrics_daily`
    );
    const dims = await client.query<{ offices: number; engineers: number; call_types: number }>(`
      SELECT
        (SELECT count(*)::int FROM dim_offices) AS offices,
        (SELECT count(*)::int FROM dim_engineers) AS engineers,
        (SELECT count(*)::int FROM dim_call_types) AS call_types
    `);
    const syncStates = await client.query<{
      entity: string;
      status: string | null;
      is_running: boolean;
      last_run_at: Date | null;
      last_editedon: Date | null;
      rows_upserted_last: number;
    }>(`SELECT * FROM sync_state ORDER BY entity`);
    const runs = await client.query<{
      id: number;
      entity: string;
      status: string;
      started_at: Date;
      finished_at: Date | null;
      duration_ms: number | null;
      rows_upserted: number;
      rows_deleted: number;
      error_message: string | null;
    }>(`SELECT * FROM sync_run_log ORDER BY started_at DESC LIMIT 10`);
    const batches = await client.query<{
      batch_id: string;
      entity: string;
      status: string;
      watermark_start: Date | null;
      watermark_end: Date | null;
      row_count: number;
      created_at: Date;
    }>(`SELECT * FROM raw_ingest_batches ORDER BY created_at DESC LIMIT 10`);

    let arcp: ArcpPostgresCoverage | null = null;
    try {
      const arcpState = await client.query<{ status: string | null }>(
        `SELECT status FROM sync_state WHERE entity = 'arcp_lines_hot' LIMIT 1`
      );
      const bounds = await client.query<{
        row_count: number;
        min_call: Date | null;
        max_call: Date | null;
        min_solve: Date | null;
        max_solve: Date | null;
        min_bm: Date | null;
        max_bm: Date | null;
        min_ho: Date | null;
        max_ho: Date | null;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM arcp_lines_hot) AS row_count,
          (SELECT MIN(call_at) FROM arcp_lines_hot WHERE call_at IS NOT NULL) AS min_call,
          (SELECT MAX(call_at) FROM arcp_lines_hot WHERE call_at IS NOT NULL) AS max_call,
          (SELECT MIN(solve_at) FROM arcp_lines_hot WHERE solve_at IS NOT NULL) AS min_solve,
          (SELECT MAX(solve_at) FROM arcp_lines_hot WHERE solve_at IS NOT NULL) AS max_solve,
          (SELECT MIN(bm_approved_at) FROM arcp_lines_hot WHERE bm_approved_at IS NOT NULL) AS min_bm,
          (SELECT MAX(bm_approved_at) FROM arcp_lines_hot WHERE bm_approved_at IS NOT NULL) AS max_bm,
          (SELECT MIN(ho_approved_at) FROM arcp_lines_hot WHERE ho_approved_at IS NOT NULL) AS min_ho,
          (SELECT MAX(ho_approved_at) FROM arcp_lines_hot WHERE ho_approved_at IS NOT NULL) AS max_ho
      `);
      const row = bounds.rows[0] ?? {};
      arcp = {
        rowCount: Number(row.row_count ?? 0),
        status: arcpState.rows[0]?.status ?? null,
        backfillStart: arcpBackfillStartDate(),
        callAt: { min: arcpDateYmd(row.min_call), max: arcpDateYmd(row.max_call) },
        solveAt: { min: arcpDateYmd(row.min_solve), max: arcpDateYmd(row.max_solve) },
        bmApprovedAt: { min: arcpDateYmd(row.min_bm), max: arcpDateYmd(row.max_bm) },
        hoApprovedAt: { min: arcpDateYmd(row.min_ho), max: arcpDateYmd(row.max_ho) },
      };
    } catch {
      arcp = null;
    }

    return {
      hotCount,
      factGrains: factGrains.rows,
      dims: dims.rows,
      syncStates: syncStates.rows,
      runs: runs.rows,
      batches: batches.rows,
      arcp,
    };
  });

  const hotState = syncStates.find((s) => s.entity === 'calls_latest_hot');
  const arcpState = syncStates.find((s) => s.entity === 'arcp_lines_hot');
  const callsRunning = hotState?.is_running === true;
  const arcpRunning = arcpState?.is_running === true;
  const hotStatus = hotState?.status ?? 'unknown';
  const dimPending = syncStates.filter(
    (s) => s.entity.startsWith('dim_') && s.status === 'pending_backfill'
  );

  let phase: ReadModelProgress['phase'] = 'pending_backfill';
  let message = 'Waiting for initial backfill to start.';

  if (hotStatus === 'error') {
    phase = 'error';
    message = 'Sync worker reported an error. Check recent runs below.';
  } else if (callsRunning && hotStatus === 'ok' && hotCount >= HOT_TARGET_ROWS * 0.95) {
    phase = 'syncing';
    message = 'Call register incremental sync in progress.';
  } else if (arcpRunning && !callsRunning) {
    phase = 'syncing';
    message = 'ARCP sync in progress — call register remains available.';
  } else if (hotStatus === 'ok' && hotCount >= HOT_TARGET_ROWS * 0.95) {
    phase = 'ready';
    message = 'Backfill complete. Start the incremental sync service when ready.';
    if (dimPending.length > 0) {
      message += ` Dimension sync_state still pending for ${dimPending.map((d) => d.entity).join(', ')}.`;
    }
  } else if (callsRunning || arcpRunning || hotCount > 0) {
    phase = 'backfilling';
    message = 'Initial data load in progress. This can take several hours.';
  } else if (hotStatus === 'pending_backfill') {
    phase = 'pending_backfill';
    message = 'Initial backfill has not started — contact your administrator.';
  } else if (callsRunning || arcpRunning) {
    phase = 'syncing';
    message = 'Sync worker is running.';
  }

  const percent = Math.min(100, Math.round((hotCount / HOT_TARGET_ROWS) * 1000) / 10);

  return {
    generatedAt: new Date().toISOString(),
    hot: {
      count: hotCount,
      target: HOT_TARGET_ROWS,
      percent,
    },
    facts: {
      grainCount: factGrains[0]?.count ?? 0,
      ytdCallEstimate: null,
    },
    dimensions: {
      offices: dims[0]?.offices ?? 0,
      engineers: dims[0]?.engineers ?? 0,
      callTypes: dims[0]?.call_types ?? 0,
    },
    syncState: syncStates.map((row) => ({
      entity: row.entity,
      status: row.status,
      isRunning: row.is_running,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      lastEditedon: row.last_editedon ? new Date(row.last_editedon).toISOString() : null,
      rowsUpsertedLast: row.rows_upserted_last ?? 0,
    })),
    recentRuns: runs.map((row) => ({
      id: row.id,
      entity: row.entity,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      durationMs: row.duration_ms,
      rowsUpserted: row.rows_upserted ?? 0,
      rowsDeleted: row.rows_deleted ?? 0,
      errorMessage: row.error_message,
    })),
    recentBatches: batches.map((row) => ({
      batchId: row.batch_id,
      entity: row.entity,
      status: row.status,
      watermarkStart: row.watermark_start ? new Date(row.watermark_start).toISOString() : null,
      watermarkEnd: row.watermark_end ? new Date(row.watermark_end).toISOString() : null,
      rowCount: row.row_count ?? 0,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    appFlags: {
      summary: readSummaryFromPostgres() ? 'postgres' : 'crm',
      register: readRegisterFromPostgres() ? 'postgres' : 'crm',
      distribution: readDistributionFromPostgres() ? 'postgres' : 'crm',
      dims: readDimsFromPostgres() ? 'postgres' : 'crm',
      arcp: readArcpFromPostgres() ? 'postgres' : 'crm',
    },
    phase,
    message,
    arcp,
  };
}

export async function getReadModelProgress(options?: { fresh?: boolean }): Promise<ReadModelProgress> {
  if (!options?.fresh && progressCache && Date.now() - progressCache.at < PROGRESS_CACHE_MS) {
    return progressCache.data;
  }
  const data = await loadReadModelProgressUncached();
  progressCache = { at: Date.now(), data };
  return data;
}

export function invalidateReadModelProgressCache(): void {
  progressCache = null;
}
