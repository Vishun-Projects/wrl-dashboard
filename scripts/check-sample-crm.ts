import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';

async function main() {
  const serials = ['IN6811946758', '42484260201194', '42484260201191', '32783260100158'];
  console.log('=== Checking specific serials in CRM ===');
  const crmRes = await postQuery({
    rawSql: `
      SELECT ProductSerialNo, Client, daddedon
      FROM TransactionEntry
      WHERE ProductSerialNo IN (${serials.map(s => `'${s}'`).join(', ')})
    `
  });
  console.log(crmRes.data || []);
}

main().catch(console.error);
