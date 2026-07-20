import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';

async function main() {
  console.log('=== Checking July CRM serials for Campa Cola ===');
  const crmRes = await postQuery({
    rawSql: `
      SELECT TOP 50 ProductSerialNo, Client, daddedon, InstallationDate
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND TRY_CONVERT(DATETIME, daddedon, 103) >= '2026-07-01'
        AND TRY_CONVERT(DATETIME, daddedon, 103) <= '2026-07-20 23:59:59'
    `
  });
  const rows = crmRes.data || [];
  console.log('Total sample rows:', rows.length);
  console.log(rows);
}

main().catch(console.error);
