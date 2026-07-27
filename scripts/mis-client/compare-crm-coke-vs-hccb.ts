/**
 * Prove whether CRM Coke/HCCB and HCCB import are the same calls or different.
 *
 * Usage: npx tsx scripts/mis-client/compare-crm-coke-vs-hccb.ts [raw-dir]
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import XLSX from 'xlsx';
import { parseClientDate } from '@/features/mis-import/lib/parse-dates';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const RAW = process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';
const START = new Date('2026-01-01T00:00:00');
const END = new Date('2026-06-29T23:59:59');

function normKey(v: string): string {
  return v.trim().replace(/^0+/, '').toLowerCase();
}

function inRange(d: Date | null): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= START && d <= END;
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

type CallRec = { key: string; account: string; zone: string; status: string; date: string };

function loadCrmCokeHccb(): Map<string, CallRec> {
  const path = join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv');
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const col = (n: string) => headers.indexOf(n);
  const map = new Map<string, CallRec>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols[col('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
    if ((cols[col('Status')] ?? '').toLowerCase() === 'cancelled') continue;
    const d = parseCrmDate(cols[col('Date')] ?? '');
    if (!inRange(d)) continue;
    const account = (cols[col('Account')] ?? '').trim().toLowerCase();
    if (account !== 'coke' && account !== 'hccb' && account !== 'coke oya') continue;

    const key = normKey(cols[col('ID')] ?? cols[col('Call Centre ID')] ?? cols[col('Service Order')] ?? '');
    if (!key) continue;

    map.set(key, {
      key,
      account,
      zone: formatDisplayRegion(cols[col('Region')] ?? ''),
      status: (cols[col('Status')] ?? '').trim(),
      date: cols[col('Date')] ?? '',
    });
  }
  return map;
}

function loadHccbImport(): Map<string, CallRec> {
  const path = join(RAW, 'HCCB.xlsx');
  const wb = XLSX.readFile(path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: '',
    range: 4,
  });
  const map = new Map<string, CallRec>();

  for (const row of rows) {
    const dateVal = row['Call Log Date'] ?? row['VDate'] ?? '';
    const d = dateVal instanceof Date ? dateVal : parseClientDate(String(dateVal));
    if (!inRange(d)) continue;
    const key = normKey(String(row['Call No'] ?? row['Service Order'] ?? ''));
    if (!key) continue;
    map.set(key, {
      key,
      account: 'hccb-import',
      zone: 'SOUTH ZONE', // HCCB beverage file is South scope
      status: String(row['Call Status'] ?? '').trim(),
      date: d.toISOString().slice(0, 10),
    });
  }
  return map;
}

function byZone(map: Map<string, CallRec>): Map<string, number> {
  const z = new Map<string, number>();
  for (const r of map.values()) {
    z.set(r.zone, (z.get(r.zone) ?? 0) + 1);
  }
  return z;
}

function main() {
  const crm = loadCrmCokeHccb();
  const hccb = loadHccbImport();

  const crmSouth = [...crm.values()].filter((r) => r.zone === 'SOUTH ZONE');
  const crmNonSouth = [...crm.values()].filter((r) => r.zone !== 'SOUTH ZONE');

  let overlapSouth = 0;
  let overlapAll = 0;
  const overlapSamples: Array<{ key: string; crm: CallRec; hccb: CallRec }> = [];
  const crmSouthOnly: CallRec[] = [];
  const hccbOnly: CallRec[] = [];

  for (const r of crmSouth) {
    const h = hccb.get(r.key);
    if (h) {
      overlapSouth++;
      if (overlapSamples.length < 5) overlapSamples.push({ key: r.key, crm: r, hccb: h });
    } else {
      crmSouthOnly.push(r);
    }
  }
  for (const [key, h] of hccb) {
    if (crm.has(key)) overlapAll++;
    else hccbOnly.push(h);
  }

  console.log('=== CRM Coke/HCCB/Coke Oya vs HCCB import (Jan 1 – Jun 29) ===\n');
  console.log(`CRM Coke-family rows:     ${crm.size}`);
  console.log(`  South:                  ${crmSouth.length}`);
  console.log(`  Non-South:              ${crmNonSouth.length}`);
  console.log(`HCCB import rows:         ${hccb.size}`);

  console.log('\nCRM Coke-family by zone:');
  for (const [z, n] of [...byZone(crm).entries()].sort()) console.log(`  ${z}: ${n}`);

  console.log('\n--- South overlap (same call key?) ---');
  console.log(`CRM South ∩ HCCB import:  ${overlapSouth} / ${crmSouth.length} CRM South`);
  console.log(`  = ${((overlapSouth / Math.max(crmSouth.length, 1)) * 100).toFixed(1)}% of CRM South Coke keys appear in HCCB file`);
  console.log(`CRM South only (not in HCCB): ${crmSouthOnly.length}`);
  console.log(`HCCB only (not in CRM Coke):  ${hccbOnly.length}`);
  console.log(`CRM all Coke ∩ HCCB:          ${overlapAll}`);

  if (overlapSamples.length) {
    console.log('\nSample matching keys (same call, two systems):');
    for (const s of overlapSamples) {
      console.log(
        `  ${s.key}: CRM ${s.crm.account} ${s.crm.status} | HCCB ${s.hccb.status} | CRM date ${s.crm.date}`
      );
    }
  }

  if (crmSouthOnly.length) {
    console.log('\nSample CRM South Coke NOT in HCCB file:');
    for (const r of crmSouthOnly.slice(0, 8)) {
      console.log(`  ${r.key} | ${r.account} | ${r.status} | ${r.date}`);
    }
  }

  if (hccbOnly.length) {
    console.log('\nSample HCCB import NOT in CRM Coke account:');
    for (const r of hccbOnly.slice(0, 8)) {
      console.log(`  ${r.key} | ${r.status} | ${r.date}`);
    }
  }

  console.log('\n--- Non-South CRM Coke (no HCCB replacement file) ---');
  for (const [z, n] of [...byZone(new Map(crmNonSouth.map((r) => [r.key, r]))).entries()].sort()) {
    console.log(`  ${z}: ${n}`);
  }

  console.log('\n=== Verdict ===');
  if (overlapSouth > crmSouth.length * 0.5) {
    console.log(
      'They are MOSTLY THE SAME calls — same service order / call numbers, logged in CRM as Account=Coke and in CDMS as HCCB.'
    );
    console.log(
      '“Different” only means different SOURCE SYSTEM and STATUS LABELS, not a second unrelated Coke population in South.'
    );
  } else if (overlapSouth === 0) {
    console.log('Almost no key overlap — they may use different ID fields; check Call No vs CRM ID mapping.');
  } else {
    console.log('Partial overlap — South CRM Coke and HCCB are largely the same pool with some drift.');
  }
  console.log(
    '\nBD MIS rule: for SOUTH totals use HCCB import ONLY. CRM South Coke is the same business; counting both double-counts.'
  );
  console.log(
    'Non-South CRM Coke (North/East/West) has no HCCB file — those stay on CRM only.'
  );
}

main();
