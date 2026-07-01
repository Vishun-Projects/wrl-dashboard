import { config } from 'dotenv';
import { join } from 'path';
import XLSX from 'xlsx';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

config({ path: join(process.cwd(), '.env.local') });

const EXCEL = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';
const PLANT = `COALESCE(p.region_zone, upper(trim(h.region)))`;

async function main() {
  const wb = XLSX.readFile(EXCEL);
  const sum = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1, defval: '' }) as unknown[][];
  let inBranches = false;
  const northParents = new Set<number>();
  for (const r of sum) {
    const label = String(r[0] ?? '').trim();
    if (label === 'Branches') {
      inBranches = true;
      continue;
    }
    if (!inBranches || !label) break;
    const m = /^(\d+)/.exec(label);
    if (!m) continue;
    const id = Number(m[1]);
    await withAppClient(async (c) => {
      const reg = await c.query<{ region: string }>(
        `SELECT COALESCE(p.region_zone, 'OTHER') AS region
         FROM dim_offices d
         LEFT JOIN mis_plant_region_mappings p ON p.office_id = d.ncode
         WHERE d.ncode = $1`,
        [id]
      );
      if (String(reg.rows[0]?.region ?? '').includes('NORTH')) northParents.add(id);
    });
  }

  console.log('North excel parent ids:', [...northParents].sort((a, b) => a - b));

  await withAppClient(async (c) => {
    const rows = await c.query<{
      parent_id: number;
      parent_name: string | null;
      total: number;
      solved: number;
      open_b: number;
    }>(
      `
      WITH cp AS (
        SELECT h.vtrnno, h.status_bucket,
          COALESCE(NULLIF(d.nunder, 0), h.nofficeid) AS parent_id
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND ${PLANT} LIKE '%NORTH%'
          ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      )
      SELECT cp.parent_id, d.vcompanyname AS parent_name,
        count(*)::int AS total,
        count(*) FILTER (WHERE cp.status_bucket IN ('solved','tech_solved'))::int AS solved,
        count(*) FILTER (WHERE cp.status_bucket IN ('open_unallocated','assigned'))::int AS open_b
      FROM cp
      LEFT JOIN dim_offices d ON d.ncode = cp.parent_id
      GROUP BY cp.parent_id, d.vcompanyname
      HAVING count(*) FILTER (WHERE cp.status_bucket IN ('open_unallocated','assigned')) > 0
      ORDER BY open_b DESC
      LIMIT 15
      `
    );
    console.log('\nNorth parents with most open calls:');
    for (const r of rows.rows) {
      const inExcel = northParents.has(Number(r.parent_id)) ? 'excel-parent' : 'outside';
      console.log(`  ${r.parent_id} ${r.parent_name}: open ${r.open_b} total ${r.total} [${inExcel}]`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
