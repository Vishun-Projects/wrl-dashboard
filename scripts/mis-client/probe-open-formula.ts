import { config } from 'dotenv';
import { join } from 'path';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import { buildBdMisRegionalRows, sumBdMisRegionalGrand } from '@/lib/report/bd-mis-summary';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  const params = {
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  };
  const crm = await queryBdMisCrmSummary(params);
  const client = await queryClientAccountSummaryForBdMis({
    ...params,
    sourceCodes: ['coke', 'cadbury'],
  });
  const rows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const grand = sumBdMisRegionalGrand(rows);

  for (const r of rows) {
    const aging = r.age_2 + r.age_3 + r.age_7 + r.age_15;
    const fromTotals = r.total_calls - r.total_solved;
    console.log(
      `${r.region}: open=${r.open_calls} aging=${aging} total-solved=${fromTotals} cancelled=${r.cancelled_calls}`
    );
  }
  const gAging = grand.age_2 + grand.age_3 + grand.age_7 + grand.age_15;
  console.log(
    `GRAND: total=${grand.total_calls} solved=${grand.total_solved} open=${grand.open_calls} aging=${gAging} cancelled=${grand.cancelled_calls} all=${grand.total_calls + grand.cancelled_calls}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
