import { withAppClient, withClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
import { hotRowNeedsReconcileFromCrm } from '@/lib/read-model/pipeline-reconcile';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import type { HotRow } from '@/lib/read-model/types';

const BATCH = Math.max(20, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);
const PROGRESS_EVERY = 20;

export type ReconcileYtdOpenResult = {
  ok: boolean;
  ytdStart: string;
  checked: number;
  stale: number;
  rowsUpserted: number;
  rowsDeleted: number;
  ncrRepaired: number;
};

/** Full YTD scan: every open/assigned hot row vs live CRM (incl. transferred). */
export async function runReconcileYtdOpen(opts?: {
  apply?: boolean;
  ytdStart?: string;
  onProgress?: (message: string) => void;
}): Promise<ReconcileYtdOpenResult> {
  const apply = opts?.apply ?? false;
  const ytdStart = opts?.ytdStart ?? process.env.RECONCILE_YTD_FROM ?? registerHotRetentionStart();
  const log = opts?.onProgress ?? ((msg: string) => console.log(msg));

  let ncrRepaired = 0;
  if (apply) {
    ncrRepaired = await withClient((client) => repairHotCancelFromNcrReason(client));
    if (ncrRepaired > 0) log(`SQL repair (ncr set, status open): ${ncrRepaired} row(s)`);
  }

  const candidates = await withAppClient(async (client) => {
    const res = await client.query<HotRow>(
      `SELECT vtrnno, status_bucket, ncancelreason, source_editedon,
              bsolved, bfastclose, synced_at, region
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket IN ('assigned', 'open_unallocated')
       ORDER BY vtrnno`,
      [`${ytdStart}T00:00:00`]
    );
    return res.rows;
  });

  log(`YTD open/assigned (${ytdStart}+): ${candidates.length}`);
  if (!candidates.length) {
    return {
      ok: true,
      ytdStart,
      checked: 0,
      stale: 0,
      rowsUpserted: 0,
      rowsDeleted: 0,
      ncrRepaired,
    };
  }

  let staleFound = 0;
  let rowsUpserted = 0;
  let rowsDeleted = 0;
  const batches = Math.ceil(candidates.length / BATCH);

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batchIdx = i / BATCH + 1;
    const chunk = candidates.slice(i, i + BATCH);

    let crmRows: Record<string, unknown>[] = [];
    try {
      crmRows = await fetchCrmRowsByTrns(
        chunk.map((r) => r.vtrnno),
        { includeTransferred: true }
      );
    } catch (err) {
      log(
        `  batch ${batchIdx} CRM fetch failed: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));
    const staleCrmRows: Record<string, unknown>[] = [];

    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) continue;
      if (hotRowNeedsReconcileFromCrm(hot, crm)) {
        staleFound++;
        staleCrmRows.push(crm);
        if (staleFound <= 15) {
          log(
            `  stale: ${hot.vtrnno} hot=${hot.status_bucket}/ncr=${hot.ncancelreason ?? 0} crm_ncr=${crm.ncancelreason}`
          );
        }
      }
    }

    if (apply && staleCrmRows.length) {
      await withAppClient(async (client) => {
        if (!(await tryAcquireSyncLock(client))) {
          throw new Error('sync lock not acquired');
        }
        try {
          const state = await getSyncState(client);
          const result = await applyCrmRowsToHot(client, staleCrmRows, {
            state,
            advanceWatermarks: false,
          });
          await releaseSyncLock(client, 'ok', result.rowsUpserted);
          rowsUpserted += result.rowsUpserted;
          rowsDeleted += result.rowsDeleted;
        } catch (err) {
          await releaseSyncLock(client, 'error', 0);
          throw err;
        }
      });
    }

    if (batchIdx % PROGRESS_EVERY === 0 || batchIdx === batches) {
      log(
        `  … batch ${batchIdx}/${batches} — stale ${staleFound}${
          apply ? `, upserted ${rowsUpserted}, deleted ${rowsDeleted}` : ''
        }`
      );
    }
  }

  if (apply) {
    const postNcr = await withClient((client) => repairHotCancelFromNcrReason(client));
    if (postNcr > 0) {
      log(`Post SQL repair: ${postNcr} row(s)`);
      ncrRepaired += postNcr;
    }
  }

  log('\n=== YTD reconcile ===');
  log(`Checked:   ${candidates.length}`);
  log(`Stale:     ${staleFound}`);
  if (apply) {
    log(`Upserted:  ${rowsUpserted}`);
    log(`Deleted:   ${rowsDeleted}`);
  } else if (staleFound > 0) {
    log('Run with --apply to refresh stale TRNs from CRM');
  }

  return {
    ok: true,
    ytdStart,
    checked: candidates.length,
    stale: staleFound,
    rowsUpserted,
    rowsDeleted,
    ncrRepaired,
  };
}
