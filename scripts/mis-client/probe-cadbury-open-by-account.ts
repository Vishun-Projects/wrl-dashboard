import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

async function main() {
  await withAppClient(async (c) => {
    const r = await c.query(`
      SELECT
        COALESCE(p.region_zone, upper(trim(h.region))) AS region,
        lower(trim(h.account)) AS account,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1, 2
      HAVING count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned')) > 0
      ORDER BY open_n DESC
      LIMIT 30
    `);
    console.log('Top open accounts by region:');
    for (const row of r.rows) console.log(row);

    const cad = await c.query(`
      SELECT
        COALESCE(p.region_zone, upper(trim(h.region))) AS region,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND lower(trim(h.account)) IN ('cadbury', 'mondelez')
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1 ORDER BY 1
    `);
    console.log('\nHot open Cadbury/Mondelez by zone:', cad.rows);

    const westOpen = await c.query(`
      SELECT h.vtrnno, h.account, h.branch_name, h.status_label, h.logged_at::date
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(p.region_zone, upper(trim(h.region))) = 'WEST ZONE'
        AND h.status_bucket IN ('open_unallocated','assigned')
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      ORDER BY h.logged_at
      LIMIT 20
    `);
    console.log('\nWest open sample count', westOpen.rows.length);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
