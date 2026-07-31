/**
 * Full audit: frozen portal register CSV vs calls_latest_hot (production).
 *
 * Usage:
 *   npx tsx scripts/mis-client/audit-csv-vs-database.ts [csv-path]
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';

const CSV =
  process.argv[2] ??
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

const PERIOD_START = '2026-01-01';
const PERIOD_END = '2026-06-29';

type Bucket = 'open' | 'solved' | 'cancelled';

type CsvRow = {
  vtrnno: string;
  vcclid: string;
  callType: string;
  loggedIso: string;
  region: string;
  branch: string;
  account: string;
  statusText: string;
  solvedDate: string;
  bucket: Bucket;
  isPractice: boolean;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCrmDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Same rules as postgres-csv-export.ts + restore-hot-status-from-csv.ts */
function csvToBucket(statusRaw: string, solvedDateRaw: string): Bucket {
  const lower = statusRaw.trim().toLowerCase();
  if (lower === 'cancelled' || lower.includes('cancel')) return 'cancelled';
  const solvedIso = parseCrmDate(solvedDateRaw);
  const solvedByLabel =
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech');
  if (solvedIso || solvedByLabel) return 'solved';
  return 'open';
}

function hotToBucket(bucket: string): Bucket {
  if (bucket === 'cancelled') return 'cancelled';
  if (bucket === 'solved' || bucket === 'tech_solved') return 'solved';
  return 'open';
}

function isPracticeBranch(branch: string, franchisee = ''): boolean {
  const s = `${branch} ${franchisee}`.toUpperCase();
  return s.includes('PRACTICE') || s.includes('WINMAX');
}

function loadCsv(): Map<string, CsvRow> {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);
  const map = new Map<string, CsvRow>();

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const callType = (c[idx('Call Type')] ?? '').trim();
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    const vtrnno = String(c[idx('ID')] ?? '').trim();
    if (!vtrnno || !iso) continue;

    const branch = (c[idx('Branch')] ?? '').trim();
    const franchisee = (c[idx('Franchisee')] ?? '').trim();
    const row: CsvRow = {
      vtrnno,
      vcclid: String(c[idx('Call Centre ID')] ?? '').trim(),
      callType,
      loggedIso: iso,
      region: (c[idx('Region')] ?? '').trim(),
      branch,
      account: (c[idx('Account')] ?? '').trim(),
      statusText: (c[idx('Status')] ?? '').trim(),
      solvedDate: (c[idx('Solved Date')] ?? '').trim(),
      bucket: csvToBucket(c[idx('Status')] ?? '', c[idx('Solved Date')] ?? ''),
      isPractice: isPracticeBranch(branch, franchisee),
    };
    map.set(vtrnno, row);
  }
  return map;
}

function tally(rows: Iterable<{ bucket: Bucket }>, filter?: (r: CsvRow) => boolean) {
  const t = { total: 0, solved: 0, open: 0, cancelled: 0 };
  for (const r of rows) {
    if (filter && !filter(r as CsvRow)) continue;
    const row = r as CsvRow;
    if (row.bucket === 'cancelled') {
      t.cancelled++;
      continue;
    }
    t.total++;
    if (row.bucket === 'solved') t.solved++;
    else t.open++;
  }
  return t;
}

async function loadHot(): Promise<
  Map<
    string,
    {
      vtrnno: string;
      vcclid: string | null;
      call_type: string;
      logged_at: string;
      region: string;
      branch: string;
      account: string;
      status_bucket: string;
      status_label: string;
      bucket: Bucket;
      is_practice: boolean;
    }
  >
