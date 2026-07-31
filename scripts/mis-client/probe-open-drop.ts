import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';

config({ path: join(process.cwd(), '.env.local') });

const PLANT = `COALESCE(p.region_zone, upper(trim(h.region)))`;

async function main() {
  await withAppClient(async (c) => {
    const summary = await c.query<{
      open_n: number;
      solved_n: number;
      tech_solved: number;
      cancelled_n: number;
      synced_6h: number;
      solved_synced_6h: number;
      open_synced_6h: number;
    }>(
      `
      SELECT
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved_n,
        count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled_n,
        count(*) FILTER (WHERE h.synced_at >= now() - interval '6 hours')::int AS synced_6h,
        count(*) FILTER (
          WHERE h.synced_at >= now() - interval '6 hours'
            AND h.status_bucket IN ('solved','tech_solved')
        )::int AS solved_synced_6h,
        count(*) FILTER (
          WHERE h.synced_at >= now() - interval '6 hours'
            AND h.status_bucket IN ('open_unallocated','assigned')
        )::int AS open_synced_6h
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      `
    );
    console.log('YTD breakdown (logged through Jun 29):', summary.rows[0]);

    const byZone = await c.query<{
      zone: string;
      open_n: number;
      solved_n: number;
      tech_solved: number;
    }>(
      `
      SELECT ${PLANT} AS zone,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved_n,
        count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1
      ORDER BY 1
      `
    );
    console.log('\nRaw CRM by zone (non-cancelled):');
    for (const row of byZone.rows) console.log(row);

    const recentSolved = await c.query<{
      zone: string;
      n: number;
    }>(
      `
      SELECT ${PLANT} AS zone, count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('solved','tech_solved')
        AND h.synced_at >= now() - interval '6 hours'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1
      ORDER BY n DESC
      `
    );
    console.log('\nRows re-synced in last 6h currently solved (by zone):');
    for (const row of recentSolved.rows) console.log(row);

    const statusLabels = await c.query<{ status_label: string; n: number }>(
      `
      SELECT h.status_label, count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('open_unallocated','assigned')
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 15
      `
    );
    console.log('\nOpen status labels (CRM only):');
    for (const row of statusLabels.rows) console.log(row);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
