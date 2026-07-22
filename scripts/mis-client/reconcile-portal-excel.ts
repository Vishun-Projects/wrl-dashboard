/**
 * Portal vs Excel MIS reconciliation — bucket breakdown.
 *
 * Usage:
 *   npx tsx scripts/mis-client/reconcile-portal-excel.ts [raw-dir] [excel-path]
 *
 * Defaults:
 *   raw-dir:   C:/Users/Vishnu.Vishwakarma/Downloads/Raw
 *   excel:     {raw-dir}/New_BD_MIS_30.06.2026.xlsx
 *
 * Compare portal Summary (account merge), BD MIS formula, and Excel Summary sheet.
 * Warns when Excel end date (e.g. 30-Jun) differs from portal query end (29-Jun).
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { prisma } from '@/lib/db/prisma';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryFiltered } from '@/features/mis-import/lib/aggregate';
import {
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
} from '@/features/report/lib/bd-mis-summary';
import {
  DEFAULT_CLIENT_MERGE_WITH_CRM,
  sumMergedAccountMetric,
  sumMergedAccountOpenCalls,
} from '@/features/report/ui/SummaryMergedMetricCell';
import { parseClientDate } from '@/features/mis-import/lib/parse-dates';
import { isCadburyExcludedServiceProvider } from '@/features/mis-import/lib/cadbury-filters';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const DEFAULT_RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

type Metrics = {
  total: number;
  solved: number;
  open: number;
};

type RefRow = Metrics & {
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
};

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

function inRange(d: Date | null, start: Date, end: Date): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

function loadExcelTargets(xlsxPath: string): Map<string, RefRow> {
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], {
    header: 1,
    defval: '',
  }) as unknown[][];

  const targets = new Map<string, RefRow>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const region = String(r[0] ?? '').trim();
    if (!region || region === 'Total' || region === 'Branches') break;
    const zone = `${region.toUpperCase()} ZONE`;
    targets.set(zone, {
      total: Number(r[1] ?? 0),
      solved: Number(r[2] ?? 0),
      open: Number(r[3] ?? 0),
      age_2: Number(r[4] ?? 0),
      age_3: Number(r[5] ?? 0),
      age_7: Number(r[6] ?? 0),
      age_15: Number(r[7] ?? 0),
    });
  }

  const totalRow = rows.find((r) => String((r as unknown[])[0]).trim() === 'Total') as
    | unknown[]
    | undefined;
  if (totalRow) {
    targets.set('GRAND', {
      total: Number(totalRow[1] ?? 0),
      solved: Number(totalRow[2] ?? 0),
      open: Number(totalRow[3] ?? 0),
      age_2: Number(totalRow[4] ?? 0),
      age_3: Number(totalRow[5] ?? 0),
      age_7: Number(totalRow[6] ?? 0),
      age_15: Number(totalRow[7] ?? 0),
    });
  }
  return targets;
}

async function portalMetrics(endDate: string, agingAsOf: string): Promise<{
  bdMis: Metrics;
  summary: Metrics;
  crmBranchTotal: number;
  crmAccountTotal: number;
}> {
  const params = {
    startDate: '2026-01-01',
    endDate,
    agingAsOf,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };

  const crm = await queryBdMisCrmSummary(params);
  const clientAccounts = await queryClientAccountSummaryFiltered({
    ...params,
    sourceCodes: ['coke', 'cadbury'],
  });

  const bdRows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: clientAccounts,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const bdGrand = sumBdMisRegionalGrand(bdRows);

  const mergeFlags = { crm: true, client: true };
  const summaryTotal = sumMergedAccountMetric(
    crm.accountSummary,
    clientAccounts,
    'total_calls',
    mergeFlags,
    DEFAULT_CLIENT_MERGE_WITH_CRM
  );
  const summarySolved = sumMergedAccountMetric(
    crm.accountSummary,
    clientAccounts,
    'total_solved',
    mergeFlags,
    DEFAULT_CLIENT_MERGE_WITH_CRM
  );
  const summaryOpen = sumMergedAccountOpenCalls(
    crm.accountSummary,
    clientAccounts,
    mergeFlags,
    DEFAULT_CLIENT_MERGE_WITH_CRM
  );

  const crmBranchTotal = crm.branchSummary.reduce(
    (s, b) => s + Number(b.total_calls ?? 0),
    0
  );
  const crmAccountTotal = crm.accountSummary.reduce(
    (s, a) => s + Number(a.total_calls ?? 0),
    0
  );

  return {
    bdMis: {
      total: bdGrand.total_calls,
      solved: bdGrand.total_solved,
      open: bdGrand.open_calls,
    },
    summary: { total: summaryTotal, solved: summarySolved, open: summaryOpen },
    crmBranchTotal,
    crmAccountTotal,
  };
}

async function bucketCounts(endDate: string): Promise<Record<string, number>> {
  const periodEnd = `${endDate}T23:59:59`;
  const jun30Start = '2026-06-30T00:00:00';

  const mondelez = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= '2026-01-01T00:00:00'::timestamptz
       AND h.logged_at <= $1::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND h.status_bucket != 'cancelled'
       AND lower(trim(h.account)) = 'mondelez'`,
    periodEnd
  );

  const hccbSouth = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
     WHERE h.logged_at >= '2026-01-01T00:00:00'::timestamptz
       AND h.logged_at <= $1::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND h.status_bucket != 'cancelled'
       AND lower(trim(h.account)) IN ('coke', 'hccb')
       AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%SOUTH%'`,
    periodEnd
  );

  const branchNotInAccounts = await prisma.$queryRawUnsafe<[{ branch_n: number; account_n: number }]>(
    `SELECT
       (SELECT count(*)::int FROM calls_latest_hot h
        WHERE h.logged_at >= '2026-01-01T00:00:00'::timestamptz
          AND h.logged_at <= $1::timestamptz
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled') AS branch_n,
       (SELECT count(*)::int FROM calls_latest_hot h
        WHERE h.logged_at >= '2026-01-01T00:00:00'::timestamptz
          AND h.logged_at <= $1::timestamptz
          AND upper(trim(h.call_type)) = 'BREAKDOWN'
          AND h.status_bucket != 'cancelled'
          AND h.account IS NOT NULL AND trim(h.account) <> '') AS account_n`,
    periodEnd
  );

  const jun30Only =
    endDate < '2026-06-30'
      ? await prisma.$queryRawUnsafe<[{ n: number }]>(
          `SELECT count(*)::int AS n FROM calls_latest_hot h
           WHERE h.logged_at >= $1::timestamptz
             AND h.logged_at <= '2026-06-30T23:59:59'::timestamptz
             AND upper(trim(h.call_type)) = 'BREAKDOWN'
             AND h.status_bucket != 'cancelled'`,
          jun30Start
        )
      : [{ n: 0 }];

  const clientDb = await prisma.$queryRawUnsafe<
    Array<{ source_code: string; n: number }>
  >(
    `
    SELECT s.code AS source_code, count(*)::int AS n
    FROM (
      SELECT DISTINCT ON (r.source_id, r.call_key) r.source_id
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s2 ON s2.id = r.source_id
      WHERE s2.code IN ('cadbury', 'coke')
        AND b.status = 'completed'
        AND r.logged_at >= '2026-01-01'::date
        AND r.logged_at <= ($1::date + interval '1 day' - interval '1 second')
    ) deduped
    JOIN mis_client_sources s ON s.id = deduped.source_id
    GROUP BY s.code
    `,
    endDate
  );

  return {
    mondelezCrmRows: mondelez[0].n,
    hccbCokeCrmSouth: hccbSouth[0].n,
    branchMinusAccountRollup:
      branchNotInAccounts[0].branch_n - branchNotInAccounts[0].account_n,
    jun30OnlyCrmRows: jun30Only[0].n,
    clientDbCadbury: clientDb.find((r) => r.source_code === 'cadbury')?.n ?? 0,
    clientDbCoke: clientDb.find((r) => r.source_code === 'coke')?.n ?? 0,
  };
}

function countRawFiles(rawDir: string, endDate: string): {
  crm: number;
  cadbury: number;
  coke: number;
} {
  const start = new Date('2026-01-01T00:00:00');
  const end = new Date(`${endDate}T23:59:59`);

  let crm = 0;
  const crmPath = join(rawDir, 'CRM_WRL_MIS_Register_2026-06-30.csv');
  if (existsSync(crmPath)) {
    const lines = readFileSync(crmPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const headers = parseCsvLine(lines[0]);
    const idx = (n: string) => headers.indexOf(n);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
      if ((cols[idx('Status')] ?? '').toLowerCase() === 'cancelled') continue;
      const d = parseCrmDate(cols[idx('Date')] ?? '');
      if (!inRange(d, start, end)) continue;
      crm++;
    }
  }

  let cadbury = 0;
  const cadPath = join(rawDir, 'Cadbury.csv');
  if (existsSync(cadPath)) {
    const text = readFileSync(cadPath, 'utf16le').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split('|').map((h) => h.replace(/^"|"$/g, '').replace(/^\./, ''));
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('|').map((c) => c.replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, j) => {
        row[h] = cols[j] ?? '';
      });
      const d = parseClientDate(row.VDate ?? '');
      if (!inRange(d, start, end)) continue;
      if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
      cadbury++;
    }
  }

  let coke = 0;
  const hccbPath = join(rawDir, 'HCCB.xlsx');
  if (existsSync(hccbPath)) {
    const wb = XLSX.readFile(hccbPath, { cellDates: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
      defval: '',
      range: 4,
    });
    for (const row of rows) {
      const dateVal = row['Call Log Date'] ?? row['VDate'] ?? '';
      const d = dateVal instanceof Date ? dateVal : parseClientDate(String(dateVal));
      if (!inRange(d, start, end)) continue;
      coke++;
    }
  }

  return { crm, cadbury, coke };
}

function printRow(label: string, cols: string[]) {
  console.log(`${label.padEnd(32)} | ${cols.join(' | ')}`);
}

async function main() {
  const rawDir = process.argv[2] ?? DEFAULT_RAW;
  const excelPath =
    process.argv[3] ?? join(rawDir, 'New_BD_MIS_30.06.2026.xlsx');

  if (!existsSync(excelPath)) {
    console.error(`Excel not found: ${excelPath}`);
    process.exit(1);
  }

  const excel = loadExcelTargets(excelPath);
  const excelGrand = excel.get('GRAND')!;

  const portalEndJun29 = await portalMetrics('2026-06-29', '2026-06-29');
  const portalEndJun30 = await portalMetrics('2026-06-30', '2026-06-30');
  const buckets29 = await bucketCounts('2026-06-29');
  const raw29 = countRawFiles(rawDir, '2026-06-29');
  const raw30 = countRawFiles(rawDir, '2026-06-30');

  console.log('=== Portal vs Excel MIS Reconciliation ===\n');
  console.log(`Excel:     ${excelPath}`);
  console.log(`Raw dir:   ${rawDir}`);
  console.log(
    '\nNOTE: New_BD_MIS_30.06.2026.xlsx is built through 30-Jun. Portal default compare uses 29-Jun.\n'
  );

  printRow('Source', ['Total', 'Solved', 'Open', 'Δ total vs Excel']);
  printRow('Excel (Summary)', [
    String(excelGrand.total),
    String(excelGrand.solved),
    String(excelGrand.open),
    '0',
  ]);
  printRow('Portal BD MIS (Jun 29)', [
    String(portalEndJun29.bdMis.total),
    String(portalEndJun29.bdMis.solved),
    String(portalEndJun29.bdMis.open),
    String(portalEndJun29.bdMis.total - excelGrand.total),
  ]);
  printRow('Portal Summary (Jun 29)', [
    String(portalEndJun29.summary.total),
    String(portalEndJun29.summary.solved),
    String(portalEndJun29.summary.open),
    String(portalEndJun29.summary.total - excelGrand.total),
  ]);
  printRow('Portal BD MIS (Jun 30)', [
    String(portalEndJun30.bdMis.total),
    String(portalEndJun30.bdMis.solved),
    String(portalEndJun30.bdMis.open),
    String(portalEndJun30.bdMis.total - excelGrand.total),
  ]);

  const dateGap =
    portalEndJun30.bdMis.total - portalEndJun29.bdMis.total;
  const formulaGap =
    portalEndJun29.bdMis.total - portalEndJun29.summary.total;

  console.log('\n=== Gap decomposition (portal Jun 29 vs Excel Jun 30) ===\n');
  printRow('Bucket', ['Rows', 'Explains']);
  printRow('Date: Jun 30 only (est.)', [
    String(dateGap),
    'BD MIS Jun30 − Jun29',
  ]);
  printRow('Summary vs BD MIS formula', [
    String(formulaGap),
    'Account merge vs branch union',
  ]);
  printRow('Mondelez CRM (not swapped in Summary)', [
    String(buckets29.mondelezCrmRows),
    'CRM rows account=Mondelez',
  ]);
  printRow('HCCB/Coke CRM South', [
    String(buckets29.hccbCokeCrmSouth),
    'Subtracted in BD MIS South only',
  ]);
  printRow('Branch − account rollup', [
    String(buckets29.branchMinusAccountRollup),
    'Non–Key-Account CRM in branches',
  ]);
  printRow('Jun 30 CRM rows (if portal Jun 29)', [
    String(buckets29.jun30OnlyCrmRows),
    'Extra day in Excel file',
  ]);

  console.log('\n=== Client import: Raw files vs DB (Jun 29) ===\n');
  printRow('Source', ['Raw file', 'DB import', 'Δ']);
  printRow('Cadbury', [
    String(raw29.cadbury),
    String(buckets29.clientDbCadbury),
    String(buckets29.clientDbCadbury - raw29.cadbury),
  ]);
  printRow('Coke/HCCB', [
    String(raw29.coke),
    String(buckets29.clientDbCoke),
    String(buckets29.clientDbCoke - raw29.coke),
  ]);
  printRow('CRM CSV (ex cancelled)', [
    String(raw29.crm),
    String(portalEndJun29.crmBranchTotal),
    String(portalEndJun29.crmBranchTotal - raw29.crm),
  ]);

  console.log('\n=== CRM branch vs account rollup (Jun 29) ===');
  console.log(`  Branch total (plant-mapped): ${portalEndJun29.crmBranchTotal}`);
  console.log(`  Account rollup total:        ${portalEndJun29.crmAccountTotal}`);
  console.log(
    `  Gap:                       ${portalEndJun29.crmBranchTotal - portalEndJun29.crmAccountTotal}`
  );

  console.log('\n=== Align dates for fair compare ===');
  console.log(
    '  • Portal Jan 1 – 29 Jun vs Excel through 30 Jun → expect ~127 fewer on BD MIS total.'
  );
  console.log(
    '  • Summary Dashboard (CRM + client) now uses BD MIS Excel union in Regional Performance table.'
  );
  console.log(
    '  • Legacy account-merge total was ~336 lower than BD MIS (see Portal Summary row above).'
  );
  console.log(
    '  • Re-import Raw Cadbury.csv + HCCB.xlsx if DB Δ above is non-zero.'
  );

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
