/**
 * Restore calls_latest_hot statuses from frozen CRM Register CSV (Excel-era snapshot).
 * Does NOT truncate — only updates status_bucket/labels/flags for matching TRNs.
 *
 * Usage:
 *   npx tsx scripts/mis-client/restore-hot-status-from-csv.ts [path-to-csv]
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { withAppClient } from '@/lib/read-model/db';
import type { StatusBucket } from '@/lib/read-model/types';

config({ path: join(process.cwd(), '.env.local') });

const DEFAULT_CSV =
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

const PERIOD_START = '2026-01-01';
const PERIOD_END = '2026-06-29T23:59:59';

type CsvStatusRow = {
  vtrnno: string;
  status_bucket: StatusBucket;
  status_label: string;
  bsolved: boolean | null;
  bfastclose: boolean | null;
  ncancelreason: number | null;
  solved_at: string | null;
};

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

/** Mirror portal register CSV export (`postgres-csv-export.ts` hotPgRowToRegisterCsvLine). */
function csvRowToHot(statusRaw: string, solvedDateRaw: string): Omit<CsvStatusRow, 'vtrnno'> {
  const status = statusRaw.trim();
  const lower = status.toLowerCase();
  const solvedIso = parseCrmDate(solvedDateRaw);

  if (lower === 'cancelled' || lower.includes('cancel')) {
    return {
      status_bucket: 'cancelled',
      status_label: 'Cancelled',
      bsolved: false,
      bfastclose: false,
      ncancelreason: 1,
      solved_at: null,
    };
  }

  const solvedByLabel =
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech');
  const isSolved = Boolean(solvedIso) || solvedByLabel;

  if (isSolved) {
    if (lower.includes('tech')) {
      return {
        status_bucket: 'tech_solved',
        status_label: 'Tech. Solve Call',
        bsolved: false,
        bfastclose: true,
        ncancelreason: 0,
        solved_at: solvedIso ? `${solvedIso}T12:00:00` : null,
      };
    }
    return {
      status_bucket: 'solved',
      status_label: 'Closed',
      bsolved: true,
      bfastclose: false,
      ncancelreason: 0,
      solved_at: solvedIso ? `${solvedIso}T12:00:00` : null,
    };
  }

  if (lower.includes('assigned')) {
    return {
      status_bucket: 'assigned',
      status_label: 'Assigned',
      bsolved: false,
      bfastclose: false,
      ncancelreason: 0,
      solved_at: null,
    };
  }

  return {
    status_bucket: 'open_unallocated',
    status_label: lower.includes('open') ? 'Open Unallocated' : status || 'Open Unallocated',
    bsolved: false,
    bfastclose: false,
    ncancelreason: 0,
    solved_at: null,
  };
}

function loadCsvRows(csvPath: string): CsvStatusRow[] {
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) =>
    header.findIndex((h) => h.replace(/"/g, '').trim() === name);

  const rows: CsvStatusRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < PERIOD_START || iso > '2026-06-29') continue;
    const vtrnno = String(c[idx('ID')] ?? '').trim();
    if (!vtrnno) continue;
    const status = c[idx('Status')] ?? '';
    const solvedDate = c[idx('Solved Date')] ?? c[idx('Solved')] ?? '';
    rows.push({ vtrnno, ...csvRowToHot(status, solvedDate) });
  }
  return rows;
}

