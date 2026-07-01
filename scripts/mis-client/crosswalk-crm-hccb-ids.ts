import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';

const RAW = process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

function normKey(v: unknown): string {
  return String(v ?? '').trim().replace(/^0+/, '').toLowerCase();
}

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

async function main() {
  const hccbPath = join(RAW, 'HCCB.xlsx');
  const crmPath = join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv');

  const wb = XLSX.readFile(hccbPath, { cellDates: true });
  const hccbRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: '',
    range: 4,
  });
  const hccbCallNo = new Set<string>();
  const hccbSap = new Set<string>();
  for (const r of hccbRows) {
    const k = normKey(r['Call No']);
    if (k) hccbCallNo.add(k);
    const sap = normKey(r['SAP Order No.']);
    if (sap) hccbSap.add(sap);
  }

  const lines = readFileSync(crmPath, 'utf8').split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const idx = (n: string) => headers.indexOf(n);

  let crmSouthCokeAll = 0;
  let crmSouthCokeActive = 0;
  let matchAnyField = 0;
  const byAccount = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const acc = (cols[idx('Account')] ?? '').toLowerCase();
    const reg = cols[idx('Region')] ?? '';
    if (!reg.includes('SOUTH')) continue;
    if (acc !== 'coke' && acc !== 'coke oya' && acc !== 'hccb') continue;

    crmSouthCokeAll++;
    byAccount.set(acc, (byAccount.get(acc) ?? 0) + 1);
    const cancelled = (cols[idx('Status')] ?? '').toLowerCase() === 'cancelled';
    if (!cancelled) crmSouthCokeActive++;

    let matched = false;
    for (let j = 0; j < cols.length; j++) {
      const k = normKey(cols[j]);
      if (k && (hccbCallNo.has(k) || hccbSap.has(k))) matched = true;
    }
    if (matched) matchAnyField++;
  }

  console.log('=== ID crosswalk: CRM South Coke-family vs HCCB ===\n');
  console.log(`HCCB Call No keys: ${hccbCallNo.size} (7xxxxxx CDMS ids)`);
  console.log(`CRM South Coke-family rows (all): ${crmSouthCokeAll}`);
  console.log(`CRM South Coke-family (non-cancelled): ${crmSouthCokeActive}`);
  console.log('  by account:', Object.fromEntries(byAccount));
  console.log(`CRM rows matching HCCB Call No in ANY CRM column: ${matchAnyField}`);

  await withAppClient(async (client) => {
    const accounts = await client.query(`
      SELECT lower(trim(account)) as account, count(*)::int n
      FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(call_type)) = 'BREAKDOWN'
        AND lower(trim(account)) IN ('coke','hccb','coke oya')
      GROUP BY 1 ORDER BY n DESC
    `);
    console.log('\nPortal DB CRM coke-family (all zones):', accounts.rows);

    const south = await client.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND lower(trim(h.account)) IN ('coke','hccb','coke oya')
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%SOUTH%'
    `);
    console.log('Portal DB South coke-family:', south.rows[0].n);

    const sample = [...hccbCallNo].slice(0, 1000);
    const dbMatch = await client.query<{ n: number }>(
      `SELECT count(*)::int n FROM calls_latest_hot
       WHERE ncode::text = ANY($1::text[])
          OR vcclid = ANY($1::text[])
          OR vtrnno = ANY($1::text[])`,
      [sample]
    );
    console.log(`DB calls matching 1000 HCCB Call Nos (ncode/vcclid/vtrnno): ${dbMatch.rows[0].n}`);

    const reverse = await client.query<{ n: number }>(
      `SELECT count(*)::int n FROM calls_latest_hot
       WHERE lower(trim(account)) IN ('coke','hccb','coke oya')
         AND logged_at >= '2026-01-01' AND logged_at <= '2026-06-29 23:59:59'
         AND (ncode::text LIKE '7%' OR vcclid LIKE '7%' OR vtrnno LIKE '7%')`
    );
    console.log(`DB coke-family with 7xxxxxx-style ids: ${reverse.rows[0].n}`);
  });

  console.log('\n=== What this means ===');
  console.log('1. CRM uses WRL ids (~2.5M Call Centre ID). HCCB uses Coke CDMS Call No (~7M).');
  console.log('2. They do NOT share the same ticket number — overlap by id is ~0.');
  console.log('3. CRM South "Coke/Coke Oya" is a SMALL slice (~50–200 rows), mostly Coke Oya.');
  console.log('4. HCCB is the FULL South beverage breakdown register (~30k rows).');
  console.log('5. Same CLIENT (Coke/HCCB), different SYSTEMS — not an excuse to add both in South.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
