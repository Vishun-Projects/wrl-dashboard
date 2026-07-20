import { withAppClient, withClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock, releaseStaleSyncLock } from '@/lib/read-model/lock';
import { hotRowNeedsReconcileFromCrm } from '@/lib/read-model/pipeline-reconcile';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import type { HotRow } from '@/lib/read-model/types';

const BATCH = Math.max(20, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);
const PROGRESS_EVERY = 5;
const DEFAULT_LIMIT = Math.max(100, Number(process.env.RECONCILE_TECH_SOLVED_LIMIT ?? 15000) || 15000);

export type ReconcileTechSolvedResult = {
  ok: boolean;
  checked: number;
  stale: number;
  rowsUpserted: number;
  rowsDeleted: number;
};

/** Refresh tech_solved hot rows whose CRM status moved on (closed, cancelled, etc.). */
export async function runReconcileTechSolved(opts?: {
  apply?: boolean;
  limit?: number;
  onProgress?: (message: string) => void;
}): Promise<ReconcileTechSolvedResult> {
  const apply = opts?.apply ?? false;
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const ytdStart = registerHotRetentionStart();
  const log = opts?.onProgress ?? ((msg: string) => console.log(msg));

  await withClient((client) => releaseStaleSyncLock(client));

  const candidates = await withAppClient(async (client) => {
    const res = await client.query<HotRow>(
      `
      SELECT h.vtrnno, h.status_bucket, h.ncancelreason, h.source_editedon,
             h.bsolved, h.bfastclose, h.synced_at, h.region
      FROM calls_latest_hot h
      CROSS JOIN LATERAL (
        SELECT last_editedon FROM sync_state WHERE entity = 'calls_latest_hot' LIMIT 1
      ) s
      WHERE h.status_bucket = 'tech_solved'
        AND h.logged_at >= $1::timestamptz
      ORDER BY
        (h.bsolved IS NOT TRUE) DESC,
        (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon) DESC,
        h.synced_at ASC NULLS FIRST,
        h.vtrnno ASC
      LIMIT $2
      `,
      [`${ytdStart}T00:00:00`, limit]
    );
    return res.rows;
  });

  log(`tech_solved candidates (${ytdStart}+): ${candidates.length}`);
  if (!candidates.length) {
    return { ok: true, checked: 0, stale: 0, rowsUpserted: 0, rowsDeleted: 0 };
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
      log(`  batch ${batchIdx} CRM fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const crmByTrn = new Map<string, Record<string, unknown>>();
    for (const row of crmRows) {
      const trn = String(row.vtrnno ?? '').trim();
      if (trn) crmByTrn.set(trn, row);
    }

    const staleCrmRows: Record<string, unknown>[] = [];
    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) continue;
      if (hotRowNeedsReconcileFromCrm(hot, crm)) {
        staleFound++;
        staleCrmRows.push(crm);
        if (staleFound <= 15) {
          log(`  stale: ${hot.vtrnno} hot=${hot.status_bucket} bsolved=${hot.bsolved ?? false}`);
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
      log(
        `  batch ${batchIdx}: fixed ${staleCrmRows.length} (total stale ${staleFound}, upserted ${rowsUpserted})`
      );
    }

    if (!apply && batchIdx % PROGRESS_EVERY === 0) {
      log(`  … batch ${batchIdx}/${batches} — stale ${staleFound}`);
    }
  }

  log('\n=== tech_solved reconcile ===');
  log(`Checked:  ${candidates.length}`);
  log(`Stale:    ${staleFound}`);
  if (apply) {
    log(`Upserted: ${rowsUpserted}`);
    log(`Deleted:  ${rowsDeleted}`);
  } else if (staleFound > 0) {
    log('Run with --apply to refresh from CRM');
  }

  return {
    ok: true,
    checked: candidates.length,
    stale: staleFound,
    rowsUpserted,
    rowsDeleted,
  };
}
