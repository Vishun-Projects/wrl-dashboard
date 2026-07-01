import { readFileSync } from 'fs';
import { join } from 'path';

const RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

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

const lines = readFileSync(join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);
const h = parseCsvLine(lines[0]);
const idx = (n: string) => h.indexOf(n);

const byZone = new Map<string, number>();
const westByAccount = new Map<string, number>();

for (let i = 1; i < lines.length; i++) {
  const c = parseCsvLine(lines[i]);
  if (c[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
  if ((c[idx('Status')] ?? '').toLowerCase() === 'cancelled') continue;
  const d = parseCrmDate(c[idx('Date')] ?? '');
  if (!d || d < new Date('2026-01-01') || d > new Date('2026-06-29T23:59:59')) continue;
  const zone = (c[idx('Region')] ?? '').includes('WEST')
    ? 'WEST'
    : (c[idx('Region')] ?? '').includes('NORTH')
      ? 'NORTH'
      : 'OTHER';
  byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
  if (zone === 'WEST') {
    const acc = (c[idx('Account')] ?? '').trim() || '(empty)';
    westByAccount.set(acc, (westByAccount.get(acc) ?? 0) + 1);
  }
}

console.log('CRM CSV Jan1-Jun29 non-cancelled BREAKDOWN:');
console.log('  NORTH:', byZone.get('NORTH'), '(excel 68355, portal 68356)');
console.log('  WEST:', byZone.get('WEST'), '(excel 25089, portal 25129)');
console.log('\nWest by account (top):');
[...westByAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([a, n]) => console.log(`  ${a}: ${n}`));
