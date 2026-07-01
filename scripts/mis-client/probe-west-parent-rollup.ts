import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

config({ path: join(process.cwd(), '.env.local') });

/** Parent branches that compose Excel WEST total (from Summary branch rows). */
const EXCEL_WEST_PARENT_BRANCHES = [
  '1175 - PUNE',
  '1126 - INDORE',
  '1140-AHMEDABAD',
  '1134-RAIPUR',
  '1171 - MUMBAI',
  '1170 - NAGPUR',
];

function normBranch(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/\s*-\s*/g, ' - ');
}

async function main() {
  await withAppClient(async (c) => {
    const parents = await c.query<{
      ncode: number;
      vcompanyname: string | null;
      nunder: number | null;
    }>(
      `SELECT ncode, vcompanyname, nunder FROM dim_offices ORDER BY ncode`
    );

    const parentById = new Map<number, { name: string; nunder: number | null }>();
    for (const p of parents.rows) {
      parentById.set(Number(p.ncode), {
        name: String(p.vcompanyname ?? ''),
        nunder: p.nunder != null ? Number(p.nunder) : null,
      });
    }

    const excelParentIds = new Set<number>();
    for (const label of EXCEL_WEST_PARENT_BRANCHES) {
      const target = normBranch(label);
      for (const [id, info] of parentById) {
        if (normBranch(info.name).includes(target.replace(' - ', ' - ')) || normBranch(`${id} - ${info.name}`) === target) {
          excelParentIds.add(id);
        }
        if (normBranch(info.name) === normBranch(label.replace(/^\d+\s*-\s*/i, ''))) {
          excelParentIds.add(id);
        }
      }
    }

    // Also match by leading office code in label
    for (const label of EXCEL_WEST_PARENT_BRANCHES) {
      const m = /^(\d+)/.exec(label);
      if (m) excelParentIds.add(Number(m[1]));
    }

    console.log('Excel west parent office ids:', [...excelParentIds].sort((a, b) => a - b));
    for (const id of [...excelParentIds].sort((a, b) => a - b)) {
      console.log(`  ${id}: ${parentById.get(id)?.name}`);
    }

    const rollup = await c.query<{
      parent_id: number;
      parent_name: string | null;
      total: number;
      solved: number;
      open_status: number;
    }>(
      `
      WITH call_parents AS (
        SELECT
          h.vtrnno,
          h.status_bucket,
          COALESCE(NULLIF(d.nunder, 0), h.nofficeid) AS parent_id
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
          ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      )
      SELECT
        cp.parent_id,
        d.vcompanyname AS parent_name,
        count(*)::int AS total,
        count(*) FILTER (WHERE cp.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
        count(*) FILTER (WHERE cp.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_status
      FROM call_parents cp
      LEFT JOIN dim_offices d ON d.ncode = cp.parent_id
      GROUP BY cp.parent_id, d.vcompanyname
      ORDER BY total DESC
      `,
    );

    let allWest = 0;
    let excelParents = 0;
    let outsideParents = 0;
    const outsideRows: typeof rollup.rows = [];

    for (const row of rollup.rows) {
      allWest += row.total;
      if (excelParentIds.has(Number(row.parent_id))) {
        excelParents += row.total;
        console.log(
          `IN  ${row.parent_id} ${row.parent_name}: total ${row.total} solved ${row.solved} open ${row.open_status}`
        );
      } else if (row.total > 0) {
        outsideParents += row.total;
        outsideRows.push(row);
      }
    }

    console.log(`\nAll west (leaf rollup to parent): ${allWest}`);
    console.log(`Excel 6-parent subset: ${excelParents} (excel ref 25089, Δ${excelParents - 25089})`);
    console.log(`Outside excel parents: ${outsideParents}`);

    console.log('\nTop west parents OUTSIDE excel 6-branch set:');
    for (const row of outsideRows.slice(0, 20)) {
      console.log(`  ${row.parent_id} ${row.parent_name}: total ${row.total}`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
