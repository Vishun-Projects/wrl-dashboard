import { withAppClient, withClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import {
  getSyncState,
  tryAcquireSyncLock,
  releaseSyncLock,
  releaseStaleSyncLock,
} from '@/lib/read-model/lock';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import { hotRowNeedsReconcileFromCrm } from '@/lib/read-model/pipeline-reconcile';
import { classifyRegisterRowStatus } from '@/lib/call/status/register-row';
import type { HotRow } from '@/lib/read-model/types';

const CHUNK = Math.max(20, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);

export type ReconcileOpenCancelResult = {
  checked: number;
  stale: number;
  rowsUpserted: number;
};

/** Refresh open/assigned hot rows whose live CRM status is cancelled (or otherwise drifted). */
export async function reconcileOpenCancelDriftFromCrm(
  opts?: { callType?: string }
): Promise<ReconcileOpenCancelResult> {
  await withClient((client) => releaseStaleSyncLock(client));

  const callType = opts?.callType ?? 'Breakdown';
  const openRows = await withAppClient(async (client) => {
    const res = await client.query<HotRow>(
      `
      SELECT h.vtrnno, h.status_bucket, h.ncancelreason, h.source_editedon,
             h.bsolved, h.bfastclose, h.synced_at, h.region, h.is_major, h.nengineer
      FROM calls_latest_hot h
      WHERE h.status_bucket IN ('assigned', 'open_unallocated')
        AND normalize_call_type(h.call_type) = normalize_call_type($1)
      ORDER BY h.vtrnno
      `,
      [callType]
    );
    return res.rows;
  });

  const staleCrmRows: Record<string, unknown>[] = [];
  for (let i = 0; i < openRows.length; i += CHUNK) {
    const chunk = openRows.slice(i, i + CHUNK);
    const crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno), {
      includeTransferred: true,
    });
    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));
    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) continue;
      if (classifyRegisterRowStatus(crm) === 'cancelled' || hotRowNeedsReconcileFromCrm(hot, crm)) {
        staleCrmRows.push(crm);
      }
    }
  }

  if (!staleCrmRows.length) {
    return { checked: openRows.length, stale: 0, rowsUpserted: 0 };
  }

  const rowsUpserted = await withAppClient(async (client) => {
    if (!(await tryAcquireSyncLock(client))) {
      console.warn('[mis-email] reconcileOpenCancelDriftFromCrm — sync lock held, skipping write');
      return 0;
    }
    try {
      const state = await getSyncState(client);
      const applied = await applyCrmRowsToHot(client, staleCrmRows, {
        state,
        advanceWatermarks: false,
      });
      await repairHotCancelFromNcrReason(client);
      await releaseSyncLock(client, 'ok', applied.rowsUpserted);
      return applied.rowsUpserted;
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });

  console.log(
    `[read-model] reconcileOpenCancelDriftFromCrm — checked ${openRows.length}, stale ${staleCrmRows.length}, upserted ${rowsUpserted}`
  );

  return { checked: openRows.length, stale: staleCrmRows.length, rowsUpserted };
}
