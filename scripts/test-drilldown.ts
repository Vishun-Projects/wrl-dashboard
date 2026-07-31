import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { querySummaryDrilldown } from '@/sql/read-model/drilldown';

async function main() {
  const rows = await querySummaryDrilldown({
    type: 'total_calls',
    officeId: '21',
    startDate: '2026-01-01',
    endDate: '2026-07-02',
    callType: 'BREAKDOWN',
    isHod: true,
  });
  console.log('agra count', rows.length);
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
