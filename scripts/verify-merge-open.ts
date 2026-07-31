import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { querySummaryDashboard } from '@/sql/read-model/summary';
import { queryClientAccountSummaryForBdMis } from '@/modules/mis/client-import/services/aggregate';
import {
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
} from '@/modules/mis/services/bd-mis-summary';

const params = {
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  agingAsOf: '2026-06-30',
  callTypes: ['BREAKDOWN'],
};

function sumOpen(rows: { open_calls: number }[]) {
  return rows.reduce((s, r) => s + r.open_calls, 0);
}

function sumAccountOpen(
  accounts: { account: string; region: string; open_calls: number }[],
  pred: (a: string) => boolean
) {
  return accounts.filter((a) => pred(a.account)).reduce((s, a) => s + a.open_calls, 0);
}

async function main() {
  const crm = await querySummaryDashboard(params);
  const client = await queryClientAccountSummaryForBdMis({
    startDate: params.startDate,
    endDate: params.endDate,
    agingAsOf: params.agingAsOf,
    sourceCodes: ['cadbury', 'coke'],
  });

  const crmBranchOpen = sumOpen(crm.branchSummary);
  const crmAccountOpen = sumOpen(crm.accountSummary);

  const crmCadburyOpen = sumAccountOpen(crm.accountSummary, (a) =>
    /^(cadbury|mondelez)$/i.test(a.trim())
  );
  const crmCokeOpen = sumAccountOpen(crm.accountSummary, (a) => /^(coke|hccb)$/i.test(a.trim()));

  const clientCadburyOpen = sumAccountOpen(client, (a) => a.toLowerCase() === 'cadbury');
  const clientCokeOpen = sumAccountOpen(client, (a) => a.toLowerCase() === 'coke');

  const unionRows = buildBdMisRegionalRows({
    crmBranchSummary: crm.branchSummary,
    crmAccountSummary: crm.accountSummary,
    clientAccountSummary: client,
    sources: { crm: true, cadbury: true, coke: true },
  });
  const unionGrand = sumBdMisRegionalGrand(unionRows);

  const naiveSum = crmBranchOpen + clientCadburyOpen + clientCokeOpen;
  const replacementSum = crmBranchOpen - crmCadburyOpen + clientCadburyOpen + clientCokeOpen;

  console.log('Jan-Jun BREAKDOWN open_calls breakdown:\n');
  console.log('  CRM branch open (all):', crmBranchOpen);
  console.log('  CRM account open sum: ', crmAccountOpen);
  console.log('  CRM Cadbury/Mondelez open:', crmCadburyOpen);
  console.log('  CRM Coke/HCCB open:     ', crmCokeOpen);
  console.log('  Client Cadbury open:    ', clientCadburyOpen);
  console.log('  Client Coke open:       ', clientCokeOpen);
  console.log('');
  console.log('  Naive CRM + client cadbury + client coke:', naiveSum);
  console.log('  Excel replace (CRM - CRM cadbury + client cadbury + client coke):', replacementSum);
  console.log('  buildBdMisRegionalRows grand open:', unionGrand.open_calls);
  console.log('  User naive (5036+711+161+20):', 5036 + 711 + 161 + 20);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
