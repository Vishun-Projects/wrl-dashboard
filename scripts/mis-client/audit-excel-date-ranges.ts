/**
 * Check date ranges in Raw files — is HCCB/Coke from Dec while CRM from Jan?
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import XLSX from 'xlsx';
import { parseClientDate } from '@/features/mis-import/lib/parse-dates';

const RAW = process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

function parseCrmDate(s: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function tallyMonths(dates: Date[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of dates) {
    const k = monthKey(d);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function printMonths(label: string, months: Map<string, number>) {
  const sorted = [...months.entries()].sort();
  const min = sorted[0]?.[0];
  const max = sorted[sorted.length - 1]?.[0];
  console.log(`\n${label}`);
  console.log(`  Range: ${min} → ${max} | rows: ${[...months.values()].reduce((a, b) => a + b, 0)}`);
  const dec25 = months.get('2025-12') ?? 0;
  const jan26 = months.get('2026-01') ?? 0;
  console.log(`  Dec 2025: ${dec25} | Jan 2026: ${jan26}`);
  if (dec25 > 0 && jan26 > 0) console.log(`  ⚠ Includes BOTH Dec-25 and Jan-26`);
  else if (dec25 > 0 && jan26 === 0) console.log(`  ⚠ Dec-25 ONLY (no Jan)`);
  console.log('  By month:', Object.fromEntries(sorted.slice(0, 8)));
  if (sorted.length > 8) console.log('   ...', sorted.length - 8, 'more months');
}

// CRM CSV
const crmPath = join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv');
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
const crmLines = readFileSync(crmPath, 'utf8').split(/\r?\n/).filter(Boolean);
const crmHeaders = parseCsvLine(crmLines[0]);
const crmDateIdx = crmHeaders.indexOf('Date');
const crmDates: Date[] = [];
for (let i = 1; i < crmLines.length; i++) {
  const cols = parseCsvLine(crmLines[i]);
  if (cols[crmHeaders.indexOf('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
  const d = parseCrmDate(cols[crmDateIdx] ?? '');
  if (d) crmDates.push(d);
}
printMonths('CRM CSV (all BREAKDOWN)', tallyMonths(crmDates));

// CRM Coke South only
const crmCokeDates: Date[] = [];
for (let i = 1; i < crmLines.length; i++) {
  const cols = crmLines[i].match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
  if (cols[crmHeaders.indexOf('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
  const acc = (cols[crmHeaders.indexOf('Account')] ?? '').toLowerCase();
  const reg = cols[crmHeaders.indexOf('Region')] ?? '';
  if (!reg.includes('SOUTH')) continue;
  if (acc !== 'coke' && acc !== 'coke oya' && acc !== 'hccb') continue;
  const d = parseCrmDate(cols[crmDateIdx] ?? '');
  if (d) crmCokeDates.push(d);
}
printMonths('CRM South Coke-family', tallyMonths(crmCokeDates));

// Cadbury
const cadText = readFileSync(join(RAW, 'Cadbury.csv'), 'utf16le').replace(/^\uFEFF/, '');
const cadLines = cadText.split(/\r?\n/).filter(Boolean);
const cadHeaders = cadLines[0].split('|').map((h) => h.replace(/^"|"$/g, '').replace(/^\./, ''));
const cadDates: Date[] = [];
for (let i = 1; i < cadLines.length; i++) {
  const cols = cadLines[i].split('|').map((c) => c.replace(/^"|"$/g, ''));
  const row: Record<string, string> = {};
  cadHeaders.forEach((h, j) => {
    row[h] = cols[j] ?? '';
  });
  const d = parseClientDate(row.VDate ?? '');
  if (d) cadDates.push(d);
}
printMonths('Cadbury.csv (all rows)', tallyMonths(cadDates));
const cadBeforeJan = cadDates.filter((d) => d < new Date('2026-01-01')).length;
console.log(`  Cadbury rows before Jan 1, 2026: ${cadBeforeJan}`);

// HCCB
const wb = XLSX.readFile(join(RAW, 'HCCB.xlsx'), { cellDates: true });
const hccbRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
  defval: '',
  range: 4,
});
const hccbDates: Date[] = [];
for (const r of hccbRows) {
  const v = r['Call Log Date'];
  const d = v instanceof Date ? v : parseClientDate(String(v ?? ''));
  if (d) hccbDates.push(d);
}
printMonths('HCCB.xlsx (all rows)', tallyMonths(hccbDates));

// HCCB in MIS window Jan 1 - Jun 29
const ytdStart = new Date('2026-01-01');
const ytdEnd = new Date('2026-06-29T23:59:59');
const hccbYtd = hccbDates.filter((d) => d >= ytdStart && d <= ytdEnd);
const hccbDec = hccbDates.filter((d) => d < ytdStart);
console.log(`\nHCCB split for MIS YTD (Jan 1 – Jun 29):`);
console.log(`  In range: ${hccbYtd.length}`);
console.log(`  Before Jan 1 (e.g. Dec 2025): ${hccbDec.length}`);
if (hccbDec.length) {
  printMonths('HCCB rows BEFORE Jan 1, 2026', tallyMonths(hccbDec));
}

// Excel Summary regional row
const misWb = XLSX.readFile(join(RAW, 'New_BD_MIS_30.06.2026.xlsx'), { cellDates: true });
const summary = XLSX.utils.sheet_to_json(misWb.Sheets['Summary'], { header: 1, defval: '' }) as unknown[][];
console.log('\n=== Excel Summary regional rows ===');
for (let i = 0; i < Math.min(10, summary.length); i++) {
  const r = summary[i] as unknown[];
  const label = String(r[0] ?? '').trim().toUpperCase();
  if (['NORTH', 'EAST', 'WEST', 'SOUTH', 'TOTAL'].includes(label)) {
    console.log(
      `  ${label}: total=${r[1]} solved=${r[2]} open=${r[3]} age2=${r[4]} age3=${r[5]} age7=${r[6]} age15=${r[7]} eng=${r[8]}`
    );
  }
}
for (const r of summary) {
  if (String(r[12] ?? '').trim() === 'South' && String(r[13] ?? '').trim() === 'HCCB') {
    console.log(`\nExcel Key Account South | HCCB: total=${r[14]} solved=${r[15]} open=${r[16]}`);
    console.log(`  HCCB file all rows: 30774 | Portal YTD Jan1-Jun29: 30698 | Delta: ${30774 - 30698} (likely Dec + Jun30)`);
  }
}
