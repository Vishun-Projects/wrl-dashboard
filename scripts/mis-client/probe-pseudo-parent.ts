import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { TRHCALLS_PARENT_OFFICE_EXCLUDE } from '@/lib/trhcalls/query';

config({ path: join(process.cwd(), '.env.local') });

const PLANT = `COALESCE(p.region_zone, upper(trim(h.region)))`;
const EX = TRHCALLS_PARENT_OFFICE_EXCLUDE.join(',');

async function zoneGap(zone: string) {
  await withAppClient(async (c) => {
    const r = await c.query<{
      total: number;
      solved: number;
      open_b: number;
      direct_office: number;
      rollup_parent: number;
    }>(
      `
      WITH cp AS (
        SELECT
          h.vtrnno,
          h.status_bucket,
          h.nofficeid,
          COALESCE(NULLIF(d.nunder, 0), h.nofficeid) AS parent_id
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND ${PLANT} LIKE $1
          ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      )
      SELECT
        count(*) FILTER (WHERE parent_id IN (${EX}))::int AS rollup_parent,
        count(*) FILTER (WHERE parent_id IN (${EX}) AND status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (WHERE parent_id IN (${EX}) AND status_bucket IN ('open_unallocated', 'assigned'))::int AS open_b,
        count(*) FILTER (WHERE nofficeid IN (${EX}))::int AS direct_office,
        count(*)::int AS total
      FROM cp
      `,
      [`%${zone}%`]
    );
    console.log(zone, r.rows[0]);
  });
}

async function main() {
  for (const z of ['WEST', 'NORTH', 'EAST', 'SOUTH']) {
    await zoneGap(z);
  }

  await withAppClient(async (c) => {
    const r = await c.query<{ n: number }>(
      `
      SELECT count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND ${PLANT} LIKE '%WEST%'
        AND (h.nofficeid IN (${EX}) OR COALESCE(NULLIF(d.nunder, 0), h.nofficeid) IN (${EX}))
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      `
    );
    console.log('WEST pseudo-parent calls (direct or rollup):', r.rows[0].n);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
