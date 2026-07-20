import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';

async function main() {
  console.log('=== Checking total CRM records for Campa Cola ===');
  const res = await postQuery({
    rawSql: `
      SELECT COUNT(*) as cnt
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
    `
  });
  console.log('Total Campa Cola records in CRM:', res.data);

  // Let's also check date added distribution for Campa Cola in CRM
  const distRes = await postQuery({
    rawSql: `
      SELECT SUBSTRING(daddedon, 4, 7) as month_yr, COUNT(*) as cnt
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
      GROUP BY SUBSTRING(daddedon, 4, 7)
    `
  });
  console.log('Monthly distribution in CRM:', distRes.data);
}

main().catch(console.error);
