/**
 * Compare BD MIS regional totals vs BD_MIS Excel Summary sheet.
 *
 * Usage:
 *   npx tsx scripts/mis-client/compare-regional-report.ts [path-to-xlsx] [end-date]
 *
 * end-date: portal query end (YYYY-MM-DD). Default 2026-06-29.
 * Match this to your Excel export: e.g. New_BD_MIS_30.06.2026.xlsx → use 2026-06-30.
 *
 * Date mismatch is the most common source of ~100+ row gaps vs a workbook named for 30-Jun.
 */
import { config } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import {
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
} from '@/lib/report/bd-mis-summary';

const DEFAULT_XLSX =
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';

function resolveParams(endDate: string) {
  return {
    startDate: '2026-01-01',
    endDate,
    agingAsOf: endDate,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };
}

type RefRow = {
  total: number;
  solved: number;
  open: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  eng: number;
};

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
      eng: Number(r[8] ?? 0),
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
      eng: Number(totalRow[8] ?? 0),
    });
  }

  return targets;
}

function zoneLabel(zone: string): string {
  return zone.replace(/\s+ZONE$/i, '');
}

async function main() {
  const xlsxPath = process.argv[2] ?? DEFAULT_XLSX;
  const endDate = process.argv[3] ?? '2026-06-29';
  const params = resolveParams(endDate);

  if (!existsSync(xlsxPath)) {
    console.error(`Excel not found: ${xlsxPath}`);
    process.exit(1);
  }

  console.log(`Portal date range: ${params.startDate} → ${params.endDate} (aging ${params.agingAsOf})`);
  if (xlsxPath.includes('30.06') && endDate < '2026-06-30') {
    console.warn(
      'WARNING: Excel filename suggests 30-Jun data but portal end date is earlier. Re-run with end-date 2026-06-30.\n'
    );
  }

  const ref = loadExcelTargets(xlsxPath);
  const crm = await queryBdMisCrmSummary(params);
  const clientAccounts = await queryClientAccountSummaryForBdMis({
    startDate: params.startDate,
    endDate: params.endDate,
    agingAsOf: params.agingAsOf,
    sourceCodes: ['coke', 'cadbury'],
  });

  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: clientAccounts,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);

  console.log(`=== BD MIS APP vs ${xlsxPath} (Summary sheet) ===\n`);
  let failures = 0;

  for (const row of rows) {
    const r = ref.get(row.region);
    if (!r) continue;
    const checks: Array<[string, number, number]> = [
      ['total', row.total_calls, r.total],
      ['solved', row.total_solved, r.solved],
      ['open', row.open_calls, r.open],
    ];
    console.log(`${zoneLabel(row.region)}:`);
    for (const [label, actual, expected] of checks) {
      const delta = actual - expected;
      if (delta !== 0) failures++;
      console.log(`  ${label}: ${actual} (ref ${expected}, Δ${delta})`);
    }
  }

  const g = ref.get('GRAND');
  if (g) {
    const delta = grand.total_calls - g.total;
    if (delta !== 0) failures++;
    console.log(`\nGRAND total: ${grand.total_calls} (ref ${g.total}, Δ${delta})`);
  }

  if (failures > 0) {
    console.log(`\n${failures} metric(s) differ from Excel.`);
    process.exit(1);
  }
  console.log('\nAll compared metrics match Excel.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
