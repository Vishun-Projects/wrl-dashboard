import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const PLANT = `COALESCE(p.region_zone, upper(trim(h.region)))`;
const PRACTICE = `COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'`;

async function main() {
  await withAppClient(async (c) => {
    for (const zone of ['NORTH', 'WEST']) {
      const r = await c.query<{
        solved_only: number;
        tech_solved: number;
        open_b: number;
        jun29_total: number;
        jun29_solved: number;
      }>(
        `
        SELECT
          count(*) FILTER (WHERE h.status_bucket = 'solved')::int AS solved_only,
          count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved,
          count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_b,
          count(*) FILTER (WHERE h.logged_at::date = '2026-06-29')::int AS jun29_total,
          count(*) FILTER (
            WHERE h.logged_at::date = '2026-06-29'
              AND h.status_bucket IN ('solved', 'tech_solved')
          )::int AS jun29_solved
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND ${PLANT} LIKE $1
          AND ${PRACTICE}
        `,
        [`%${zone}%`]
      );
      console.log(zone, r.rows[0]);
    }

    const jun29exclude = await c.query<{ n: number; solved: number; open_n: number }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated', 'assigned')
            AND h.logged_at >= '2026-01-01'
        )::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at < '2026-06-29'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND ${PRACTICE}
    `);
    console.log('\nAll zones, exclude Jun 29 logged date:', jun29exclude.rows[0], 'delta total', jun29exclude.rows[0].n - 197793);
  });
}

main().catch(console.error);
