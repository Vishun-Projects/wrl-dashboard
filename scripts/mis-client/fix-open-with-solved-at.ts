import { config } from 'dotenv';
import { join } from 'path';
import { withAppClient } from '@/lib/read-model/db';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/lib/mis-client-import/aggregate';
import { buildBdMisRegionalRows, sumBdMisRegionalGrand } from '@/lib/report/bd-mis-summary';

config({ path: join(process.cwd(), '.env.local') });

async function main() {
  await withAppClient(async (c) => {
    const r = await c.query(`UPDATE calls_latest_hot
      SET status_bucket = 'solved', status_label = 'Closed', bsolved = true, bfastclose = false
      WHERE logged_at >= '2026-01-01' AND logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(call_type))='BREAKDOWN'
        AND status_bucket IN ('open_unallocated','assigned')
        AND solved_at IS NOT NULL`);
    console.log('Fixed open rows with solved_at:', r.rowCount);
  });

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
  const g = sumBdMisRegionalGrand(rows);
  console.log('GRAND', {
    total: g.total_calls,
    solved: g.total_solved,
    open: g.open_calls,
    cancelled: g.cancelled_calls,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
