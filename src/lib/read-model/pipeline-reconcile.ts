import { withClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { parseCrmDate } from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import {
  getSyncState,
  tryAcquireSyncLock,
  releaseStaleSyncLock,
  isSyncRunning,
  pollUntilSyncReleased,
  releaseSyncLock,
} from '@/lib/read-model/lock';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { hotRowCancelReasonMismatch, repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import { isRealCancelReasonCode } from '@/lib/report/search';
import type { HotRow } from '@/lib/read-model/types';

const PIPELINE_BATCH = Math.max(
  20,
  Number(process.env.SYNC_PIPELINE_RECONCILE_BATCH ?? 400) || 400
);
const TRN_FETCH_CHUNK = Math.max(10, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);

const ACTIVE_PIPELINE_BUCKETS = ['assigned', 'open_unallocated'] as const;

export type PipelineReconcileResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  candidates?: number;
  refreshed?: number;
  rowsUpserted?: number;
};

export function hotRowNeedsCrmRefresh(
  hot: Pick<
    HotRow,
    'status_bucket' | 'ncancelreason' | 'source_editedon' | 'bsolved' | 'bfastclose' | 'region'
  >,
  crmRow: Record<string, unknown>
): boolean {
  const crmEdited = parseCrmDate(crmRow.editedon) ?? parseCrmDate(crmRow.addedon);
  const hotEdited = hot.source_editedon;
  if (crmEdited && !hotEdited) return true;
  if (crmEdited && hotEdited && crmEdited.getTime() > hotEdited.getTime()) return true;

  const fresh = transformCrmRowToHot(crmRow);
  if (!fresh) {
    return hot.status_bucket !== 'cancelled';
  }
  if (!String(hot.region ?? '').trim()) return true;
  if (fresh.region !== hot.region) return true;
  if (fresh.status_bucket !== hot.status_bucket) return true;
  if (Number(hot.ncancelreason ?? 0) !== Number(fresh.ncancelreason ?? 0)) return true;
  if (Boolean(hot.bsolved) !== Boolean(fresh.bsolved)) return true;
  if (Boolean(hot.bfastclose) !== Boolean(fresh.bfastclose)) return true;
  if (hotRowCancelReasonMismatch(hot)) return true;
  if (isRealCancelReasonCode(crmRow.ncancelreason) && fresh?.status_bucket === 'cancelled' && hot.status_bucket !== 'cancelled') {
    return true;
  }

  return false;
}

async function listPipelineReconcileCandidates(limit: number): Promise<HotRow[]> {
  const ytdStart = registerHotRetentionStart();
  return withClient(async (client) => {
    const res = await client.query<HotRow>(
      `
      SELECT h.vtrnno, h.status_bucket, h.ncancelreason, h.source_editedon,
             h.bsolved, h.bfastclose, h.synced_at, h.region
      FROM calls_latest_hot h
      CROSS JOIN LATERAL (
        SELECT last_editedon FROM sync_state WHERE entity = 'calls_latest_hot' LIMIT 1
      ) s
      WHERE h.status_bucket = ANY($1::status_bucket_type[])
        AND h.logged_at >= $2::timestamptz
      ORDER BY
        (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon) DESC,
        h.synced_at ASC NULLS FIRST,
        h.vtrnno ASC
      LIMIT $3
      `,
      [ACTIVE_PIPELINE_BUCKETS, `${ytdStart}T00:00:00`, limit]
    );
    return res.rows;
  });
}

/** Re-fetch active pipeline TRNs from CRM and upsert when hot row is stale. */
export async function runPipelineReconcile(): Promise<PipelineReconcileResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }
  if (process.env.SYNC_PIPELINE_RECONCILE_ENABLED === 'false') {
    return { ok: true, skipped: true, reason: 'SYNC_PIPELINE_RECONCILE_ENABLED=false' };
  }

  await withClient((client) => releaseStaleSyncLock(client));

  if (await withClient((client) => isSyncRunning(client))) {
    const released = await pollUntilSyncReleased(() => withClient((client) => isSyncRunning(client)));
    if (!released) {
      return { ok: false, skipped: true, reason: 'sync lock held' };
    }
  }

  const candidates = await listPipelineReconcileCandidates(PIPELINE_BATCH);
  if (!candidates.length) {
    return { ok: true, skipped: true, reason: 'no pipeline candidates', candidates: 0 };
  }

  const trns = candidates.map((row) => row.vtrnno);
  const hotByTrn = new Map(candidates.map((row) => [row.vtrnno, row]));
  const staleTrns: string[] = [];

  for (let i = 0; i < trns.length; i += TRN_FETCH_CHUNK) {
    const chunk = trns.slice(i, i + TRN_FETCH_CHUNK);
    const crmRows = await fetchCrmRowsByTrns(chunk);
    const crmByTrn = new Map<string, Record<string, unknown>>();
    for (const row of crmRows) {
      const trn = String(row.vtrnno ?? '').trim();
      if (trn) crmByTrn.set(trn, row);
    }
    for (const trn of chunk) {
      const hot = hotByTrn.get(trn);
      const crm = crmByTrn.get(trn);
      if (!hot || !crm) continue;
      if (hotRowNeedsCrmRefresh(hot, crm)) staleTrns.push(trn);
    }
  }

  if (!staleTrns.length) {
    return {
      ok: true,
      candidates: candidates.length,
      refreshed: 0,
      rowsUpserted: 0,
    };
  }

  const crmRows = await fetchCrmRowsByTrns(staleTrns);
  const result = await withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      return { kind: 'skipped' as const, reason: 'lock not acquired' };
    }
    const state = await getSyncState(client);
    const applied = await applyCrmRowsToHot(client, crmRows, {
      state,
      advanceWatermarks: false,
    });
    await releaseSyncLock(client, 'ok', applied.rowsUpserted);
    return { kind: 'applied' as const, ...applied };
  });

  if (result.kind === 'skipped') {
    return { ok: false, skipped: true, reason: result.reason };
  }

  console.log(
    `[sync-worker] Pipeline reconcile — checked ${candidates.length}, refreshed ${staleTrns.length}, upserted ${result.rowsUpserted}`
  );

  return {
    ok: true,
    candidates: candidates.length,
    refreshed: staleTrns.length,
    rowsUpserted: result.rowsUpserted,
  };
}
