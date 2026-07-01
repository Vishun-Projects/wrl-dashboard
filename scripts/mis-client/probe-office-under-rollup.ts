import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const EXCEL_WEST_PARENT_IDS = [10, 14, 28, 29, 30, 289];

async function main() {
  await withAppClient(async (c) => {
    const variants = [
      ['dim nunder parent', 'COALESCE(NULLIF(d.nunder, 0), h.nofficeid)'],
      ['hot office_under parent', 'COALESCE(NULLIF(h.office_under, 0), h.nofficeid)'],
      ['hot office_under only when set', 'CASE WHEN h.office_under IS NOT NULL AND h.office_under <> 0 THEN h.office_under ELSE h.nofficeid END'],
    ] as const;

    for (const [label, parentExpr] of variants) {
      const r = await c.query<{ total: number; solved: number; open_status: number; in6: number }>(
        `
        WITH call_parents AS (
          SELECT
            h.status_bucket,
            ${parentExpr} AS parent_id
          FROM calls_latest_hot h
          LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
          LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
          WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
            AND upper(trim(h.call_type)) = 'BREAKDOWN'
            AND h.status_bucket != 'cancelled'
            AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        )
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status_bucket IN ('solved', 'tech_solved'))::int AS solved,
          count(*) FILTER (WHERE status_bucket IN ('open_unallocated', 'assigned'))::int AS open_status,
          count(*) FILTER (WHERE parent_id = ANY($1::bigint[]))::int AS in6
        FROM call_parents
        `,
        [EXCEL_WEST_PARENT_IDS]
      );
      const row = r.rows[0];
      console.log(
        `${label}: total ${row.total} (Δ${row.total - 25089}), in6 ${row.in6} (Δ${row.in6 - 25089}), open ${row.open_status} (Δ${row.open_status - 1542})`
      );
    }

    const perParent = await c.query<{
      parent_id: number;
      parent_name: string | null;
      total: number;
      solved: number;
      open_status: number;
    }>(
      `
      WITH call_parents AS (
        SELECT
          h.status_bucket,
          COALESCE(NULLIF(h.office_under, 0), h.nofficeid) AS parent_id
        FROM calls_latest_hot h
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
      )
      SELECT
        cp.parent_id,
        d.vcompanyname AS parent_name,
        count(*)::int AS total,
        count(*) FILTER (WHERE cp.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (WHERE cp.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_status
      FROM call_parents cp
      LEFT JOIN dim_offices d ON d.ncode = cp.parent_id
      WHERE cp.parent_id = ANY($1::bigint[])
      GROUP BY cp.parent_id, d.vcompanyname
      ORDER BY cp.parent_id
      `,
      [EXCEL_WEST_PARENT_IDS]
    );

    console.log('\nPer excel west parent using office_under:');
    const targets: Record<number, number> = {
      29: 10240,
      30: 6028,
      14: 4145,
      10: 2484,
      28: 1700,
      289: 492,
    };
    let sum = 0;
    for (const row of perParent.rows) {
      const ref = targets[Number(row.parent_id)] ?? 0;
      sum += row.total;
      console.log(
        `  ${row.parent_id} ${row.parent_name}: ${row.total} (ref ${ref}, Δ${row.total - ref}) open ${row.open_status}`
      );
    }
    console.log(`Sum 6 parents: ${sum} (ref 25089, Δ${sum - 25089})`);

    const excludeVirtual = await c.query<{ n: number; open_n: number }>(
      `
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS n,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated', 'assigned')
            AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        )::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(WEST REGION|PRACTICE|WINMAX)'
        AND COALESCE(d.is_branch, false) = false
        AND COALESCE(NULLIF(d.nunder, 0), NULLIF(h.office_under, 0)) IS NOT NULL
      `,
    );
    console.log(
      `\nWest franchisee-only (has parent, not virtual office name): ${excludeVirtual.rows[0].n} (Δ${excludeVirtual.rows[0].n - 25089})`
    );

    const excludeVirtualAll = await c.query<{ n: number }>(
      `
      SELECT count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(WEST REGION|PRACTICE|WINMAX)'
      `,
    );
    console.log(
      `West excluding virtual/practice/winmax names: ${excludeVirtualAll.rows[0].n} (Δ${excludeVirtualAll.rows[0].n - 25089})`
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
