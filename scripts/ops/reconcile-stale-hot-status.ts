/**
 * Audit + optional bulk refresh: hot pipeline rows whose CRM status differs.
 * Applies fixes per batch (no long scan-then-apply wait).
 *
 *   npx tsx scripts/ops/reconcile-stale-hot-status.ts           # audit only
 *   npx tsx scripts/ops/reconcile-stale-hot-status.ts --apply   # refresh stale TRNs from CRM
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock, releaseStaleSyncLock } from '@/lib/read-model/lock';
import { hotRowNeedsReconcileFromCrm } from '@/lib/read-model/pipeline-reconcile';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import type { HotRow } from '@/lib/read-model/types';

const APPLY = process.argv.includes('--apply');
const BATCH = Math.max(20, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);
const SCAN_LIMIT = Math.max(100, Number(process.env.RECONCILE_STALE_SCAN ?? 800) || 800);
const MAX_REFRESH = Math.max(100, Number(process.env.RECONCILE_STALE_MAX ?? 2000) || 2000);

async function listCandidates(client: import('pg').PoolClient, ytdStart: string) {
  const res = await client.query<HotRow>(
    `
    SELECT h.vtrnno, h.status_bucket, h.ncancelreason, h.source_editedon,
           h.bsolved, h.bfastclose, h.synced_at, h.region
    FROM calls_latest_hot h
    CROSS JOIN LATERAL (
      SELECT last_editedon FROM sync_state WHERE entity = 'calls_latest_hot' LIMIT 1
    ) s
    WHERE h.status_bucket IN ('assigned', 'open_unallocated', 'tech_solved')
      AND h.logged_at >= $1::timestamptz
      AND (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon)
    ORDER BY h.synced_at ASC NULLS FIRST, h.vtrnno ASC
    LIMIT $2
    `,
    [`${ytdStart}T00:00:00`, SCAN_LIMIT]
  );
  return res.rows;
}

async function main() {
  await withAppClient((client) => releaseStaleSyncLock(client));
  const ytdStart = registerHotRetentionStart();
  const candidates = await withAppClient((client) => listCandidates(client, ytdStart));
  console.log(`Behind-watermark pipeline candidates: ${candidates.length}`);

  let staleFound = 0;
  let upserted = 0;
  let deleted = 0;
  const batches = Math.ceil(Math.min(candidates.length, MAX_REFRESH) / BATCH);

  for (let i = 0; i < candidates.length && staleFound < MAX_REFRESH; i += BATCH) {
    const batchIdx = i / BATCH + 1;
    const chunk = candidates.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno), { includeTransferred: true });
    const crmByTrn = new Map<string, Record<string, unknown>>();
    for (const row of crmRows) {
      const trn = String(row.vtrnno ?? '').trim();
      if (trn) crmByTrn.set(trn, row);
    }

    const staleCrmRows: Record<string, unknown>[] = [];
    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) {
        if (staleFound < 20) {
          console.log(`  no CRM row: ${hot.vtrnno} (${hot.status_bucket})`);
        }
        continue;
      }
      if (hotRowNeedsReconcileFromCrm(hot, crm)) {
        staleFound++;
        staleCrmRows.push(crm);
        if (staleFound <= 15) {
          console.log(
            `  stale: ${hot.vtrnno} hot=${hot.status_bucket}/ncr=${hot.ncancelreason ?? 0} crm_ncr=${String(crm.ncancelreason ?? '')}`
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
          deleted += result.rowsDeleted;
        } catch (err) {
          await releaseSyncLock(client, 'error', 0);
          throw err;
        }
      });
      console.log(
        `  batch ${batchIdx}/${batches}: fixed ${staleCrmRows.length} (total stale ${staleFound}, upserted ${upserted})`
      );
    }
  }

  console.log(`Stale vs CRM: ${staleFound}`);
  if (!APPLY && staleFound > 0) {
    console.log('Run with --apply to refresh from CRM');
    return;
  }
  if (APPLY) {
    console.log(`Done — upserted ${upserted}, deleted ${deleted}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
