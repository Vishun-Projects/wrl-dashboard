/**
 * Open calls where morning CSV Region column != h.region in DB.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const CSV = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCrmDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function isOpenStatus(status: string, solvedDate: string): boolean {
  const lower = status.trim().toLowerCase();
  if (lower.includes('cancel')) return false;
  if (
    parseCrmDate(solvedDate) ||
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech')
  )
    return false;
  return true;
}

function loadCsvOpen(): Map<string, { region: string; zone: string; account: string }> {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const map = new Map<string, { region: string; zone: string; account: string }>();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > '2026-06-29') continue;
    const branch = (c[idx('Branch')] ?? '').toUpperCase();
    if (branch.includes('PRACTICE') || branch.includes('WINMAX')) continue;
    if (!isOpenStatus(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? '')) continue;
    const vtrnno = String(c[idx('ID')] ?? '').trim();
    const region = (c[idx('Region')] ?? '').trim();
    map.set(vtrnno, {
      region,
      zone: formatDisplayRegion(region),
      account: (c[idx('Account')] ?? '').trim(),
    });
  }
  return map;
}

async function main() {
  const csvOpen = loadCsvOpen();
  console.log('CSV open (excl practice):', csvOpen.size);

  await withAppClient(async (c) => {
    const r = await c.query<{
      vtrnno: string;
      h_region: string;
      account: string;
    }>(`
      SELECT h.vtrnno, upper(trim(h.region)) AS h_region, h.account
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('open_unallocated','assigned')
        AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
    `);

    console.log('DB open (excl practice):', r.rows.length);

    let zoneMismatch = 0;
    let regionTextMismatch = 0;
    let onlyCsvZone = 0;
    let onlyDbZone = 0;
    const samples: string[] = [];

    for (const row of r.rows) {
      const csv = csvOpen.get(row.vtrnno);
      if (!csv) continue;
      const dbZone = formatDisplayRegion(row.h_region);
      if (csv.zone !== dbZone) {
        zoneMismatch++;
        if (samples.length < 12) {
          samples.push(
            `${row.vtrnno}: CSV[${csv.region}]→${csv.zone} vs DB[${row.h_region}]→${dbZone} (${row.account})`
          );
        }
      }
      if (csv.region.toUpperCase() !== row.h_region.toUpperCase()) regionTextMismatch++;
    }

    for (const [trn, csv] of csvOpen) {
      const db = r.rows.find((x) => x.vtrnno === trn);
      if (!db) continue;
      const dbZone = formatDisplayRegion(db.h_region);
      if (csv.zone === 'OTHER') onlyCsvZone++;
      if (dbZone === 'OTHER') onlyDbZone++;
    }

    console.log({ zoneMismatch, regionTextMismatch, onlyCsvZone, onlyDbZone });
    if (samples.length) {
      console.log('\nZone mismatch samples:');
      samples.forEach((s) => console.log(' ', s));
    }

    // Zone open totals CSV vs DB
    const csvByZone = new Map<string, number>();
    const dbByZone = new Map<string, number>();
    for (const [, v] of csvOpen) {
      csvByZone.set(v.zone, (csvByZone.get(v.zone) ?? 0) + 1);
    }
    for (const row of r.rows) {
      const z = formatDisplayRegion(row.h_region);
      dbByZone.set(z, (dbByZone.get(z) ?? 0) + 1);
    }
    console.log('\nOpen by zone CSV vs DB:');
    for (const z of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
      const a = csvByZone.get(z) ?? 0;
      const b = dbByZone.get(z) ?? 0;
      if (a !== b) console.log(`  ${z}: CSV ${a} | DB ${b} | Δ${b - a}`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
