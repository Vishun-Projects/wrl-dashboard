import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { hotRowNeedsCrmRefresh } from '@/lib/read-model/pipeline-reconcile';
import { transformCrmRowToHot } from '@/lib/read-model/transform';

const SAMPLE = Number(process.env.AUDIT_SAMPLE ?? 120);
const BATCH = 40;

async function main() {
  const stats = await withAppClient(async (c) => {
    const wm = await c.query(
      `SELECT last_editedon FROM sync_state WHERE entity = 'calls_latest_hot'`
    );
    const behind = await c.query<{ behind_wm: number; open_behind: number }>(`
      SELECT
        count(*)::int AS behind_wm,
        count(*) FILTER (WHERE h.status_bucket IN ('assigned','open_unallocated'))::int AS open_behind
      FROM calls_latest_hot h
      CROSS JOIN LATERAL (SELECT last_editedon FROM sync_state WHERE entity='calls_latest_hot' LIMIT 1) s
      WHERE h.logged_at >= '2026-01-01'
        AND (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon)
    `);
    const openPipeline = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot
      WHERE status_bucket IN ('assigned','open_unallocated') AND logged_at >= '2026-01-01'
    `);
    const openNcr0 = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot
      WHERE status_bucket IN ('assigned','open_unallocated')
        AND logged_at >= '2026-01-01' AND coalesce(ncancelreason, 0) = 0
    `);
    return {
      watermark: wm.rows[0]?.last_editedon,
      ...behind.rows[0],
      openPipeline: openPipeline.rows[0].n,
      openNcr0: openNcr0.rows[0].n,
    };
  });
  console.log('=== Postgres stats ===');
  console.log(JSON.stringify(stats, null, 2));

  const candidates = await withAppClient(async (c) => {
    const res = await c.query(
      `
      SELECT h.vtrnno, h.status_bucket, h.ncancelreason, h.source_editedon,
             h.bsolved, h.bfastclose, h.region, h.account, h.logged_at
      FROM calls_latest_hot h
      CROSS JOIN LATERAL (SELECT last_editedon FROM sync_state WHERE entity='calls_latest_hot' LIMIT 1) s
      WHERE h.status_bucket IN ('assigned', 'open_unallocated')
        AND h.logged_at >= '2026-01-01'
        AND (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon)
      ORDER BY h.synced_at ASC NULLS FIRST
      LIMIT $1
      `,
      [SAMPLE]
    );
    return res.rows;
  });

  let stale = 0;
  let crmCancelledHotOpen = 0;
  let crmSolvedHotOpen = 0;
  let noCrm = 0;
  const examples: string[] = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    const crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno));
    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno).trim(), r]));

    for (const hot of chunk) {
      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) {
        noCrm++;
        continue;
      }
      const fresh = transformCrmRowToHot(crm);
      const crmNcr = Number(crm.ncancelreason ?? 0);
      if (hotRowNeedsCrmRefresh(hot, crm)) {
        stale++;
        if (examples.length < 12) {
          examples.push(
            `${hot.vtrnno}: hot=${hot.status_bucket}/ncr=${hot.ncancelreason ?? 0} → crm=${fresh?.status_bucket ?? 'n/a'}/ncr=${crmNcr}`
          );
        }
        if (fresh?.status_bucket === 'cancelled' && hot.status_bucket !== 'cancelled') {
          crmCancelledHotOpen++;
        }
        if (
          (fresh?.status_bucket === 'solved' || fresh?.status_bucket === 'tech_solved') &&
          (hot.status_bucket === 'assigned' || hot.status_bucket === 'open_unallocated')
        ) {
          crmSolvedHotOpen++;
        }
      }
    }
  }

  console.log('\n=== CRM sample audit (behind-watermark open/assigned) ===');
  console.log(`Sampled: ${candidates.length}`);
  console.log(`Stale vs CRM: ${stale}`);
  console.log(`  → CRM cancelled, hot still open/assigned: ${crmCancelledHotOpen}`);
  console.log(`  → CRM solved/tech, hot still open/assigned: ${crmSolvedHotOpen}`);
  console.log(`No CRM match in sample: ${noCrm}`);
  if (examples.length) {
    console.log('\nExamples:');
    for (const e of examples) console.log(' ', e);
  }

  const rate = candidates.length ? stale / candidates.length : 0;
  const estStaleOpen = Math.round(stats.openPipeline * rate);
  const estCancelled = Math.round(stats.openPipeline * (crmCancelledHotOpen / Math.max(candidates.length, 1)));
  console.log('\n=== Rough extrapolation (sample-based) ===');
  console.log(`Stale rate in sample: ${(rate * 100).toFixed(1)}%`);
  console.log(`Est. stale open/assigned in hot (~${stats.openPipeline} total): ~${estStaleOpen}`);
  console.log(`Est. cancelled-in-CRM but open-in-hot: ~${estCancelled}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