> {
  return withAppClient(async (c) => {
    const r = await c.query<{
      vtrnno: string;
      vcclid: string | null;
      call_type: string;
      logged_at: string;
      region: string;
      branch: string;
      account: string;
      status_bucket: string;
      status_label: string;
      is_practice: boolean;
    }>(`
      SELECT
        h.vtrnno,
        h.vcclid,
        h.call_type,
        h.logged_at::date::text AS logged_at,
        upper(trim(h.region)) AS region,
        COALESCE(d.vcompanyname, h.branch_name, '') AS branch,
        h.account,
        h.status_bucket::text AS status_bucket,
        h.status_label,
        COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') ~* '(PRACTICE|WINMAX)' AS is_practice
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    `);
    const map = new Map<string, (typeof r.rows)[0] & { bucket: Bucket }>();
    for (const row of r.rows) {
      map.set(row.vtrnno, { ...row, bucket: hotToBucket(row.status_bucket) });
    }
    return map;
  });
}

function ytdBreakdown(r: { callType?: string; call_type?: string; loggedIso?: string; logged_at?: string }) {
  const ct = (r.callType ?? r.call_type ?? '').toUpperCase();
  const d = r.loggedIso ?? r.logged_at ?? '';
  return ct === 'BREAKDOWN' && d >= PERIOD_START && d <= PERIOD_END;
}

