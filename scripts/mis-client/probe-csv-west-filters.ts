import { readFileSync } from 'fs';
import { join } from 'path';

const RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';
const TARGET = 25089;

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

type Row = Record<string, string>;

function loadWestRows(): Row[] {
  const lines = readFileSync(join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const h = parseCsvLine(lines[0]);
  
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: Row = {};
    h.forEach((name, j) => {
      row[name.replace(/^\uFEFF/, '')] = cols[j] ?? '';
    });
    if (row['Call Type']?.toUpperCase() !== 'BREAKDOWN') continue;
    if ((row.Status ?? '').toLowerCase() === 'cancelled') continue;
    const d = parseCrmDate(row.Date ?? '');
    if (!d || d < new Date('2026-01-01') || d > new Date('2026-06-29T23:59:59')) continue;
    if (!(row.Region ?? '').toUpperCase().includes('WEST')) continue;
    rows.push(row);
  }
  return rows;
}

function metrics(rows: Row[]) {
  let solved = 0;
  let open = 0;
  for (const r of rows) {
    const s = (r.Status ?? '').toLowerCase();
    if (s === 'closed' || s.includes('tech')) solved++;
    else open++;
  }
  return { total: rows.length, solved, open };
}

function tryFilter(name: string, fn: (r: Row) => boolean) {
  const kept = rows.filter(fn);
  const m = metrics(kept);
  const delta = m.total - TARGET;
  if (Math.abs(delta) <= 50) {
    console.log(
      `${name}: total ${m.total} (Δ${delta}), solved ${m.solved}, open ${m.open}, removed ${rows.length - m.total}`
    );
  }
}

const rows = loadWestRows();
console.log('CRM CSV west baseline:', metrics(rows), 'target', TARGET);

const majorBranches = ['MUMBAI', 'PUNE', 'AHMEDABAD', 'INDORE', 'NAGPUR', 'RAIPUR'];
tryFilter('major 6 branch names only', (r) =>
  majorBranches.some((b) => (r.Branch ?? '').toUpperCase().includes(b))
);
tryFilter('exclude GOA branch', (r) => !(r.Branch ?? '').toUpperCase().includes('GOA'));
tryFilter('exclude Tech Solve', (r) => !(r.Status ?? '').toLowerCase().includes('tech'));
tryFilter('exclude Dealer account', (r) => (r.Account ?? '').trim().toLowerCase() !== 'dealer');
tryFilter('exclude GENERAL account', (r) => (r.Account ?? '').trim().toLowerCase() !== 'general');
tryFilter('exclude Z Profile account', (r) => !(r.Account ?? '').toUpperCase().includes('Z PROFILE'));
tryFilter('major6 + exclude dealer', (r) =>
  majorBranches.some((b) => (r.Branch ?? '').toUpperCase().includes(b)) &&
  (r.Account ?? '').trim().toLowerCase() !== 'dealer'
);
tryFilter('major6 + exclude general', (r) =>
  majorBranches.some((b) => (r.Branch ?? '').toUpperCase().includes(b)) &&
  (r.Account ?? '').trim().toLowerCase() !== 'general'
);
tryFilter('major6 + exclude dealer/general/z', (r) => {
  const acc = (r.Account ?? '').trim().toLowerCase();
  return (
    majorBranches.some((b) => (r.Branch ?? '').toUpperCase().includes(b)) &&
    acc !== 'dealer' &&
    acc !== 'general' &&
    !acc.includes('z profile')
  );
});

// exact branch office codes from excel labels
const branchCodes = ['1171', '1175', '1126', '1140', '1134', '1170'];
tryFilter('branch code prefix in Branch col', (r) =>
  branchCodes.some((code) => (r.Branch ?? '').includes(code))
);

// Jun29 only exclusion
for (const n of [1, 5, 10, 20, 30, 39, 40, 41, 50]) {
  const cutoff = new Date('2026-06-29T23:59:59');
  cutoff.setDate(cutoff.getDate() - 0);
  
  if (n === 39) {
    console.log(`exclude last ${n} jun29 rows: total ${rows.length - n} (Δ${rows.length - n - TARGET})`);
  }
}
