/**
 * Scan all YTD open/assigned hot rows vs CRM; optionally refresh stale TRNs.
 *
 *   npx tsx scripts/reconcile-ytd-open-from-crm.ts            # audit
 *   npx tsx scripts/reconcile-ytd-open-from-crm.ts --apply    # fix from CRM
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { withAppClient, withClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
import { hotRowNeedsCrmRefresh } from '@/lib/read-model/pipeline-reconcile';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import type { HotRow } from '@/lib/read-model/types';

const APPLY = process.argv.includes('--apply');
const YTD_START = process.env.RECONCILE_YTD_FROM ?? '2026-01-01';
const BATCH = Math.max(20, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);
const PROGRESS_EVERY = 20;

async function main() {
  if (APPLY) {
    const ncrFixed = await withClient((client) => repairHotCancelFromNcrReason(client));
    if (ncrFixed > 0) console.log(`SQL repair (ncr set, status open): ${ncrFixed} row(s)`);
  }

  const candidates = await withAppClient(async (client) => {
    const res = await client.query<HotRow>(
      `SELECT vtrnno, status_bucket, ncancelreason, source_editedon,
              bsolved, bfastclose, synced_at, region
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket IN ('assigned', 'open_unallocated')
       ORDER BY vtrnno`,
      [`${YTD_START}T00:00:00`]
    );
    return res.rows;
  });

  console.log(`YTD open/assigned (${YTD_START}+): ${candidates.length}`);
  if (!candidates.length) return;

  let staleFound = 0;
  let upserted = 0;
  const batches = Math.ceil(candidates.length / BATCH);

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batchIdx = i / BATCH + 1;
    const chunk = candidates.slice(i, i + BATCH);

    let crmRows: Record<string, unknown>[] = [];
    try {
      crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno));
    } catch (err) {
      console.warn(`  batch ${batchIdx} CRM fetch failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));
    const staleCrmRows: Record<string, unknown>[] = [];

    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) continue;
      if (hotRowNeedsCrmRefresh(hot, crm)) {
        staleFound++;
        staleCrmRows.push(crm);
        if (staleFound <= 15) {
          console.log(
            `  stale: ${hot.vtrnno} hot=${hot.status_bucket}/ncr=${hot.ncancelreason ?? 0} crm_ncr=${crm.ncancelreason}`
          );
        }
      }
    }

    if (APPLY && staleCrmRows.length) {
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
          upserted += result.rowsUpserted;
        } catch (err) {
          await releaseSyncLock(client, 'error', 0);
          throw err;
        }
      });
    }

    if (batchIdx % PROGRESS_EVERY === 0 || batchIdx === batches) {
      console.log(
        `  … batch ${batchIdx}/${batches} — stale ${staleFound}${APPLY ? `, upserted ${upserted}` : ''}`
      );
    }
  }

  console.log('\n=== YTD reconcile ===');
  console.log(`Checked:   ${candidates.length}`);
  console.log(`Stale:     ${staleFound}`);
  if (APPLY) {
    console.log(`Upserted:  ${upserted}`);
    const ncrFixed = await withClient((client) => repairHotCancelFromNcrReason(client));
    if (ncrFixed > 0) console.log(`Post SQL repair: ${ncrFixed} row(s)`);
  } else if (staleFound > 0) {
    console.log('Run with --apply to refresh stale TRNs from CRM');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