async function main() {
  if (!existsSync(CSV)) {
    console.error('CSV not found:', CSV);
    process.exit(1);
  }

  console.log('=== CRM Register CSV vs Database audit ===');
  console.log(`CSV: ${CSV}`);
  console.log(`Period: ${PERIOD_START} → ${PERIOD_END} | Call type: BREAKDOWN\n`);

  const csvAll = loadCsv();
  const hotAll = await loadHot();

  const csvYtd = [...csvAll.values()].filter((r) => ytdBreakdown(r));
  const hotYtd = [...hotAll.values()].filter((r) => ytdBreakdown(r));

  const csvT = tally(csvYtd);
  const csvTNoPractice = tally(csvYtd, (r) => !r.isPractice);
  const hotT = tally(hotYtd);
  const hotTNoPractice = tally(hotYtd, (r) => !r.is_practice);

  console.log('--- Row counts (BREAKDOWN YTD) ---');
  console.log('CSV breakdown rows:     ', csvYtd.length);
  console.log('DB hot breakdown rows:  ', hotYtd.length);
  console.log('Δ rows (DB − CSV):      ', hotYtd.length - csvYtd.length);

  console.log('\n--- Status totals: CSV (portal export logic) ---');
  console.log(csvT);
  console.log('CSV excl practice:', csvTNoPractice);

  console.log('\n--- Status totals: DB hot (current) ---');
  console.log(hotT);
  console.log('DB excl practice:', hotTNoPractice);

  console.log('\n--- Mismatch vs CSV snapshot (excl practice, active only) ---');
  console.log({
    openDelta: hotTNoPractice.open - csvTNoPractice.open,
    solvedDelta: hotTNoPractice.solved - csvTNoPractice.solved,
    totalDelta: hotTNoPractice.total - csvTNoPractice.total,
    cancelledDelta: hotT.total - csvT.total - (hotTNoPractice.total - csvTNoPractice.total),
  });

  const csvByTrn = new Map(csvYtd.map((r) => [r.vtrnno, r]));
  const hotByTrn = new Map(hotYtd.map((r) => [r.vtrnno, r]));

  const onlyCsv: CsvRow[] = [];
  const onlyDb: typeof hotYtd = [];
  const statusMismatch: Array<{
    vtrnno: string;
    csvBucket: Bucket;
    dbBucket: Bucket;
    csvStatus: string;
    dbStatus: string;
    account: string;
    region: string;
  }> = [];

  for (const [trn, row] of csvByTrn) {
    if (!hotByTrn.has(trn)) onlyCsv.push(row);
  }
  for (const [trn, row] of hotByTrn) {
    const csv = csvByTrn.get(trn);
    if (!csv) {
      onlyDb.push(row);
      continue;
    }
    if (csv.bucket !== row.bucket) {
      statusMismatch.push({
        vtrnno: trn,
        csvBucket: csv.bucket,
        dbBucket: row.bucket,
        csvStatus: csv.statusText,
        dbStatus: `${row.status_bucket}/${row.status_label}`,
        account: row.account,
        region: row.region,
      });
    }
  }

  const onlyDbNoPractice = onlyDb.filter((r) => !r.is_practice);
  const onlyCsvNoPractice = onlyCsv.filter((r) => !r.isPractice);

  console.log('\n--- TRN presence ---');
  console.log({
    onlyInCsv: onlyCsv.length,
    onlyInCsvNoPractice: onlyCsvNoPractice.length,
    onlyInDb: onlyDb.length,
    onlyInDbNoPractice: onlyDbNoPractice.length,
    statusMismatch: statusMismatch.length,
  });

  const mismatchByType = {
    csvOpen_dbSolved: statusMismatch.filter((m) => m.csvBucket === 'open' && m.dbBucket === 'solved'),
    csvSolved_dbOpen: statusMismatch.filter((m) => m.csvBucket === 'solved' && m.dbBucket === 'open'),
    csvCancelled_other: statusMismatch.filter((m) => m.csvBucket === 'cancelled'),
    other: statusMismatch.filter(
      (m) =>
        !(
          (m.csvBucket === 'open' && m.dbBucket === 'solved') ||
          (m.csvBucket === 'solved' && m.dbBucket === 'open') ||
          m.csvBucket === 'cancelled'
        )
    ),
  };

  console.log('\n--- Status mismatches (same TRN, different bucket) ---');
  console.log({
    csvOpen_dbSolved: mismatchByType.csvOpen_dbSolved.length,
    csvSolved_dbOpen: mismatchByType.csvSolved_dbOpen.length,
    csvCancelled_other: mismatchByType.csvCancelled_other.length,
    other: mismatchByType.other.length,
  });

  if (mismatchByType.csvSolved_dbOpen.length > 0) {
    console.log('\n⚠ CSV=solved but DB=open (these inflate open count):');
    for (const m of mismatchByType.csvSolved_dbOpen.slice(0, 15)) {
      console.log(`  ${m.vtrnno} | ${m.csvStatus} → ${m.dbStatus} | ${m.account} | ${m.region}`);
    }
    if (mismatchByType.csvSolved_dbOpen.length > 15) {
      console.log(`  ... +${mismatchByType.csvSolved_dbOpen.length - 15} more`);
    }
  }

  if (mismatchByType.csvOpen_dbSolved.length > 0) {
    console.log('\n⚠ CSV=open but DB=solved (these deflate open count):');
    for (const m of mismatchByType.csvOpen_dbSolved.slice(0, 15)) {
      console.log(`  ${m.vtrnno} | ${m.csvStatus} → ${m.dbStatus} | ${m.account} | ${m.region}`);
    }
    if (mismatchByType.csvOpen_dbSolved.length > 15) {
      console.log(`  ... +${mismatchByType.csvOpen_dbSolved.length - 15} more`);
    }
  }

  const onlyDbOpen = onlyDbNoPractice.filter((r) => r.bucket === 'open');
  const onlyDbSolved = onlyDbNoPractice.filter((r) => r.bucket === 'solved');
  const onlyDbCancelled = onlyDbNoPractice.filter((r) => r.bucket === 'cancelled');

  console.log('\n--- Rows in DB but NOT in CSV (excl practice) ---');
  console.log({
    total: onlyDbNoPractice.length,
    open: onlyDbOpen.length,
    solved: onlyDbSolved.length,
    cancelled: onlyDbCancelled.length,
  });
  if (onlyDbOpen.length > 0) {
    console.log('  OPEN extras (fill-ytd junk — should not exist):');
    for (const r of onlyDbOpen.slice(0, 10)) {
      console.log(`    ${r.vtrnno} ${r.status_label} ${r.account} ${r.logged_at} ${r.region}`);
    }
  }
  if (onlyDbSolved.length > 0 && onlyDbSolved.length <= 20) {
    console.log('  Sample solved extras:');
    for (const r of onlyDbSolved.slice(0, 5)) {
      console.log(`    ${r.vtrnno} ${r.account} ${r.logged_at}`);
    }
  } else if (onlyDbSolved.length > 20) {
    console.log(`  ${onlyDbSolved.length} solved extras (mostly fill-ytd pollution)`);
  }

  // Open TRNs: exact set compare
  const csvOpenSet = new Set(csvYtd.filter((r) => r.bucket === 'open' && !r.isPractice).map((r) => r.vtrnno));
  const dbOpenSet = new Set(hotYtd.filter((r) => r.bucket === 'open' && !r.is_practice).map((r) => r.vtrnno));

  const openOnlyDb = [...dbOpenSet].filter((t) => !csvOpenSet.has(t));
  const openOnlyCsv = [...csvOpenSet].filter((t) => !dbOpenSet.has(t));

  console.log('\n--- OPEN call TRN set compare (excl practice) ---');
  console.log({
    csvOpen: csvOpenSet.size,
    dbOpen: dbOpenSet.size,
    openOnlyInDb: openOnlyDb.length,
    openOnlyInCsv: openOnlyCsv.length,
    netOpenDelta: dbOpenSet.size - csvOpenSet.size,
  });

  if (openOnlyDb.length > 0) {
    console.log('\nOpen in DB but NOT open in CSV:');
    for (const trn of openOnlyDb.slice(0, 20)) {
      const db = hotByTrn.get(trn)!;
      const csv = csvByTrn.get(trn);
      console.log(
        `  ${trn} | CSV=${csv ? csv.bucket + '/' + csv.statusText : 'MISSING'} | DB=${db.status_bucket}/${db.status_label}`
      );
    }
  }

  if (openOnlyCsv.length > 0) {
    console.log('\nOpen in CSV but NOT open in DB:');
    for (const trn of openOnlyCsv.slice(0, 20)) {
      const csv = csvByTrn.get(trn)!;
      const db = hotByTrn.get(trn);
      console.log(
        `  ${trn} | CSV=${csv.statusText} | DB=${db ? db.status_bucket + '/' + db.status_label : 'MISSING'}`
      );
    }
  }

  // BD MIS query style count (practice excluded via SQL)
  await withAppClient(async (c) => {
    const r = await c.query<{ open_n: number; solved_n: number; total_nc: number; cancelled_n: number }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_n,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved_n,
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total_nc,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled_n
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    `, [`${PERIOD_START}T00:00:00`, `${PERIOD_END}T23:59:59`]);
    console.log('\n--- DB as BD MIS CRM query counts (excl practice) ---');
    console.log(r.rows[0]);
    console.log('CSV same filter:', csvTNoPractice);
  });

  console.log('\n=== VERDICT ===');
  if (
    statusMismatch.length === 0 &&
    onlyDbNoPractice.length === 0 &&
    onlyCsvNoPractice.length === 0 &&
    csvTNoPractice.open === hotTNoPractice.open
  ) {
    console.log('✅ CSV and DB match perfectly for YTD breakdown (excl practice).');
  } else if (
    mismatchByType.csvSolved_dbOpen.length === 0 &&
    onlyDbOpen.length === 0 &&
    openOnlyDb.length === 0
  ) {
    console.log('✅ OPEN calls match CSV — no extra open TRNs in DB.');
    if (onlyDbSolved.length > 0) {
      console.log(`⚠ DB has ${onlyDbSolved.length} extra SOLVED rows not in CSV (fill-ytd) — affects solved/total, NOT open.`);
    }
    if (mismatchByType.csvOpen_dbSolved.length > 0) {
      console.log(`⚠ ${mismatchByType.csvOpen_dbSolved.length} TRNs: CSV open but DB solved (status drift).`);
    }
  } else {
    console.log('❌ JHOL HAI — see mismatches above.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
