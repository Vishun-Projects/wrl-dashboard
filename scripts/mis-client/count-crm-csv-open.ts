import { readFileSync, existsSync } from 'fs';

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

function parseCrmDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function countCsv(path: string) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  let total = 0;
  let open = 0;
  let solved = 0;
  let cancelled = 0;
  let tech = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > '2026-06-29') continue;
    total++;
    const st = (c[idx('Status')] ?? '').trim().toLowerCase();
    if (st === 'cancelled') cancelled++;
    else if (st.includes('tech')) {
      tech++;
      solved++;
    } else if (st.includes('closed') || st === 'solved') solved++;
    else open++;
  }
  console.log(path.split(/[/\\]/).pop(), { total, open, solved, tech, cancelled, openPlusSolved: open + solved });
}

for (const p of process.argv.slice(2)) {
  if (existsSync(p)) countCsv(p);
  else console.log('missing', p);
}
