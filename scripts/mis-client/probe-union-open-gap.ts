import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/features/mis-import/lib/aggregate';
import {
  buildBdMisRegionalBreakdown,
  buildBdMisRegionalRows,
  openCallsFromTotals,
  sumBdMisRegionalGrand,
} from '@/features/report/lib/bd-mis-summary';
import { withAppClient } from '@/lib/read-model/db';

const END = '2026-06-29';
const EXCEL_OPEN: Record<string, number> = {
  'NORTH ZONE': 2501,
  'EAST ZONE': 1496,
  'WEST ZONE': 1542,
  'SOUTH ZONE': 3234,
  GRAND: 8773,
};

async function main() {
  const params = {
    startDate: '2026-01-01',
    endDate: END,
    agingAsOf: END,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };

  const crm = await queryBdMisCrmSummary(params);
  const client = await queryClientAccountSummaryForBdMis({
    ...params,
    sourceCodes: ['coke', 'cadbury'],
  });

  let crmBranchOpen = 0;
  for (const b of crm.branchSummary) crmBranchOpen += b.open_calls ?? 0;

  const breakdown = buildBdMisRegionalBreakdown({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });

  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);

  const rawHot = await withAppClient(async (c) => {
    const r = await c.query<{ all_open: number; no_practice_open: number }>(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS all_open,
        count(*) FILTER (
          WHERE h.status_bucket IN ('open_unallocated','assigned')
            AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX)'
        )::int AS no_practice_open
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
    `);
    return r.rows[0];
  });

  console.log({
    rawHotOpen: rawHot.all_open,
    rawHotOpenNoPractice: rawHot.no_practice_open,
    crmQueryBranchOpenSum: crmBranchOpen,
    unionGrandOpen: grand.open_calls,
    excelGrandOpen: EXCEL_OPEN.GRAND,
    deltaVsExcel: grand.open_calls - EXCEL_OPEN.GRAND,
  });

  console.log('\nPer zone open (result vs excel):');
  for (const b of breakdown) {
    const crmOpen = openCallsFromTotals(b.crmBranchBase);
    const clientCadOpen = openCallsFromTotals(b.addClientCadbury);
    const clientCokeOpen = openCallsFromTotals(b.addClientCoke);
    const subCadOpen = openCallsFromTotals(b.subtractCrmCadbury);
    const ref = EXCEL_OPEN[b.region];
    console.log(
      `${b.region}: union=${b.result.open_calls} excel=${ref} Δ=${b.result.open_calls - ref} | crm=${crmOpen} -cad=${subCadOpen} +clientCad=${clientCadOpen} +clientCoke=${clientCokeOpen}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
