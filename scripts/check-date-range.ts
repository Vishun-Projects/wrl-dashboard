import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';
import { buildCrmTransactionQuery } from '@/modules/mis/services/call-register/sql';

async function checkDateRange(start: string, end: string) {
  const rawSql = buildCrmTransactionQuery({ dateFrom: start, dateTo: end });
  const crmRes = await postQuery({ rawSql });
  const rows = crmRes.data || [];

  const counts: Record<string, number> = {};
  for (const r of rows) {
    const client = (r.Client || 'Unknown').trim();
    counts[client] = (counts[client] || 0) + 1;
  }
  console.log(`=== Date Range ${start} to ${end} ===`);
  console.log(counts);
}

async function main() {
  await checkDateRange('2026-07-01', '2026-07-20');
}

main().catch(console.error);
