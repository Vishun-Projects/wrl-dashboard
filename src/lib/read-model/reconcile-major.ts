import { withClient } from '@/lib/read-model/db';
import {
  fetchCrmRowsByTrns,
  fetchCrmTrnsWithRecentFaultEdits,
} from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import {
  getSyncState,
  tryAcquireSyncLock,
  releaseStaleSyncLock,
  isSyncRunning,
  pollUntilSyncReleased,
  releaseSyncLock,
} from '@/lib/read-model/lock';
import { hotRowNeedsReconcileFromCrm } from '@/lib/read-model/pipeline-reconcile';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import { deleteHotRowsByTrn, fetchHotRowsByTrn } from '@/lib/read-model/upsert-hot';
import type { HotRow } from '@/lib/read-model/types';

const MAJOR_BATCH = Math.max(
  50,
  Number(process.env.SYNC_MAJOR_RECONCILE_PER_RUN ?? 800) || 800
);
const FAULT_LOOKBACK_HOURS = Math.max(
  1,
  Number(process.env.SYNC_FAULT_EDIT_LOOKBACK_HOURS ?? 48) || 48
);
const TRN_CHUNK = Math.max(10, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);

const OPEN_BUCKETS = ['assigned', 'open_unallocated', 'tech_solved'] as const;

export type MajorReconcileResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  candidates?: number;
  refreshed?: number;
  rowsUpserted?: number;
  rowsDeleted?: number;
};

function faultEditSinceIso(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - FAULT_LOOKBACK_HOURS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${mi}:${s}`;
}

/**
 * Rotate through YTD open-pipeline TRNs (oldest synced_at first) plus recent fault edits,
 * and refresh when CRM is_major / status differs.
 */
export async function runReconcileMajor(): Promise<MajorReconcileResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }
  if (process.env.SYNC_MAJOR_RECONCILE_ENABLED === 'false') {
    return { ok: true, skipped: true, reason: 'SYNC_MAJOR_RECONCILE_ENABLED=false' };
  }

  await withClient((client) => releaseStaleSyncLock(client));
  if (await withClient((client) => isSyncRunning(client))) {
    const released = await pollUntilSyncReleased(() => withClient((c) => isSyncRunning(c)));
    if (!released) {
      return { ok: false, skipped: true, reason: 'sync lock held' };
    }
  }

  const ytdStart = registerHotRetentionStart();
  const rotating = await withClient(async (client) => {
    const res = await client.query<HotRow>(
      `SELECT vtrnno, status_bucket, ncancelreason, source_editedon,
              bsolved, bfastclose, region, is_major, nengineer, synced_at
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket = ANY($2::status_bucket_type[])
       ORDER BY synced_at ASC NULLS FIRST, vtrnno ASC
       LIMIT $3`,
      [`${ytdStart}T00:00:00`, OPEN_BUCKETS, MAJOR_BATCH]
    );
    return res.rows;
  });

  let faultTrns: string[] = [];
  try {
    faultTrns = await fetchCrmTrnsWithRecentFaultEdits(faultEditSinceIso(), MAJOR_BATCH);
  } catch (err) {
    console.warn(
      '[sync-worker] Major reconcile — fault-edit TRN fetch failed:',
      err instanceof Error ? err.message : err
    );
  }

  const byTrn = new Map(rotating.map((r) => [r.vtrnno, r]));
  const missingFault = faultTrns.filter((t) => !byTrn.has(t));
  if (missingFault.length) {
    const extra = await withClient((client) => fetchHotRowsByTrn(client, missingFault));
    for (const row of extra) byTrn.set(row.vtrnno, row);
  }

  const candidates = [...byTrn.values()];
  if (!candidates.length && !faultTrns.length) {
    return { ok: true, skipped: true, reason: 'no major reconcile candidates', candidates: 0 };
  }

  const hotByTrn = byTrn;
  const checkTrns = [...new Set([...candidates.map((r) => r.vtrnno), ...faultTrns])].slice(
    0,
    MAJOR_BATCH + Math.min(faultTrns.length, MAJOR_BATCH)
  );

  const staleTrns: string[] = [];
  const orphanTrns: string[] = [];
  const faultSet = new Set(faultTrns);

  for (let i = 0; i < checkTrns.length; i += TRN_CHUNK) {
    const chunk = checkTrns.slice(i, i + TRN_CHUNK);
    const crmRows = await fetchCrmRowsByTrns(chunk, { includeTransferred: true });
    const crmByTrn = new Map<string, Record<string, unknown>>();
    for (const row of crmRows) {
      const trn = String(row.vtrnno ?? '').trim();
      if (trn) crmByTrn.set(trn, row);
    }
    for (const trn of chunk) {
      const hot = hotByTrn.get(trn);
      const crm = crmByTrn.get(trn);
      if (!crm) {
        if (hot) orphanTrns.push(trn);
        continue;
      }
      if (!hot) {
        staleTrns.push(trn);
        continue;
      }
      const fresh = transformCrmRowToHot(crm);
      const majorDrift =
        fresh != null && Boolean(hot.is_major) !== Boolean(fresh.is_major);
      if (majorDrift || hotRowNeedsReconcileFromCrm(hot, crm) || faultSet.has(trn)) {
        staleTrns.push(trn);
      }
    }
  }

  if (!staleTrns.length && !orphanTrns.length) {
    return {
      ok: true,
      candidates: checkTrns.length,
      refreshed: 0,
      rowsUpserted: 0,
      rowsDeleted: 0,
    };
  }

  const crmRows = staleTrns.length
    ? await fetchCrmRowsByTrns(staleTrns, { includeTransferred: true })
    : [];

  const result = await withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      return { kind: 'skipped' as const, reason: 'lock not acquired' };
    }
    try {
      const state = await getSyncState(client);
      let rowsUpserted = 0;
      let rowsDeleted = 0;
      if (crmRows.length) {
        const applied = await applyCrmRowsToHot(client, crmRows, {
          state,
          advanceWatermarks: false,
        });
        rowsUpserted = applied.rowsUpserted;
        rowsDeleted = applied.rowsDeleted;
      }
      if (orphanTrns.length) {
        rowsDeleted += await deleteHotRowsByTrn(client, orphanTrns);
      }
      await releaseSyncLock(client, 'ok', rowsUpserted);
      return { kind: 'applied' as const, rowsUpserted, rowsDeleted };
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });

  if (result.kind === 'skipped') {
    return { ok: false, skipped: true, reason: result.reason };
  }

  console.log(
    `[sync-worker] Major reconcile — checked ${checkTrns.length} (fault-edits ${faultTrns.length}), refreshed ${staleTrns.length}, orphans ${orphanTrns.length}, upserted ${result.rowsUpserted}, deleted ${result.rowsDeleted}`
  );

  return {
    ok: true,
    candidates: checkTrns.length,
    refreshed: staleTrns.length + orphanTrns.length,
    rowsUpserted: result.rowsUpserted,
    rowsDeleted: result.rowsDeleted,
  };
}
