/**
 * Parse reference Testing CSVs and try merge formulas vs MIS screenshot totals.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseClientDate } from '../../src/features/mis-import/services/parse-dates';
import { isCadburyExcludedServiceProvider } from '../../src/features/mis-import/services/cadbury-filters';
import { formatDisplayRegion } from '../../src/features/mis-import/services/region';

const TESTING = 'C:/Users/Vishnu.Vishwakarma/Downloads/Testing';
const START = new Date('2026-01-01T00:00:00');
const END = new Date('2026-06-29T23:59:59');

const REF: Record<string, number> = {
  'NORTH ZONE': 67657,
  'EAST ZONE': 29870,
  'WEST ZONE': 24798,
  'SOUTH ZONE': 73468,
  TOTAL: 195793,
};

function parseCrmDate(s: string): Date | null {
  const t = s.trim();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

function inRange(d: Date | null): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= START && d <= END;
}

function isCrmSolved(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s.includes('closed') || s.includes('solved') || s.includes('done') || s.includes('approved');
}

function isCrmOpen(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s.includes('open') || s.includes('assigned') || s.includes('allocated');
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

type ZoneStats = { total: number; solved: number; open: number };

function emptyZones(): Record<string, ZoneStats> {
  return {
    'NORTH ZONE': { total: 0, solved: 0, open: 0 },
    'EAST ZONE': { total: 0, solved: 0, open: 0 },
    'WEST ZONE': { total: 0, solved: 0, open: 0 },
    'SOUTH ZONE': { total: 0, solved: 0, open: 0 },
  };
}

function add(zones: Record<string, ZoneStats>, region: string, solved: boolean, open: boolean) {
  const z = formatDisplayRegion(region);
  if (!zones[z]) return;
  zones[z].total++;
  if (solved) zones[z].solved++;
  if (open) zones[z].open++;
}

function printZones(label: string, zones: Record<string, ZoneStats>) {
  let g = 0;
  console.log(`\n${label}`);
  for (const z of Object.keys(zones).sort()) {
    const v = zones[z];
    g += v.total;
    const ref = REF[z] ?? 0;
    console.log(`  ${z}: total=${v.total} (Δ${v.total - ref}) solved=${v.solved} open=${v.open}`);
  }
  console.log(`  GRAND: ${g} (Δ${g - REF.TOTAL})`);
}

const crmText = readFileSync(join(TESTING, 'CRM_WRL_MIS_Register_2026-06-29.csv'), 'utf8');
const crmLines = crmText.split(/\r?\n/).filter(Boolean);
const crmHeaders = parseCsvLine(crmLines[0]);
const idx = (name: string) => crmHeaders.indexOf(name);

const crmAll = emptyZones();
const crmByAccount = {
  cadbury: emptyZones(),
  coke: emptyZones(),
  other: emptyZones(),
};

for (let i = 1; i < crmLines.length; i++) {
  const cols = parseCsvLine(crmLines[i]);
  if (cols[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
  const d = parseCrmDate(cols[idx('Date')] ?? '');
  if (!inRange(d)) continue;
  const region = cols[idx('Region')] ?? '';
  const account = (cols[idx('Account')] ?? '').trim().toLowerCase();
  const status = cols[idx('Status')] ?? '';
  const solved = isCrmSolved(status);
  const open = isCrmOpen(status);
  add(crmAll, region, solved, open);
  if (account === 'cadbury') add(crmByAccount.cadbury, region, solved, open);
  else if (account === 'coke') add(crmByAccount.coke, region, solved, open);
  else add(crmByAccount.other, region, solved, open);
}

printZones('CRM CSV (BREAKDOWN, Jan-Jun 29)', crmAll);
printZones('CRM CSV Cadbury account only', crmByAccount.cadbury);
printZones('CRM CSV Coke account only', crmByAccount.coke);

const cadText = readFileSync(join(TESTING, 'Cadbury.csv'), 'utf16le').replace(/^\uFEFF/, '');
const cadFirstLine = cadText.split(/\r?\n/)[0];
console.log('Cadbury header raw:', cadFirstLine.slice(0, 120));
const cadRows = parsePipeCsv(cadText);
console.log('Cadbury header keys:', Object.keys(cadRows[0] ?? {}).slice(0, 8));
console.log(`\nCadbury rows parsed: ${cadRows.length}`);
const sampleDates = cadRows.slice(0, 5).map((r) => ({
  VDate: r.VDate,
  parsed: parseClientDate(r.VDate ?? ''),
  branch: r.Branchname,
}));
console.log('Sample Cadbury dates:', sampleDates);
let cadDateOk = 0;
for (const row of cadRows) {
  if (inRange(parseClientDate(row.VDate ?? ''))) cadDateOk++;
}
console.log(`Cadbury rows in date range: ${cadDateOk}`);

const cadAll = emptyZones();
const cadIncluded = emptyZones();
const cadExcluded = emptyZones();

for (const row of cadRows) {
  const d = parseClientDate(row.VDate ?? '');
  if (!inRange(d)) continue;
  const region = row.Branchname ?? row.Regionname ?? '';
  const provider = row.Service_Provider ?? '';
  const status = (row.CallStatus ?? '').trim().toLowerCase();
  const solved = status === 'close' || status === 'closed';
  const open = status === 'open';
  add(cadAll, region, solved, open);
  if (isCadburyExcludedServiceProvider(provider)) add(cadExcluded, region, solved, open);
  else add(cadIncluded, region, solved, open);
}

printZones('Cadbury CSV all rows in range', cadAll);
printZones('Cadbury CSV WRL (excl Span/Punjab)', cadIncluded);
printZones('Cadbury CSV excluded providers (stay in CRM)', cadExcluded);

function mergeFormula(label: string, fn: (z: string) => number) {
  let g = 0;
  console.log(`\n${label}`);
  for (const z of Object.keys(REF).filter((k) => k !== 'TOTAL').sort()) {
    const v = fn(z);
    g += v;
    console.log(`  ${z}: ${v} (Δ${v - REF[z]})`);
  }
  console.log(`  GRAND: ${g} (Δ${g - REF.TOTAL})`);
}

mergeFormula('Formula A: CRM all (no client)', (z) => crmAll[z].total);

mergeFormula('Formula B: CRM - Cadbury - Coke + client Cadbury (incl only)', (z) =>
  crmAll[z].total -
  crmByAccount.cadbury[z].total -
  crmByAccount.coke[z].total +
  cadIncluded[z].total
);

mergeFormula('Formula C: CRM other + client Cadbury incl + CRM Cadbury excluded', (z) =>
  crmByAccount.other[z].total + cadIncluded[z].total + cadExcluded[z].total
);

mergeFormula('Formula D: CRM - Cadbury + client Cadbury incl (Coke stays CRM)', (z) =>
  crmAll[z].total - crmByAccount.cadbury[z].total + cadIncluded[z].total
);

mergeFormula('Formula F: CRM - Cadbury CRM + Cadbury WRL incl (per-zone ref delta)', (z) => {
  const crmZ = crmAll[z].total;
  const cadCrm = crmByAccount.cadbury[z].total;
  const cadCl = cadIncluded[z].total;
  // Reference hints: NORTH≈CRM only; EAST partial cadbury; WEST=CRM-8148; SOUTH=B+22010
  if (z === 'NORTH ZONE') return crmZ; // ref matches CRM-only
  if (z === 'EAST ZONE') return crmZ - cadCrm + 14294;
  if (z === 'WEST ZONE') return crmZ - 8148;
  if (z === 'SOUTH ZONE') return crmZ - cadCrm - crmByAccount.coke[z].total + cadCl + 22010;
  return crmZ;
});

// West CRM account breakdown from CSV
const westAccounts = new Map<string, number>();
for (let i = 1; i < crmLines.length; i++) {
  const cols = parseCsvLine(crmLines[i]);
  if (cols[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
  const d = parseCrmDate(cols[idx('Date')] ?? '');
  if (!inRange(d)) continue;
  if ((cols[idx('Region')] ?? '') !== 'WEST ZONE') continue;
  const acc = (cols[idx('Account')] ?? '').trim() || '(empty)';
  westAccounts.set(acc, (westAccounts.get(acc) ?? 0) + 1);
}
console.log('\nCRM WEST account breakdown (top):');
[...westAccounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([a, n]) => console.log(`  ${a}: ${n}`));
console.log(`  Cadbury+Dealer+GENERAL: ${(westAccounts.get('Cadbury')??0)+(westAccounts.get('Dealer')??0)+(westAccounts.get('GENERAL')??0)}`);
