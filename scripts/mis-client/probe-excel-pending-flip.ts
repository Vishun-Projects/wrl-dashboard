/**
 * Calls Excel Pending lists as open but portal CRM hot row is solved/tech_solved.
 * Quantifies open drop after fill-ytd vs Excel tally (8773).
 */
import { config } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import XLSX from 'xlsx';
import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

config({ path: join(process.cwd(), '.env.local') });

const EXCEL = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';


function normId(s: string): string {
  return s.trim().replace(/^0+/, '').toLowerCase();
}

function loadExcelPendingIds(): Map<string, string> {
  const wb = XLSX.readFile(EXCEL);
  const sheet = wb.Sheets['Pending'] ?? wb.Sheets['pending'];
  if (!sheet) throw new Error('Pending sheet not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const out = new Map<string, string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = normId(String(r[0] ?? r[1] ?? ''));
    if (!id) continue;
    out.set(id, String(r[0] ?? '').trim());
  }
  return out;
}

async function main() {
  if (!existsSync(EXCEL)) {
    console.error('Excel not found:', EXCEL);
    process.exit(1);
  }

  const pending = loadExcelPendingIds();
  console.log(`Excel Pending rows: ${pending.size} (regional open ref ~8773)`);

  await withAppClient(async (c) => {
    const dbOpen = await c.query<{ n: number }>(
      `
      SELECT count(*)::int AS n FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket IN ('open_unallocated','assigned')
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      `
    );
    console.log(`Portal CRM open (raw): ${dbOpen.rows[0].n}`);

    const ids = [...pending.keys()];
    const res = await c.query<{
      vtrnno: string;
      status_bucket: string;
      status_label: string;
      account: string;
      logged_at: string;
    }>(
      `
      SELECT h.vtrnno, h.status_bucket, h.status_label, h.account, h.logged_at::text
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE lower(regexp_replace(ltrim(h.vtrnno, '0'), '^0+', '')) = ANY($1::text[])
           OR lower(regexp_replace(ltrim(h.vcclid, '0'), '^0+', '')) = ANY($1::text[])
      `,
      [ids]
    );

    const byTrn = new Map<string, (typeof res.rows)[0]>();
    for (const row of res.rows) {
      byTrn.set(normId(row.vtrnno), row);
      if (row.vtrnno) byTrn.set(normId(row.vtrnno), row);
    }

    let excelOpenNowSolved = 0;
    let excelOpenStillOpen = 0;
    let excelOpenMissing = 0;
    const samples: string[] = [];

    for (const id of pending.keys()) {
      const row = res.rows.find(
        (r) => normId(r.vtrnno) === id || (r.vtrnno && normId(r.vtrnno) === id)
      );
      if (!row) {
        excelOpenMissing++;
        continue;
      }
      if (['open_unallocated', 'assigned'].includes(row.status_bucket)) excelOpenStillOpen++;
      else if (['solved', 'tech_solved'].includes(row.status_bucket)) {
        excelOpenNowSolved++;
        if (samples.length < 12) {
          samples.push(
            `${row.vtrnno} ${row.status_bucket}/${row.status_label} ${row.account} ${row.logged_at.slice(0, 10)}`
          );
        }
      }
    }

    // Better match via SQL join
    const flip = await c.query<{ n: number }>(
      `
      WITH pending(id) AS (SELECT unnest($1::text[]))
      SELECT count(*)::int AS n
      FROM pending p
      JOIN calls_latest_hot h ON lower(regexp_replace(ltrim(h.vtrnno, '0'), '^0+', '')) = p.id
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.status_bucket IN ('solved','tech_solved')
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      `,
      [ids]
    );

    const still = await c.query<{ n: number }>(
      `
      WITH pending(id) AS (SELECT unnest($1::text[]))
      SELECT count(*)::int AS n
      FROM pending p
      JOIN calls_latest_hot h ON lower(regexp_replace(ltrim(h.vtrnno, '0'), '^0+', '')) = p.id
      WHERE h.status_bucket IN ('open_unallocated','assigned')
      `,
      [ids]
    );

    console.log('\nExcel Pending IDs in hot table:');
    console.log(`  Still open in portal: ${still.rows[0].n}`);
    console.log(`  Flipped to solved/tech_solved (fill-ytd): ${flip.rows[0].n}`);
    console.log(`  (loop est) stillOpen=${excelOpenStillOpen} nowSolved=${excelOpenNowSolved} missing=${excelOpenMissing}`);

    if (samples.length) {
      console.log('\nSample Excel-pending now solved in portal:');
      for (const s of samples) console.log(' ', s);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
