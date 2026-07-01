import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const CSV =
  process.argv[2] ??
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

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

function classifyCsv(statusRaw: string, solvedDateRaw: string): 'open' | 'solved' | 'cancelled' {
  const lower = statusRaw.trim().toLowerCase();
  const solvedDate = parseCrmDate(solvedDateRaw);
  if (lower === 'cancelled' || lower.includes('cancel')) return 'cancelled';
  const solvedByLabel =
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech');
  if (solvedDate || solvedByLabel) return 'solved';
  return 'open';
}

function loadCsvMap(csvPath: string): Map<string, 'open' | 'solved' | 'cancelled'> {
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) =>
    header.findIndex((h) => h.replace(/"/g, '').trim() === name);
  const map = new Map<string, 'open' | 'solved' | 'cancelled'>();
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > '2026-06-29') continue;
    const vtrnno = String(c[idx('ID')] ?? '').trim();
    if (!vtrnno) continue;
    map.set(vtrnno, classifyCsv(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? ''));
  }
  return map;
}

async function main() {
  if (!existsSync(CSV)) {
    console.error('CSV not found:', CSV);
    process.exit(1);
  }
  const csvByTrn = loadCsvMap(CSV);

  await withAppClient(async (client) => {
    const r = await client.query<{ vtrnno: string; bucket: string }>(`
      SELECT vtrnno, status_bucket::text AS bucket
      FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01T00:00:00'::timestamptz
        AND logged_at <= '2026-06-29T23:59:59'::timestamptz
        AND upper(trim(call_type)) = 'BREAKDOWN'
        AND status_bucket IN ('open_unallocated', 'assigned')
    `);

    let notInCsv = 0;
    let csvSaysSolved = 0;
    let csvSaysOpen = 0;
    let csvSaysCancelled = 0;
    const mismatchSamples: string[] = [];

    for (const row of r.rows) {
      const csv = csvByTrn.get(row.vtrnno);
      if (!csv) {
        notInCsv++;
        continue;
      }
      if (csv === 'solved') {
        csvSaysSolved++;
        if (mismatchSamples.length < 5) mismatchSamples.push(`${row.vtrnno}: hot=open csv=solved`);
      } else if (csv === 'cancelled') {
        csvSaysCancelled++;
        if (mismatchSamples.length < 5) mismatchSamples.push(`${row.vtrnno}: hot=open csv=cancelled`);
      } else {
        csvSaysOpen++;
      }
    }

    console.log({
      hotOpen: r.rows.length,
      csvRowsInPeriod: csvByTrn.size,
      notInCsv,
      csvSaysOpen,
      csvSaysSolved,
      csvSaysCancelled,
      mismatchSamples,
    });

    const extra = await client.query<{ non_cancelled: number; open_n: number }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS non_cancelled,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n
      FROM calls_latest_hot h
      WHERE h.logged_at >= '2026-01-01T00:00:00'::timestamptz
        AND h.logged_at <= '2026-06-29T23:59:59'::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND NOT EXISTS (
          SELECT 1 FROM unnest($1::text[]) t(v) WHERE t.v = h.vtrnno
        )
    `, [Array.from(csvByTrn.keys())]);
    console.log('Hot rows NOT in CSV (any status):', extra.rows[0]);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
