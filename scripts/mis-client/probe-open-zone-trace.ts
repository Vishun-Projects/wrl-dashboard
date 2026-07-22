/**
 * Pin down +14 open: CRM CSV vs hot vs client files vs Excel per zone.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/features/mis-import/lib/aggregate';
import {
  buildBdMisRegionalBreakdown,
  openCallsFromTotals,
} from '@/features/report/lib/bd-mis-summary';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';
const CRM_CSV = `${RAW}/CRM_WRL_MIS_Register_2026-06-30.csv`;
const CADBURY = `${RAW}/Cadbury.csv`;
const HCCB = `${RAW}/HCCB.xlsx`;
const EXCEL = `${RAW}/New_BD_MIS_30.06.2026.xlsx`;
const END = '2026-06-29';

const ZONES = ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'] as const;
const EXCEL_OPEN: Record<string, number> = {
  'NORTH ZONE': 2501,
  'EAST ZONE': 1496,
  'WEST ZONE': 1542,
  'SOUTH ZONE': 3234,
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

function classifyCrmCsv(status: string, solvedDate: string): 'open' | 'solved' | 'cancelled' {
  const lower = status.trim().toLowerCase();
  if (lower === 'cancelled' || lower.includes('cancel')) return 'cancelled';
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

function zoneKey(region: string): string {
  return formatDisplayRegion(region);
}

function countCrmCsvByZone(): Map<string, { open: number; solved: number; total: number }> {
  const lines = readFileSync(CRM_CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const map = new Map<string, { open: number; solved: number; total: number }>();
  for (const z of ZONES) map.set(z, { open: 0, solved: 0, total: 0 });

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > END) continue;
    const office = (c[idx('Branch')] ?? '').toUpperCase();
    if (office.includes('PRACTICE') || office.includes('WINMAX')) continue;
    const bucket = classifyCrmCsv(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? '');
    if (bucket === 'cancelled') continue;
    const zone = zoneKey(c[idx('Region')] ?? '');
    if (!map.has(zone)) continue;
    const m = map.get(zone)!;
    m.total++;
    if (bucket === 'open') m.open++;
    else m.solved++;
  }
  return map;
}

/** Excel Pending sheet TRNs by zone (if present). */
function loadExcelPendingByZone(): Map<string, number> | null {
  if (!existsSync(EXCEL)) return null;
  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  if (!wb.SheetNames.includes('Pending')) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Pending'], { header: 1, defval: '' }) as unknown[][];
  const map = new Map<string, number>();
  for (const z of ZONES) map.set(z, 0);
  const h = rows[0] as unknown[];
  const regionIdx = h.findIndex((x) => String(x).toLowerCase().includes('region'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const zone = zoneKey(String(r[regionIdx >= 0 ? regionIdx : 0] ?? ''));
    if (!map.has(zone)) continue;
    map.set(zone, (map.get(zone) ?? 0) + 1);
  }
  return map;
}

async function main() {
  const csvByZone = countCrmCsvByZone();
  let csvOpenGrand = 0;
  for (const z of ZONES) csvOpenGrand += csvByZone.get(z)?.open ?? 0;

  const p = {
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };
  const crm = await queryBdMisCrmSummary(p);
  const client = await queryClientAccountSummaryForBdMis({ ...p, sourceCodes: ['coke', 'cadbury'] });
  const breakdown = buildBdMisRegionalBreakdown({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });

  const hotByZone = await withAppClient(async (c) => {
    const r = await c.query<{ region: string; open_n: number; csv_region_open: number }>(`
      SELECT
        COALESCE(p.region_zone, upper(trim(h.region))) AS region,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      GROUP BY 1
    `);
    return new Map(r.rows.map((row) => [zoneKey(row.region), row.open_n]));
  });

  const excelPending = loadExcelPendingByZone();

  console.log('=== Open calls by zone: morning CSV vs hot (plant map) vs union vs Excel ===\n');
  console.log(
    'Zone'.padEnd(12),
    'CSV'.padStart(6),
    'Hot'.padStart(6),
    'Δ H-C'.padStart(6),
    'Union'.padStart(6),
    'Excel'.padStart(6),
    'Δ U-E'.padStart(6)
  );

  let sumCsv = 0;
  let sumHot = 0;
  let sumUnion = 0;
  let sumExcel = 0;

  for (const zone of ZONES) {
    const csv = csvByZone.get(zone)?.open ?? 0;
    const hot = hotByZone.get(zone) ?? 0;
    const union = breakdown.find((b) => b.region === zone)!.result.open_calls;
    const excel = EXCEL_OPEN[zone];
    sumCsv += csv;
    sumHot += hot;
    sumUnion += union;
    sumExcel += excel;
    console.log(
      zone.replace(' ZONE', '').padEnd(12),
      String(csv).padStart(6),
      String(hot).padStart(6),
      String(hot - csv).padStart(6),
      String(union).padStart(6),
      String(excel).padStart(6),
      String(union - excel).padStart(6)
    );
  }
  console.log(
    'GRAND'.padEnd(12),
    String(sumCsv).padStart(6),
    String(sumHot).padStart(6),
    String(sumHot - sumCsv).padStart(6),
    String(sumUnion).padStart(6),
    String(sumExcel).padStart(6),
    String(sumUnion - sumExcel).padStart(6)
  );

  console.log('\n=== Union layer detail (open = total − solved) ===');
  for (const b of breakdown) {
    const crmO = openCallsFromTotals(b.crmBranchBase);
    const subO = openCallsFromTotals(b.subtractCrmCadbury);
    const addCadO = openCallsFromTotals(b.addClientCadbury);
    const addCokeO = openCallsFromTotals(b.addClientCoke);
    console.log(
      `${b.region}: ${b.result.open_calls} = CRM ${crmO} − Mondelez ${subO} + Cadbury ${addCadO} + Coke ${addCokeO}`
    );
  }

  if (excelPending) {
    let ep = 0;
    for (const z of ZONES) ep += excelPending.get(z) ?? 0;
    console.log(`\nExcel Pending sheet grand open: ${ep} (Summary says ${sumExcel})`);
  }

  console.log('\n=== Conclusion hints ===');
  console.log(`CRM CSV morning open (no plant remap): ${sumCsv}`);
  console.log(`CRM hot open (plant remap):            ${sumHot} (Δ vs CSV ${sumHot - sumCsv})`);
  console.log(`Client layer adds to union:            ${sumUnion - sumHot} net open`);
  console.log(`Excel expects union:                   ${sumExcel}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
