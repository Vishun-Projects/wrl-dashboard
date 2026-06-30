/**
 * Investigate ~30k gap between BD MIS Excel and portal CRM subset.
 * Usage: npx tsx scripts/mis-client/investigate-crm-gap.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { prisma } from '@/lib/db/prisma';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryFiltered } from '@/lib/mis-client-import/aggregate';
import {
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
} from '@/lib/report/bd-mis-summary';
import { parseClientDate } from '@/lib/mis-client-import/parse-dates';
import { isCadburyExcludedServiceProvider } from '@/lib/mis-client-import/cadbury-filters';
import { formatDisplayRegion } from '@/lib/mis-client-import/region';

const TESTING = 'C:/Users/Vishnu.Vishwakarma/Downloads/Testing';
const FORMAT = join(TESTING, 'Format.xlsx');
const START = new Date('2026-01-01T00:00:00');
const END = new Date('2026-06-29T23:59:59');

const REF = {
  'NORTH ZONE': 67657,
  'EAST ZONE': 29870,
  'WEST ZONE': 24798,
  'SOUTH ZONE': 73468,
  TOTAL: 195793,
};

function inRange(d: Date | null): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= START && d <= END;
}

function parseCrmDate(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
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

function parsePipeCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split('|').map((h) => h.replace(/^"|"$/g, '').replace(/^\./, ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('|').map((c) => c.replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cols[j] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function normKey(v: string): string {
  return v.trim().replace(/^0+/, '').toLowerCase();
}

function inspectFormatXlsx() {
  if (!existsSync(FORMAT)) {
    console.log('Format.xlsx not found, skipping');
    return;
  }
  const wb = XLSX.readFile(FORMAT, { cellDates: true });
  console.log('=== Format.xlsx sheets ===');
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];
    console.log(`  ${name}: ${rows.length} rows`);
  }

  const main = XLSX.utils.sheet_to_json(wb.Sheets['Main'], { header: 1, defval: '' }) as unknown[][];
  const header = (main[0] ?? []) as unknown[];
  console.log('\nMain header:', header.join(' | '));

  const colIdx = (label: string) =>
    header.findIndex((h) => String(h).trim().toLowerCase() === label.toLowerCase());

  const clientCol = colIdx('Client');
  const regionCol = colIdx('Region');
  const statusCol = colIdx('Call Status');
  const soCol = colIdx('Service Order');

  const byClient = new Map<string, number>();
  const byClientRegion = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const serviceOrders = new Set<string>();

  for (let i = 1; i < main.length; i++) {
    const r = main[i] as unknown[];
    const client = String(r[clientCol] ?? '').trim() || '(blank)';
    const region = String(r[regionCol] ?? '').trim().toUpperCase();
    const status = String(r[statusCol] ?? '').trim();
    const so = normKey(String(r[soCol] ?? ''));
    byClient.set(client, (byClient.get(client) ?? 0) + 1);
    byClientRegion.set(`${client}::${region}`, (byClientRegion.get(`${client}::${region}`) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (so) serviceOrders.add(so);
  }

  console.log('\nFormat.Main by Client:');
  [...byClient.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k}: ${n}`));

  console.log('\nFormat.Main by Client × Region (top clients):');
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  for (const client of topClients) {
    for (const reg of ['NORTH', 'EAST', 'WEST', 'SOUTH']) {
      const n = byClientRegion.get(`${client}::${reg}`) ?? 0;
      if (n) console.log(`  ${client} / ${reg}: ${n}`);
    }
  }

  console.log(`\nFormat.Main unique service orders: ${serviceOrders.size}`);
  console.log('Top statuses:', [...byStatus.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n])=>`${k}=${n}`).join(', '));
}

async function countPostgres() {
  const params = {
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };

  const crm = await queryBdMisCrmSummary(params);
  const clientAccounts = await queryClientAccountSummaryFiltered({
    ...params,
    sourceCodes: ['coke', 'cadbury'],
  });

  const crmTotal = crm.branchSummary.reduce((s, b) => s + Number(b.total_calls ?? 0), 0);
  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: clientAccounts,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);

  console.log('\n=== Postgres (plant-mapped CRM) ===');
  console.log(`  CRM breakdown total: ${crmTotal}`);
  const byRegion = new Map<string, number>();
  for (const b of crm.branchSummary) {
    const z = formatDisplayRegion(String(b.region ?? ''));
    byRegion.set(z, (byRegion.get(z) ?? 0) + Number(b.total_calls ?? 0));
  }
  for (const z of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    console.log(`  ${z}: ${byRegion.get(z) ?? 0}`);
  }

  console.log('\n=== Portal BD MIS formula ===');
  for (const row of rows) {
    const ref = REF[row.region as keyof typeof REF] ?? 0;
    console.log(`  ${row.region}: ${row.total_calls} (ref ${ref}, Δ${row.total_calls - ref})`);
  }
  console.log(`  GRAND: ${grand.total_calls} (ref ${REF.TOTAL}, Δ${grand.total_calls - REF.TOTAL})`);

  const rawCount = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );
  console.log(`\n  Raw CRM (no plant remap): ${rawCount[0].n}`);

  const plantMapped = await prisma.$queryRawUnsafe<Array<{ region: string; n: number }>>(
    `SELECT COALESCE(p.region_zone, upper(trim(h.region))) AS region, count(*)::int AS n
     FROM calls_latest_hot h
     LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
     GROUP BY 1 ORDER BY 1`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );
  console.log('\n  Plant-mapped CRM by region:');
  for (const r of plantMapped) console.log(`    ${r.region}: ${r.n}`);
}

function loadCrmCsvKeys(): {
  all: Set<string>;
  byRegion: Map<string, Set<string>>;
  byAccount: Map<string, Set<string>>;
  total: number;
} {
  const path = join(TESTING, 'CRM_WRL_MIS_Register_2026-06-29.csv');
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const all = new Set<string>();
  const byRegion = new Map<string, Set<string>>();
  const byAccount = new Map<string, Set<string>>();
  let total = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
    const d = parseCrmDate(cols[idx('Date')] ?? '');
    if (!inRange(d)) continue;
    const region = formatDisplayRegion(cols[idx('Region')] ?? '');
    const account = (cols[idx('Account')] ?? '').trim().toLowerCase();
    const so = normKey(
      cols[idx('ID')] ?? cols[idx('Call Centre ID')] ?? cols[idx('Service Order')] ?? ''
    );
    if (!so) continue;
    total++;
    all.add(so);
    if (!byRegion.has(region)) byRegion.set(region, new Set());
    byRegion.get(region)!.add(so);
    if (!byAccount.has(account)) byAccount.set(account, new Set());
    byAccount.get(account)!.add(so);
  }
  return { all, byRegion, byAccount, total };
}

function loadCadburyKeys(): Set<string> {
  const path = join(TESTING, 'Cadbury.csv');
  const text = readFileSync(path, 'utf16le').replace(/^\uFEFF/, '');
  const rows = parsePipeCsv(text);
  const keys = new Set<string>();
  for (const row of rows) {
    const d = parseClientDate(row.VDate ?? '');
    if (!inRange(d)) continue;
    if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
    const ticket = normKey(row.TicketNumber ?? row['.TicketNumber'] ?? '');
    if (ticket) keys.add(ticket);
  }
  return keys;
}

function loadHccbKeys(): Set<string> {
  const path = join(TESTING, 'HCCB.xlsx');
  const wb = XLSX.readFile(path, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', range: 4 });
  const keys = new Set<string>();
  for (const row of rows) {
    const dateVal = row['Call Log Date'] ?? row['VDate'] ?? '';
    const d = dateVal instanceof Date ? dateVal : parseClientDate(String(dateVal));
    if (!inRange(d)) continue;
    const so = normKey(String(row['Call No'] ?? row['Service Order'] ?? ''));
    if (so) keys.add(so);
  }
  return keys;
}

function analyzeDedup() {
  console.log('\n=== Service-order dedup analysis (reference CSVs) ===');
  const crm = loadCrmCsvKeys();
  const cadbury = loadCadburyKeys();
  const hccb = loadHccbKeys();

  console.log(`CRM CSV breakdown rows: ${crm.total}`);
  console.log(`Cadbury WRL tickets: ${cadbury.size}`);
  console.log(`HCCB tickets: ${hccb.size}`);

  const clientUnion = new Set([...cadbury, ...hccb]);
  let overlapCadbury = 0;
  let overlapHccb = 0;
  let overlapBoth = 0;
  for (const k of crm.all) {
    const inC = cadbury.has(k);
    const inH = hccb.has(k);
    if (inC) overlapCadbury++;
    if (inH) overlapHccb++;
    if (inC && inH) overlapBoth++;
  }
  console.log(`\nCRM ∩ Cadbury: ${overlapCadbury}`);
  console.log(`CRM ∩ HCCB: ${overlapHccb}`);
  console.log(`CRM ∩ both: ${overlapBoth}`);
  console.log(`CRM ∩ (Cadbury ∪ HCCB): ${[...crm.all].filter((k) => clientUnion.has(k)).length}`);

  const crmMinusClient = [...crm.all].filter((k) => !clientUnion.has(k)).length;
  console.log(`\nCRM − client union (disjoint): ${crmMinusClient}`);
  console.log(`+ Cadbury: ${crmMinusClient + cadbury.size} = ${crmMinusClient + cadbury.size}`);
  console.log(`+ HCCB: ${crmMinusClient + cadbury.size + hccb.size} = ${crmMinusClient + cadbury.size + hccb.size}`);

  // Account-level subtract simulation
  const cadburyAcc = crm.byAccount.get('cadbury') ?? new Set();
  const mondelezAcc = crm.byAccount.get('mondelez') ?? new Set();
  const cokeAcc = crm.byAccount.get('coke') ?? new Set();
  const hccbAcc = crm.byAccount.get('hccb') ?? new Set();

  console.log('\nCRM account counts (CSV):');
  for (const [acc, set] of [...crm.byAccount.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10)) {
    console.log(`  ${acc}: ${set.size}`);
  }

  // Simulate Excel formula on CSV row-level
  const zones = ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'];
  console.log('\nRow-level disjoint union on CSV (CRM − overlap + client):');
  let grand = 0;
  for (const z of zones) {
    const crmZ = crm.byRegion.get(z)?.size ?? 0;
    let crmKept = 0;
    for (const k of crm.byRegion.get(z) ?? []) {
      if (!clientUnion.has(k)) crmKept++;
    }
    let cadZ = 0;
    for (const row of parsePipeCsv(readFileSync(join(TESTING, 'Cadbury.csv'), 'utf16le').replace(/^\uFEFF/, ''))) {
      const d = parseClientDate(row.VDate ?? '');
      if (!inRange(d)) continue;
      if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
      if (formatDisplayRegion(row.Branchname ?? row.Regionname ?? '') !== z) continue;
      if (z === 'WEST ZONE') continue;
      cadZ++;
    }
    let cokeZ = 0;
    if (z === 'SOUTH ZONE') {
      const wb = XLSX.readFile(join(TESTING, 'HCCB.xlsx'), { cellDates: true });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      for (const row of rows) {
        const dateVal = row['VDate'] ?? row['V Date'] ?? '';
        const d = dateVal instanceof Date ? dateVal : parseClientDate(String(dateVal));
        if (!inRange(d)) continue;
        cokeZ++;
      }
    }
    const total = crmKept + cadZ + cokeZ;
    grand += total;
    const ref = REF[z as keyof typeof REF];
    console.log(`  ${z}: CRM kept ${crmKept} + Cad ${cadZ} + Coke ${cokeZ} = ${total} (ref ${ref}, Δ${total - ref})`);
  }
  console.log(`  GRAND: ${grand} (ref ${REF.TOTAL}, Δ${grand - REF.TOTAL})`);

  // Account-swap formula on CSV
  console.log('\nAccount-swap formula on CSV (current portal logic):');
  const cadburyCrm = new Set([...cadburyAcc, ...mondelezAcc]);
  const cokeCrmSouth = new Set([...cokeAcc, ...hccbAcc]);
  let grand2 = 0;
  for (const z of zones) {
    const crmZ = crm.byRegion.get(z)?.size ?? 0;
    let sub = 0;
    if (z !== 'WEST ZONE') {
      for (const k of crm.byRegion.get(z) ?? []) {
        if (cadburyCrm.has(k)) sub++;
      }
    }
    if (z === 'SOUTH ZONE') {
      for (const k of crm.byRegion.get(z) ?? []) {
        if (cokeCrmSouth.has(k)) sub++;
      }
    }
    let cadAdd = 0;
    if (z !== 'WEST ZONE') {
      for (const row of parsePipeCsv(readFileSync(join(TESTING, 'Cadbury.csv'), 'utf16le').replace(/^\uFEFF/, ''))) {
        const d = parseClientDate(row.VDate ?? '');
        if (!inRange(d)) continue;
        if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
        if (formatDisplayRegion(row.Branchname ?? row.Regionname ?? '') !== z) continue;
        cadAdd++;
      }
    }
    let cokeAdd = z === 'SOUTH ZONE' ? hccb.size : 0;
    const total = crmZ - sub + cadAdd + cokeAdd;
    grand2 += total;
    const ref = REF[z as keyof typeof REF];
    console.log(`  ${z}: ${crmZ} - ${sub} + ${cadAdd} + ${cokeAdd} = ${total} (ref ${ref}, Δ${total - ref})`);
  }
  console.log(`  GRAND: ${grand2} (ref ${REF.TOTAL}, Δ${grand2 - REF.TOTAL})`);
}

async function checkDbClientOverlap() {
  console.log('\n=== DB client import call_key vs CRM vtrnno/vcclid ===');
  const overlap = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `
    WITH client_keys AS (
      SELECT DISTINCT ON (s.code, r.call_key)
        s.code AS source_code,
        lower(trim(regexp_replace(r.call_key, '^0+', ''))) AS call_key_norm
      FROM mis_client_import_rows r
      INNER JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      INNER JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code IN ('cadbury', 'coke')
        AND b.is_active = true
        AND r.logged_at >= $1::timestamptz AND r.logged_at <= $2::timestamptz
    ),
    crm_keys AS (
      SELECT
        lower(trim(regexp_replace(h.vtrnno, '^0+', ''))) AS k
      FROM calls_latest_hot h
      WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
      UNION
      SELECT lower(trim(regexp_replace(h.vcclid, '^0+', '')))
      FROM calls_latest_hot h
      WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.vcclid IS NOT NULL AND trim(h.vcclid) <> ''
    )
    SELECT count(DISTINCT c.call_key_norm)::int AS n
    FROM client_keys c
    INNER JOIN crm_keys k ON k.k = c.call_key_norm
    `,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  const overlapBySource = await prisma.$queryRawUnsafe<
    Array<{ source_code: string; n: number }>
  >(
    `
    WITH client_keys AS (
      SELECT DISTINCT ON (s.code, r.call_key)
        s.code AS source_code,
        lower(trim(regexp_replace(r.call_key, '^0+', ''))) AS call_key_norm
      FROM mis_client_import_rows r
      INNER JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      INNER JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code IN ('cadbury', 'coke')
        AND b.is_active = true
        AND r.logged_at >= $1::timestamptz AND r.logged_at <= $2::timestamptz
    ),
    crm_keys AS (
      SELECT lower(trim(regexp_replace(h.vtrnno, '^0+', ''))) AS k
      FROM calls_latest_hot h
      WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
      UNION
      SELECT lower(trim(regexp_replace(h.vcclid, '^0+', '')))
      FROM calls_latest_hot h
      WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.vcclid IS NOT NULL AND trim(h.vcclid) <> ''
    )
    SELECT c.source_code, count(DISTINCT c.call_key_norm)::int AS n
    FROM client_keys c
    INNER JOIN crm_keys k ON k.k = c.call_key_norm
    GROUP BY c.source_code
    `,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  const crmCadburyAccount = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND lower(trim(h.account)) IN ('cadbury', 'mondelez')`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );
  const crmCokeAccount = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND lower(trim(h.account)) IN ('coke', 'hccb')`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  const crmTotal = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );
  const clientTotal = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `
    SELECT count(*)::int AS n
    FROM (
      SELECT DISTINCT ON (s.code, r.call_key) r.id
      FROM mis_client_import_rows r
      INNER JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      INNER JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code IN ('cadbury', 'coke')
        AND b.is_active = true
        AND r.logged_at >= $1::timestamptz AND r.logged_at <= $2::timestamptz
    ) x
    `,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  console.log(`  CRM breakdown rows: ${crmTotal[0].n}`);
  console.log(`  CRM Cadbury/Mondelez account rows: ${crmCadburyAccount[0].n}`);
  console.log(`  CRM Coke/HCCB account rows: ${crmCokeAccount[0].n}`);
  console.log(`  Client import rows (active batch, date filtered): ${clientTotal[0].n}`);
  console.log(`  CRM ∩ client (by vtrnno/vcclid = call_key): ${overlap[0].n}`);
  for (const row of overlapBySource) {
    console.log(`    ${row.source_code}: ${row.n} overlapping keys`);
  }

  const disjointEstimate =
    crmTotal[0].n - overlap[0].n + clientTotal[0].n;
  console.log(`\n  Rough disjoint union (CRM - overlap + client): ${disjointEstimate}`);
  console.log(`  Excel target: ${REF.TOTAL}, Δ${disjointEstimate - REF.TOTAL}`);
}

async function main() {
  inspectFormatXlsx();
  await countPostgres();
  analyzeDedup();
  await checkDbClientOverlap();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
