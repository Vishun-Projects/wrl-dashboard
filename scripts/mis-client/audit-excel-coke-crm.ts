/**
 * Audit reference Excel: is Coke/HCCB double-counted from CRM + client files?
 *
 * Usage: npx tsx scripts/mis-client/audit-excel-coke-crm.ts [format-xlsx] [bd-mis-xlsx]
 */
import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const FORMAT =
  process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Testing/Format.xlsx';
const BD_MIS =
  process.argv[3] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';
const CRM_CSV =
  process.argv[4] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

function normKey(v: string): string {
  return v.trim().replace(/^0+/, '').toLowerCase();
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

function parseCrmDate(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

const START = new Date('2026-01-01T00:00:00');
const END = new Date('2026-06-29T23:59:59');

function inRange(d: Date | null): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= START && d <= END;
}

function auditFormatMain(path: string) {
  if (!existsSync(path)) {
    console.log(`Format not found: ${path}`);
    return null;
  }
  const wb = XLSX.readFile(path, { cellDates: true });
  const main = XLSX.utils.sheet_to_json(wb.Sheets['Main'], { header: 1, defval: '' }) as unknown[][];
  const header = main[0] as string[];
  const idx = (n: string) => header.findIndex((h) => String(h).trim().toLowerCase() === n.toLowerCase());

  const clientIdx = idx('Client');
  const regionIdx = idx('Region');
  const accountIdx = idx('Account');
  const fileIdx = idx('File Name');

  const crmCokeByZone = new Map<string, number>();
  const hccbByZone = new Map<string, number>();
  const crmCokeAccountCol = new Map<string, number>();

  for (let i = 1; i < main.length; i++) {
    const r = main[i] as unknown[];
    const client = String(r[clientIdx] ?? '').trim().toLowerCase();
    const zone = formatDisplayRegion(String(r[regionIdx] ?? ''));
    const account = String(r[accountIdx] ?? '').trim().toLowerCase();
    const file = String(r[fileIdx] ?? '').trim();

    if (client === 'hccb') {
      hccbByZone.set(zone, (hccbByZone.get(zone) ?? 0) + 1);
    } else if (client !== 'mondelez') {
      // CRM row in Main
      if (account === 'coke' || account === 'hccb') {
        crmCokeByZone.set(zone, (crmCokeByZone.get(zone) ?? 0) + 1);
        crmCokeAccountCol.set(`${account}::${zone}`, (crmCokeAccountCol.get(`${account}::${zone}`) ?? 0) + 1);
      }
    }
  }

  console.log('=== Format.Main: Coke/HCCB in CRM rows (should be subtracted in South) ===');
  for (const z of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    const crmCoke = crmCokeByZone.get(z) ?? 0;
    const hccb = hccbByZone.get(z) ?? 0;
    console.log(`  ${z}: CRM Coke/HCCB rows=${crmCoke}, HCCB client rows=${hccb}`);
    if (crmCoke > 0 && z !== 'SOUTH ZONE') {
      console.log(`    ⚠ CRM Coke/HCCB outside South — should NOT be in BD MIS if using client HCCB`);
    }
    if (crmCoke > 0 && hccb > 0 && z === 'SOUTH ZONE') {
      console.log(`    ⚠ South has BOTH CRM Coke (${crmCoke}) AND HCCB client (${hccb}) — correct formula must subtract CRM Coke`);
    }
  }

  console.log('\n  CRM Coke/HCCB by account × zone:');
  for (const [k, n] of [...crmCokeAccountCol.entries()].sort()) {
    console.log(`    ${k}: ${n}`);
  }

  return { crmCokeByZone, hccbByZone };
}

function auditCrmCsv(path: string) {
  if (!existsSync(path)) {
    console.log(`CRM CSV not found: ${path}`);
    return;
  }
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const col = (n: string) => headers.indexOf(n);

  const byAccountZone = new Map<string, number>();
  let cokeTotal = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols[col('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
    if ((cols[col('Status')] ?? '').toLowerCase() === 'cancelled') continue;
    const d = parseCrmDate(cols[col('Date')] ?? '');
    if (!inRange(d)) continue;
    const account = (cols[col('Account')] ?? '').trim().toLowerCase();
    const zone = formatDisplayRegion(cols[col('Region')] ?? '');
    if (account !== 'coke' && account !== 'hccb') continue;
    cokeTotal++;
    const k = `${account}::${zone}`;
    byAccountZone.set(k, (byAccountZone.get(k) ?? 0) + 1);
  }

  console.log('\n=== CRM CSV: Coke/HCCB account rows (Jan 1 – Jun 29) ===');
  console.log(`  Total Coke/HCCB in CRM: ${cokeTotal}`);
  for (const [k, n] of [...byAccountZone.entries()].sort()) {
    console.log(`    ${k}: ${n}`);
  }
  const south = (byAccountZone.get('coke::SOUTH ZONE') ?? 0) + (byAccountZone.get('hccb::SOUTH ZONE') ?? 0);
  const nonSouth = cokeTotal - south;
  if (nonSouth > 0) {
    console.log(`\n  ⚠ ${nonSouth} Coke/HCCB CRM rows are OUTSIDE South — HCCB file only replaces South Coke`);
  }
}

function auditBdMisSummary(path: string) {
  if (!existsSync(path)) {
    console.log(`BD MIS not found: ${path}`);
    return;
  }
  const wb = XLSX.readFile(path, { cellDates: true });
  console.log(`\n=== ${path.split('/').pop()} sheets ===`);
  console.log('  ', wb.SheetNames.join(', '));

  const summaryName = wb.SheetNames.find((n) => /summary/i.test(n)) ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[summaryName], { header: 1, defval: '' }) as unknown[][];
  console.log(`\n=== ${summaryName} (first 25 rows) ===`);
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const line = (rows[i] as unknown[]).map((c) => String(c).slice(0, 24)).join(' | ');
    if (line.trim()) console.log(`  ${line}`);
  }

  // Formula sheet if present
  if (wb.SheetNames.includes('Formula')) {
    const formula = XLSX.utils.sheet_to_json(wb.Sheets['Formula'], { header: 1, defval: '' }) as unknown[][];
    console.log('\n=== Formula sheet (Coke/Cadbury related lines) ===');
    for (let i = 0; i < formula.length; i++) {
      const row = formula[i] as unknown[];
      const joined = row.map((c) => String(c)).join(' ');
      if (/coke|hccb|cadbury|mondelez|subtract|exclude|crm/i.test(joined)) {
        console.log(`  row ${i + 1}: ${row.map((c) => String(c).slice(0, 50)).join(' | ')}`);
      }
    }
  }
}

console.log('Excel Coke/CRM audit\n');
auditFormatMain(FORMAT);
auditCrmCsv(CRM_CSV);
auditBdMisSummary(BD_MIS);

console.log('\n=== Portal rule (correct — do not change) ===');
console.log('  South: CRM branch total − CRM Coke/HCCB account + HCCB client import');
console.log('  Other zones: CRM only (no HCCB); Cadbury swap N/E/S only');