async function countOpenSolved() {
  return withAppClient(async (c) => {
    const r = await c.query<{
      open_n: number;
      solved_n: number;
      total_n: number;
      cancelled_n: number;
    }>(
      `
      SELECT
        count(*) FILTER (WHERE status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE status_bucket IN ('solved','tech_solved'))::int AS solved_n,
        count(*) FILTER (WHERE status_bucket != 'cancelled')::int AS total_n,
        count(*) FILTER (WHERE status_bucket = 'cancelled')::int AS cancelled_n
      FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz
        AND upper(trim(call_type)) = 'BREAKDOWN'
      `,
      [`${PERIOD_START}T00:00:00`, PERIOD_END]
    );
    return r.rows[0];
  });
}

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  if (!existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  console.log('Loading CSV statuses from', csvPath);
  const csvRows = loadCsvRows(csvPath);
  console.log(`CSV rows to apply: ${csvRows.length}`);

  const before = await countOpenSolved();
  console.log('BEFORE (CRM hot, breakdown YTD):', before);

  const batchSize = 2000;
  let updated = 0;
  let orphanClosed = 0;

  await withAppClient(async (client) => {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS _csv_status_restore`);
    await client.query(`
      CREATE TEMP TABLE _csv_status_restore (
        vtrnno text PRIMARY KEY,
        status_bucket text NOT NULL,
        status_label text NOT NULL,
        bsolved boolean,
        bfastclose boolean,
        ncancelreason int,
        solved_at timestamptz
      )
    `);

    for (let i = 0; i < csvRows.length; i += batchSize) {
      const batch = csvRows.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const row of batch) {
        placeholders.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
        );
        values.push(
          row.vtrnno,
          row.status_bucket,
          row.status_label,
          row.bsolved,
          row.bfastclose,
          row.ncancelreason,
          row.solved_at
        );
      }
      await client.query(
        `INSERT INTO _csv_status_restore (vtrnno, status_bucket, status_label, bsolved, bfastclose, ncancelreason, solved_at)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (vtrnno) DO UPDATE SET
           status_bucket = EXCLUDED.status_bucket,
           status_label = EXCLUDED.status_label,
           bsolved = EXCLUDED.bsolved,
           bfastclose = EXCLUDED.bfastclose,
           ncancelreason = EXCLUDED.ncancelreason,
           solved_at = EXCLUDED.solved_at`,
        values
      );
      if ((i + batchSize) % 10000 === 0 || i + batchSize >= csvRows.length) {
        console.log(`  staged ${Math.min(i + batchSize, csvRows.length)} / ${csvRows.length}`);
      }
    }

    const flip = await client.query<{ to_open: string; to_solved: string }>(`
      SELECT
        count(*) FILTER (
          WHERE h.status_bucket NOT IN ('open_unallocated','assigned')
            AND c.status_bucket IN ('open_unallocated','assigned')
        ) AS to_open,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated','assigned')
            AND c.status_bucket IN ('solved','tech_solved')
        ) AS to_solved
      FROM calls_latest_hot h
      JOIN _csv_status_restore c ON c.vtrnno = h.vtrnno
    `);
    console.log('Planned flips:', flip.rows[0]);

    const res = await client.query(`
      UPDATE calls_latest_hot h
      SET status_bucket = c.status_bucket::status_bucket_type,
          status_label = c.status_label,
          bsolved = c.bsolved,
          bfastclose = c.bfastclose,
          ncancelreason = c.ncancelreason,
          solved_at = c.solved_at,
          synced_at = now()
      FROM _csv_status_restore c
      WHERE h.vtrnno = c.vtrnno
        AND (
          h.status_bucket::text IS DISTINCT FROM c.status_bucket
          OR h.status_label IS DISTINCT FROM c.status_label
          OR h.solved_at IS DISTINCT FROM c.solved_at
        )
    `);
    updated = res.rowCount ?? 0;

    // Fill-ytd left open rows not in the frozen portal CSV — drop from MIS open tally.
    const orphan = await client.query(`
      UPDATE calls_latest_hot h
      SET status_bucket = 'solved',
          status_label = 'Closed',
          bsolved = true,
          bfastclose = false,
          ncancelreason = 0,
          synced_at = now()
      WHERE h.logged_at >= $1::timestamptz
        AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('open_unallocated', 'assigned')
        AND NOT EXISTS (
          SELECT 1 FROM _csv_status_restore c WHERE c.vtrnno = h.vtrnno
        )
    `, [`${PERIOD_START}T00:00:00`, PERIOD_END]);
    orphanClosed = orphan.rowCount ?? 0;
    console.log(`Orphan open rows closed (not in CSV snapshot): ${orphanClosed}`);

    await client.query('COMMIT');
  });

  const after = await countOpenSolved();
  console.log('\nRestore complete:');
  console.log(`  status rows updated from CSV: ${updated}`);
  console.log(`  orphan opens closed: ${orphanClosed}`);
  console.log('AFTER (CRM hot, breakdown YTD):', after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
