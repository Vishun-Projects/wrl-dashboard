/**
 * Audit + optional bulk refresh: hot open/assigned rows whose CRM status differs.
 * Usage:
 *   npx tsx scripts/reconcile-stale-hot-status.ts           # audit only
 *   npx tsx scripts/reconcile-stale-hot-status.ts --apply   # refresh stale TRNs from CRM
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
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
    WHERE h.status_bucket IN ('assigned', 'open_unallocated')
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
  const ytdStart = registerHotRetentionStart();
  const candidates = await withAppClient((client) => listCandidates(client, ytdStart));
  console.log(`Behind-watermark open/assigned candidates: ${candidates.length}`);

  const staleTrns: string[] = [];
  for (let i = 0; i < candidates.length && staleTrns.length < MAX_REFRESH; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno), { includeTransferred: true });
    const crmByTrn = new Map(
      crmRows.map((row) => [String(row.vtrnno ?? '').trim(), row]).filter(([t]) => t)
    );
    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) {
        if (staleTrns.length < 20) {
          console.log(`  no CRM row: ${hot.vtrnno} (${hot.status_bucket})`);
        }
        continue;
      }
      if (hotRowNeedsReconcileFromCrm(hot, crm)) {
        staleTrns.push(hot.vtrnno);
        if (staleTrns.length <= 15) {
          const cr = crm.ncancelreason;
          console.log(
            `  stale: ${hot.vtrnno} hot=${hot.status_bucket}/ncr=${hot.ncancelreason ?? 0} crm_ncr=${cr}`
          );
        }
      }
    }
  }

  console.log(`Stale vs CRM (scanned ${Math.min(candidates.length, MAX_REFRESH + BATCH)}): ${staleTrns.length}`);
  if (!staleTrns.length) return;

  if (!APPLY) {
    console.log('Run with --apply to refresh from CRM');
    return;
  }

  let upserted = 0;
  for (let i = 0; i < staleTrns.length; i += BATCH) {
    const chunk = staleTrns.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(chunk, { includeTransferred: true });
    await withAppClient(async (client) => {
      if (!(await tryAcquireSyncLock(client))) {
        throw new Error('sync lock not acquired');
      }
      try {
        const state = await getSyncState(client);
        const result = await applyCrmRowsToHot(client, crmRows, {
          state,
          advanceWatermarks: false,
        });
        await releaseSyncLock(client, 'ok', result.rowsUpserted);
        upserted += result.rowsUpserted + result.rowsDeleted;
      } catch (err) {
        await releaseSyncLock(client, 'error', 0);
        throw err;
      }
    });
    console.log(`  refreshed ${Math.min(i + BATCH, staleTrns.length)}/${staleTrns.length}`);
  }
  console.log(`Done — upserted ${upserted} row(s)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
