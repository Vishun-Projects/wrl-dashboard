import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { querySummaryDashboard } from '@/sql/read-model/summary';

async function main() {
  const data = await querySummaryDashboard({
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    agingAsOf: '2026-06-30',
    callTypes: ['BREAKDOWN'],
  });

  const branchOpen = data.branchSummary.reduce((s, b) => s + b.open_calls, 0);
  const accountOpen = data.accountSummary.reduce((s, a) => s + a.open_calls, 0);
  const agingOpen = data.accountSummary.reduce(
    (s, a) => s + a.age_2 + a.age_3 + a.age_7 + a.age_15,
    0
  );

  console.log('Jan-Jun BREAKDOWN, excl practice:');
  console.log('  Branch open_calls sum:', branchOpen);
  console.log('  Account open_calls sum:', accountOpen);
  console.log('  Account aging buckets sum (old KMIS logic):', agingOpen);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
