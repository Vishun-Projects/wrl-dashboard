/**
 * Quick stats: hot rows behind sync watermark (editedon gap).
 * Usage: npx tsx scripts/ops/count-stale-hot.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient, closePool } from '@/lib/read-model/db';

withAppClient(async (c) => {
  const wm = await c.query(
    `SELECT last_editedon FROM sync_state WHERE entity='calls_latest_hot' LIMIT 1`
  );
  console.log('Watermark:', wm.rows[0]?.last_editedon);

  const r = await c.query(`
    SELECT
      count(*)::int AS behind_wm,
      count(*) FILTER (WHERE h.status_bucket IN ('assigned','open_unallocated'))::int AS open_behind
    FROM calls_latest_hot h
    CROSS JOIN LATERAL (SELECT last_editedon FROM sync_state WHERE entity='calls_latest_hot' LIMIT 1) s
    WHERE h.logged_at >= '2026-01-01'
      AND (h.source_editedon IS NULL OR h.source_editedon < s.last_editedon)
  `);
  console.log('Behind watermark (YTD):', r.rows[0]);
})
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
