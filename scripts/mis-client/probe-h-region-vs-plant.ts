import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

async function main() {
  const crm = await queryBdMisCrmSummary({
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  });
  let open = 0;
  for (const b of crm.branchSummary) open += b.open_calls ?? 0;
  console.log('queryBdMisCrmSummary branch open sum:', open);

  await withAppClient(async (c) => {
    const r = await c.query(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_h_region,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated','assigned')
            AND COALESCE(p.region_zone, upper(trim(h.region))) != upper(trim(h.region))
        )::int AS open_where_plant_differs
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    `);
    console.log('hot table:', r.rows[0]);

    const byRegion = await c.query(`
      SELECT upper(trim(h.region)) AS r,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1 ORDER BY 1
    `);
    console.log('open by h.region:', byRegion.rows);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
