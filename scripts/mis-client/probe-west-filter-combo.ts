import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const WEST_PARENTS = [10, 14, 28, 29, 30, 289];

async function main() {
  await withAppClient(async (c) => {
    const all = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN' AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
    `);
    console.log('all west', all.rows[0].n);

    const filters: Array<{ name: string; where: string }> = [
      { name: 'exclude nofficeid 606', where: 'h.nofficeid != 606' },
      {
        name: 'exclude 606 + practice/winmax',
        where: `h.nofficeid != 606 AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(PRACTICE|WINMAX)'`,
      },
      {
        name: 'under 6 west parents only',
        where: `COALESCE(NULLIF(h.office_under, 0), NULLIF(d.nunder, 0), h.nofficeid) = ANY($1::bigint[])`,
      },
      {
        name: 'exclude 606 + under 6 parents',
        where: `h.nofficeid != 606 AND COALESCE(NULLIF(h.office_under, 0), NULLIF(d.nunder, 0), h.nofficeid) = ANY($1::bigint[])`,
      },
      {
        name: 'exclude virtual + under 6 parents',
        where: `COALESCE(d.vcompanyname, h.branch_name, '') !~* '(WEST REGION|PRACTICE|WINMAX)'
          AND COALESCE(NULLIF(h.office_under, 0), NULLIF(d.nunder, 0), h.nofficeid) = ANY($1::bigint[])`,
      },
    ];

    for (const f of filters) {
      const params = f.where.includes('$1') ? [WEST_PARENTS] : [];
      const r = await c.query<{ n: number; solved: number; open_n: number }>(
        `
        SELECT
          count(*)::int AS n,
          count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
          count(*) FILTER (
            WHERE h.status_bucket IN ('open_unallocated', 'assigned')
              AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          )::int AS open_n
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN' AND h.status_bucket != 'cancelled'
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
          AND (${f.where})
        `,
        params
      );
      const row = r.rows[0];
      console.log(
        `${f.name}: total ${row.n} (Δ${row.n - 25089}), solved ${row.solved} (Δ${row.solved - 23547}), open ${row.open_n} (Δ${row.open_n - 1542})`
      );
    }

    const practiceNoZ = await c.query<{ n: number; solved: number; open_n: number }>(`
      SELECT
        count(*)::int AS n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated', 'assigned')
            AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        )::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN' AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(PRACTICE|WINMAX)'
        AND lower(trim(h.account)) NOT LIKE '%z profile%'
    `);
    const p = practiceNoZ.rows[0];
    console.log(
      `practice/winmax + no z profile: total ${p.n} (Δ${p.n - 25089}), solved ${p.solved} (Δ${p.solved - 23547}), open ${p.open_n} (Δ${p.open_n - 1542})`
    );

    const parentBucket = await c.query<{ n: number; solved: number; open_n: number }>(`
      SELECT
        count(*)::int AS n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated', 'assigned')
            AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        )::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN' AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(PRACTICE|WINMAX)'
        AND COALESCE(NULLIF(h.office_under, 0), NULLIF(d.nunder, 0), 0) NOT IN (605, 606, 607, 608, 612)
    `);
    const b = parentBucket.rows[0];
    console.log(
      `practice/winmax + exclude under region buckets: total ${b.n} (Δ${b.n - 25089}), solved ${b.solved} (Δ${b.solved - 23547}), open ${b.open_n} (Δ${b.open_n - 1542})`
    );

    const removed = await c.query<{ vtrnno: string; account: string; status_label: string; office: string }>(`
      SELECT h.vtrnno, h.account, h.status_label, COALESCE(d.vcompanyname, h.branch_name) AS office
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('solved', 'tech_solved')
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND COALESCE(d.vcompanyname, h.branch_name, '') !~* '(PRACTICE|WINMAX)'
      ORDER BY h.logged_at DESC
      LIMIT 20
    `);
    console.log('\nSample west solved after practice filter (newest 20):');
    for (const r of removed.rows) console.log(`  ${r.vtrnno} ${r.account} ${r.status_label} @ ${r.office}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
