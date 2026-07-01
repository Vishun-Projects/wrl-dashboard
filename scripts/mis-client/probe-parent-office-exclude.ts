import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';
import { TRHCALLS_PARENT_OFFICE_EXCLUDE } from '@/lib/trhcalls/query';

config({ path: join(process.cwd(), '.env.local') });

const PARENT_EXCLUDE = TRHCALLS_PARENT_OFFICE_EXCLUDE;

async function main() {
  await withAppClient(async (c) => {
    const ex = PARENT_EXCLUDE.join(', ');

    for (const zone of ['NORTH', 'EAST', 'WEST', 'SOUTH']) {
      const base = await c.query<{ total: number; solved: number; open_n: number }>(
        `
        SELECT
          count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total,
          count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
          count(*) FILTER (
            WHERE h.status_bucket IN ('open_unallocated', 'assigned')
              AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          )::int AS open_n
        FROM calls_latest_hot h
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE $1
        `,
        [`%${zone}%`]
      );

      const filtered = await c.query<{ total: number; solved: number; open_n: number }>(
        `
        SELECT
          count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total,
          count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
          count(*) FILTER (
            WHERE h.status_bucket IN ('open_unallocated', 'assigned')
              AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          )::int AS open_n
        FROM calls_latest_hot h
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE $1
          AND h.nofficeid NOT IN (${ex})
          AND COALESCE(h.office_under, 0) NOT IN (${ex})
          AND COALESCE(d.nunder, 0) NOT IN (${ex})
        `,
        [`%${zone}%`]
      );

      const ref: Record<string, { total: number; solved: number; open: number }> = {
        NORTH: { total: 68355, solved: 65854, open: 2501 },
        EAST: { total: 30131, solved: 28635, open: 1496 },
        WEST: { total: 25089, solved: 23547, open: 1542 },
        SOUTH: { total: 74218, solved: 70984, open: 3234 },
      };

      const r = ref[zone];
      const f = filtered.rows[0];
      const b = base.rows[0];
      console.log(`\n${zone}:`);
      console.log(
        `  base total ${b.total} (Δ${b.total - r.total}), open ${b.open_n} (Δ${b.open_n - r.open})`
      );
      console.log(
        `  exclude parent buckets total ${f.total} (Δ${f.total - r.total}), open ${f.open_n} (Δ${f.open_n - r.open}), removed ${b.total - f.total}`
      );
    }

    const byOffice = await c.query<{ nofficeid: number; name: string; n: number }>(
      `
      SELECT h.nofficeid, COALESCE(d.vcompanyname, h.branch_name) AS name, count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND h.nofficeid = ANY($1::bigint[])
      GROUP BY 1,2 ORDER BY n DESC
      `,
      [PARENT_EXCLUDE]
    );
    console.log('\nWest calls at excluded parent office ids:');
    for (const row of byOffice.rows) console.log(`  ${row.nofficeid} ${row.name}: ${row.n}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
