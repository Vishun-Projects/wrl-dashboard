import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { queryClientAccountSummaryForBdMis } from '@/features/mis-import/services/aggregate';
import { openCallsFromTotals } from '@/features/report/services/bd-mis-summary';

const p = {
  startDate: '2026-01-01',
  endDate: '2026-06-29',
  agingAsOf: '2026-06-29',
  callTypes: ['BREAKDOWN'],
  isHod: true,
};

async function main() {
  const crm = await queryBdMisCrmSummary(p);
  const client = await queryClientAccountSummaryForBdMis({
    ...p,
    sourceCodes: ['coke', 'cadbury'],
  });

  console.log('CRM Cadbury/Mondelez account rows (open from totals):');
  for (const a of crm.accountSummary) {
    const acct = a.account?.toLowerCase() ?? '';
    if (acct !== 'cadbury' && acct !== 'mondelez') continue;
    console.log(
      `  ${a.region} ${a.account}: total=${a.total_calls} solved=${a.total_solved} open=${openCallsFromTotals(a)} open_calls=${a.open_calls}`
    );
  }

  console.log('\nClient Cadbury account rows:');
  for (const a of client) {
    if ((a.account ?? '').toLowerCase() !== 'cadbury') continue;
    console.log(
      `  ${a.region} ${a.account}: total=${a.total_calls} solved=${a.total_solved} open=${openCallsFromTotals(a)}`
    );
  }

  console.log('\nClient Coke (South rollup):');
  for (const a of client) {
    if ((a.account ?? '').toLowerCase() !== 'coke') continue;
    console.log(
      `  ${a.region} ${a.account}: total=${a.total_calls} solved=${a.total_solved} open=${openCallsFromTotals(a)}`
    );
  }

  let crmCadOpen = 0;
  for (const a of crm.accountSummary) {
    const acct = a.account?.toLowerCase() ?? '';
    if (acct === 'cadbury' || acct === 'mondelez') {
      crmCadOpen += openCallsFromTotals(a);
    }
  }
  let clientCadOpen = 0;
  let clientCokeOpen = 0;
  for (const a of client) {
    const acct = (a.account ?? '').toLowerCase();
    if (acct === 'cadbury') clientCadOpen += openCallsFromTotals(a);
    if (acct === 'coke') clientCokeOpen += openCallsFromTotals(a);
  }
  console.log('\nTotals:', { crmCadOpen, clientCadOpen, clientCokeOpen, netClientCad: clientCadOpen - crmCadOpen });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
