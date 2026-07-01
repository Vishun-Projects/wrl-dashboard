import { readFileSync } from 'fs';

const TRNS = [
  '26F041532', '26D081572', '26F181227', '26F171273', '26F29824', '26D08674',
  '26D021121', '26C021379', '26D255059', '26E07335', '26D071029', '26D09689', '26F22746',
];
const CSV = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

function parse(line: string): string[] {
  const o: string[] = [];
  let c = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      o.push(c);
      c = '';
    } else c += ch;
  }
  o.push(c);
  return o;
}

const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const h = parse(lines[0]);
const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);

console.log('=== Uske download wale CSV mein Region column ===\n');
for (const trn of TRNS) {
  const row = lines.slice(1).find((l) => parse(l)[idx('ID')]?.trim() === trn);
  if (!row) {
    console.log(`${trn}: CSV mein nahi mila`);
    continue;
  }
  const c = parse(row);
  const region = (c[idx('Region')] ?? '').trim();
  const account = c[idx('Account')] ?? '';
  const status = c[idx('Status')] ?? '';
  console.log(
    `${trn} | ${account} | Region="${region}" ${region === '' ? '← KHALI' : ''} | ${status}`
  );
}

// How many breakdown rows in full CSV have blank Region?
let blank = 0;
let total = 0;
for (let i = 1; i < lines.length; i++) {
  const c = parse(lines[i]);
  if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
  total++;
  if (!(c[idx('Region')] ?? '').trim()) blank++;
}
console.log(`\nPoori CSV: ${total} breakdown rows, ${blank} jinka Region blank hai`);
