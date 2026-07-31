import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';

config({ path: join(process.cwd(), '.env.local') });

const PLANT = `COALESCE(p.region_zone, upper(trim(h.region)))`;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCrmDate(s: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

function normId(s: string): string {
  return s.trim().replace(/^0+/, '').toLowerCase();
}

function loadCsvIds(zone: string): Set<string> {
  const lines = readFileSync(
    'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv',
    'utf8'
  )
    .split(/\r?\n/)
    .filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.indexOf(n);
  const ids = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
    if ((c[idx('Status')] ?? '').toLowerCase() === 'cancelled') continue;
    const d = parseCrmDate(c[idx('Date')] ?? '');
    if (!d || d < new Date('2026-01-01') || d > new Date('2026-06-29T23:59:59')) continue;
    if (!(c[idx('Region')] ?? '').toUpperCase().includes(zone)) continue;
    const id = normId(c[idx('Call Centre ID')] ?? c[idx('ID')] ?? '');
    if (id) ids.add(id);
  }
  return ids;
}

async function main() {
  const csvNorth = loadCsvIds('NORTH');
  const csvWest = loadCsvIds('WEST');

  await withAppClient(async (c) => {
    for (const zone of ['NORTH', 'WEST']) {
      const csv = zone === 'NORTH' ? csvNorth : csvWest;
      const rows = await c.query<{
        vtrnno: string;
        vcclid: string | null;
        status_bucket: string;
        status_label: string;
        account: string;
        office: string;
        logged_at: string;
      }>(
        `
        SELECT h.vtrnno, h.vcclid, h.status_bucket, h.status_label, h.account,
               COALESCE(d.vcompanyname, h.branch_name) AS office,
               h.logged_at::text
        FROM calls_latest_hot h
        LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND ${PLANT} LIKE $1
          ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
        `,
        [`%${zone}%`]
      );

      const onlyDb = rows.rows.filter((r) => {
        const id = normId(r.vtrnno);
        const alt = r.vcclid ? normId(r.vcclid) : '';
        return !csv.has(id) && (!alt || !csv.has(alt));
      });

      console.log(`\n=== ${zone}: DB ${rows.rows.length}, CSV ${csv.size}, only in DB ${onlyDb.length} ===`);
      const solved = onlyDb.filter((r) => ['solved', 'tech_solved'].includes(r.status_bucket));
      const open = onlyDb.filter((r) => ['open_unallocated', 'assigned'].includes(r.status_bucket));
      console.log(`  onlyDb solved: ${solved.length}, open: ${open.length}`);
      for (const r of onlyDb.slice(0, 20)) {
        console.log(
          `  ${r.vtrnno} ${r.status_bucket}/${r.status_label} ${r.account} @ ${r.office} ${r.logged_at.slice(0, 10)}`
        );
      }
    }

    const cancelled = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket = 'cancelled'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    `);
    const nonCancelled = await c.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    `);
    console.log(`\nCRM breakdown: non-cancelled ${nonCancelled.rows[0].n}, cancelled ${cancelled.rows[0].n}, sum ${nonCancelled.rows[0].n + cancelled.rows[0].n}`);
    console.log(`Excel non-cancelled ref: 197793, portal: 197806`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
