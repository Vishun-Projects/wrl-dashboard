/**
 * Why portal union open (8787) > Excel (8773) when CRM CSV matches DB?
 * Rebuild union two ways: CSV region vs plant-mapped CRM.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { queryClientAccountSummaryForBdMis } from '@/modules/mis/client-import/services/aggregate';
import { openCallsFromTotals } from '@/modules/mis/services/bd-mis-summary';
import { formatDisplayRegion } from '@/modules/mis/client-import/services/region';

const CSV = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';
const END = '2026-06-29';
const ZONES = ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'] as const;

const EXCEL_OPEN: Record<string, number> = {
  'NORTH ZONE': 2501,
  'EAST ZONE': 1496,
  'WEST ZONE': 1542,
  'SOUTH ZONE': 3234,
  GRAND: 8773,
};

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

function csvBucket(status: string, solvedDate: string): 'open' | 'solved' | 'cancelled' {
  const lower = status.trim().toLowerCase();
  if (lower.includes('cancel')) return 'cancelled';
  if (
    parseCrmDate(solvedDate) ||
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech')
  )
    return 'solved';
  return 'open';
}

function isPractice(branch: string): boolean {
  const s = branch.toUpperCase();
  return s.includes('PRACTICE') || s.includes('WINMAX');
}

function isMondelez(account: string): boolean {
  const a = account.trim().toLowerCase();
  return a === 'cadbury' || a === 'mondelez';
}

type ZoneMetrics = { open: number; solved: number; total: number };

function emptyZone(): ZoneMetrics {
  return { open: 0, solved: 0, total: 0 };
}

function add(m: ZoneMetrics, bucket: 'open' | 'solved' | 'cancelled') {
  if (bucket === 'cancelled') return;
  m.total++;
  if (bucket === 'open') m.open++;
  else m.solved++;
}

function unionOpen(
  crm: Map<string, ZoneMetrics>,
  subtractMondelez: Map<string, ZoneMetrics>,
  addCadbury: Map<string, ZoneMetrics>,
  addCoke: ZoneMetrics
): { byZone: Map<string, number>; grand: number } {
  const byZone = new Map<string, number>();
  let grand = 0;
  for (const zone of ZONES) {
    const c = crm.get(zone) ?? emptyZone();
    const sub = subtractMondelez.get(zone) ?? emptyZone();
    const cad = addCadbury.get(zone) ?? emptyZone();
    const coke = zone === 'SOUTH ZONE' ? addCoke : emptyZone();
    const open = Math.max(0, c.open - sub.open + cad.open + coke.open);
    byZone.set(zone, open);
    grand += open;
  }
  return { byZone, grand };
}

function loadCrmFromCsv(): {
  branch: Map<string, ZoneMetrics>;
  mondelez: Map<string, ZoneMetrics>;
} {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const branch = new Map<string, ZoneMetrics>();
  const mondelez = new Map<string, ZoneMetrics>();
  for (const z of ZONES) {
    branch.set(z, emptyZone());
    mondelez.set(z, emptyZone());
  }

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > END) continue;
    if (isPractice(c[idx('Branch')] ?? '')) continue;
    const zone = formatDisplayRegion(c[idx('Region')] ?? '');
    if (!branch.has(zone)) continue;
    const bucket = csvBucket(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? '');
    const account = c[idx('Account')] ?? '';
    add(branch.get(zone)!, bucket);
    if (isMondelez(account) && zone !== 'WEST ZONE') add(mondelez.get(zone)!, bucket);
  }
  return { branch, mondelez };
}

async function loadCrmFromDbPlantMap(): Promise<{
  branch: Map<string, ZoneMetrics>;
  mondelez: Map<string, ZoneMetrics>;
}> {
  return withAppClient(async (c) => {
    const branch = new Map<string, ZoneMetrics>();
    const mondelez = new Map<string, ZoneMetrics>();
    for (const z of ZONES) {
      branch.set(z, emptyZone());
      mondelez.set(z, emptyZone());
    }

    const r = await c.query<{
      region: string;
      account: string;
      open_n: number;
      solved_n: number;
      total_nc: number;
    }>(`
      SELECT
        COALESCE(p.region_zone, upper(trim(h.region))) AS region,
        h.account,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved_n,
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total_nc
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
      GROUP BY 1, 2
    `);

    for (const row of r.rows) {
      const zone = formatDisplayRegion(row.region);
      if (!branch.has(zone)) continue;
      const m = branch.get(zone)!;
      m.open += row.open_n;
      m.solved += row.solved_n;
      m.total += row.total_nc;
      if (isMondelez(row.account) && zone !== 'WEST ZONE') {
        const ml = mondelez.get(zone)!;
        ml.open += row.open_n;
        ml.solved += row.solved_n;
        ml.total += row.total_nc;
      }
    }
    return { branch, mondelez };
  });
}

async function main() {
  const client = await queryClientAccountSummaryForBdMis({
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    sourceCodes: ['coke', 'cadbury'],
  });

  const addCadbury = new Map<string, ZoneMetrics>();
  const addCoke = emptyZone();
  for (const z of ZONES) addCadbury.set(z, emptyZone());

  for (const a of client) {
    const acct = (a.account ?? '').toLowerCase();
    const zone = formatDisplayRegion(a.region);
    if (acct === 'cadbury' && zone !== 'WEST ZONE' && addCadbury.has(zone)) {
      const m = addCadbury.get(zone)!;
      m.open = openCallsFromTotals(a);
      m.solved = a.total_solved ?? 0;
      m.total = a.total_calls ?? 0;
    }
    if (acct === 'coke') {
      addCoke.open += openCallsFromTotals(a);
      addCoke.solved += a.total_solved ?? 0;
      addCoke.total += a.total_calls ?? 0;
    }
  }

  const csvCrm = loadCrmFromCsv();
  const dbCrm = await loadCrmFromDbPlantMap();

  const uCsvCrm = unionOpen(csvCrm.branch, csvCrm.mondelez, addCadbury, addCoke);
  const uDbCrm = unionOpen(dbCrm.branch, dbCrm.mondelez, addCadbury, addCoke);

  console.log('=== Union OPEN rebuild (same Cadbury+Coke from portal DB) ===\n');
  console.log(
    'Source'.padEnd(28),
    'Grand'.padStart(6),
    'Δ vs Excel'.padStart(12)
  );
  console.log(
    'Excel Summary'.padEnd(28),
    String(EXCEL_OPEN.GRAND).padStart(6),
    String(0).padStart(12)
  );
  console.log(
    'CRM=CSV region + portal client'.padEnd(28),
    String(uCsvCrm.grand).padStart(6),
    String(uCsvCrm.grand - EXCEL_OPEN.GRAND).padStart(12)
  );
  console.log(
    'CRM=DB plant map + portal client'.padEnd(28),
    String(uDbCrm.grand).padStart(6),
    String(uDbCrm.grand - EXCEL_OPEN.GRAND).padStart(12)
  );

  console.log('\n=== By zone: Excel vs CSV-region union vs Plant-map union ===');
  for (const zone of ZONES) {
    const ex = EXCEL_OPEN[zone];
    const a = uCsvCrm.byZone.get(zone) ?? 0;
    const b = uDbCrm.byZone.get(zone) ?? 0;
    console.log(
      `${zone}: Excel ${ex} | CSV-region union ${a} (Δ${a - ex}) | Plant-map union ${b} (Δ${b - ex})`
    );
  }

  console.log('\n=== CRM open only (no client layer) — CSV region vs plant map ===');
  let csvOpen = 0;
  let dbOpen = 0;
  for (const zone of ZONES) {
    const co = csvCrm.branch.get(zone)!.open;
    const po = dbCrm.branch.get(zone)!.open;
    csvOpen += co;
    dbOpen += po;
    if (co !== po) console.log(`  ${zone}: CSV region ${co} | plant map ${po} | Δ${po - co}`);
  }
  console.log(`  GRAND CRM open: CSV ${csvOpen} | plant ${dbOpen} | Δ${dbOpen - csvOpen}`);

  console.log('\n=== Client layer open (portal import) ===');
  let cadOpen = 0;
  for (const zone of ZONES) {
    if (zone === 'WEST ZONE') continue;
    const o = addCadbury.get(zone)!.open;
    cadOpen += o;
    console.log(`  Cadbury ${zone}: ${o} open`);
  }
  console.log(`  Coke (South): ${addCoke.open} open`);
  console.log(`  Client total open: ${cadOpen + addCoke.open}`);

  const mlOpen = [...csvCrm.mondelez.values()].reduce((s, m) => s + m.open, 0);
  console.log(`  Mondelez subtract (CSV region): ${mlOpen} open removed from CRM`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
