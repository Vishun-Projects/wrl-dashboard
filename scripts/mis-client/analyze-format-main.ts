/**
 * Decompose Format.xlsx Main vs BD_MIS Summary targets.
 */
import XLSX from 'xlsx';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const FORMAT = 'C:/Users/Vishnu.Vishwakarma/Downloads/Testing/Format.xlsx';
const REF: Record<string, number> = {
  NORTH: 67657,
  EAST: 29870,
  WEST: 24798,
  SOUTH: 73468,
  TOTAL: 195793,
};



function normRegion(r: string): string {
  const z = formatDisplayRegion(r);
  return z.replace(/\s+ZONE$/i, '');
}

const wb = XLSX.readFile(FORMAT, { cellDates: true });
const main = XLSX.utils.sheet_to_json(wb.Sheets['Main'], { header: 1, defval: '' }) as unknown[][];
const header = main[0] as string[];
const clientIdx = header.indexOf('Client');
const regionIdx = header.indexOf('Region');

const soIdx = header.indexOf('Service Order');
const fileIdx = header.indexOf('File Name');

const byRegion = new Map<string, number>();
const crmByRegion = new Map<string, number>();
const mondelezByRegion = new Map<string, number>();
const hccbByRegion = new Map<string, number>();
const byFile = new Map<string, number>();

const mondelezKeys = new Set<string>();
const hccbKeys = new Set<string>();
const crmKeys = new Set<string>();
const overlapCrmMondelez = new Set<string>();
const overlapCrmHccb = new Set<string>();

function normKey(v: string): string {
  return v.trim().replace(/^0+/, '').toLowerCase();
}

for (let i = 1; i < main.length; i++) {
  const r = main[i] as unknown[];
  const reg = normRegion(String(r[regionIdx] ?? ''));
  const client = String(r[clientIdx] ?? '').trim().toLowerCase();
  const so = normKey(String(r[soIdx] ?? ''));
  const file = String(r[fileIdx] ?? '').trim();
  byRegion.set(reg, (byRegion.get(reg) ?? 0) + 1);
  byFile.set(file, (byFile.get(file) ?? 0) + 1);

  if (client === 'mondelez') {
    mondelezByRegion.set(reg, (mondelezByRegion.get(reg) ?? 0) + 1);
    if (so) mondelezKeys.add(so);
  } else if (client === 'hccb') {
    hccbByRegion.set(reg, (hccbByRegion.get(reg) ?? 0) + 1);
    if (so) hccbKeys.add(so);
  } else {
    crmByRegion.set(reg, (crmByRegion.get(reg) ?? 0) + 1);
    if (so) crmKeys.add(so);
  }
}

for (const k of crmKeys) {
  if (mondelezKeys.has(k)) overlapCrmMondelez.add(k);
  if (hccbKeys.has(k)) overlapCrmHccb.add(k);
}

console.log('=== Format.Main regional totals ===');
let grand = 0;
for (const reg of ['NORTH', 'EAST', 'WEST', 'SOUTH']) {
  const n = byRegion.get(reg) ?? 0;
  grand += n;
  console.log(
    `  ${reg}: ${n} (ref ${REF[reg]}, Δ${n - REF[reg]}) = CRM ${crmByRegion.get(reg) ?? 0} + Mondelez ${mondelezByRegion.get(reg) ?? 0} + HCCB ${hccbByRegion.get(reg) ?? 0}`
  );
}
console.log(`  TOTAL: ${grand} (ref ${REF.TOTAL}, Δ${grand - REF.TOTAL})`);
console.log(`  CRM rows (non Mondelez/HCCB): ${[...crmByRegion.values()].reduce((a, b) => a + b, 0)}`);
console.log(`  Mondelez: ${[...mondelezByRegion.values()].reduce((a, b) => a + b, 0)}`);
console.log(`  HCCB: ${[...hccbByRegion.values()].reduce((a, b) => a + b, 0)}`);

console.log('\n=== File Name breakdown ===');
[...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, n]) => {
  console.log(`  ${k || '(blank)'}: ${n}`);
});

console.log('\n=== Service order overlap (Format.Main) ===');
console.log(`  CRM keys: ${crmKeys.size}`);
console.log(`  Mondelez keys: ${mondelezKeys.size}`);
console.log(`  HCCB keys: ${hccbKeys.size}`);
console.log(`  CRM ∩ Mondelez: ${overlapCrmMondelez.size}`);
console.log(`  CRM ∩ HCCB: ${overlapCrmHccb.size}`);

// Simulate portal account-swap on Format Main decomposition
console.log('\n=== If we used full CRM branch + account swap (wrong) ===');
for (const reg of ['NORTH', 'EAST', 'WEST', 'SOUTH']) {
  const crm = crmByRegion.get(reg) ?? 0;
  const md = mondelezByRegion.get(reg) ?? 0;
  
  let total = crm;
  if (reg !== 'WEST') total = total + md; // add client cadbury without subtracting CRM cadbury
  if (reg === 'SOUTH') total = total + [...hccbByRegion.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${reg}: naive double-count would be huge — skip`);
}

// Correct: Main already IS the union — just sum by region
console.log('\n=== Formula sheet peek ===');
const formula = XLSX.utils.sheet_to_json(wb.Sheets['Formula'], { header: 1, defval: '' }) as unknown[][];
for (let i = 0; i < Math.min(30, formula.length); i++) {
  const row = formula[i] as unknown[];
  const line = row.map((c) => String(c).slice(0, 40)).join(' | ');
  if (line.trim()) console.log(`  ${line}`);
}
