import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking serial number formats ===');

  // Sample 20 serials from calls_latest_hot
  const dbCalls = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, status_bucket, logged_at
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND call_type IN ('INSTALLATION CALL', 'INSTALLATION', 'Deployment', 'DEPLOYMENT', 'DEPLOYMENT CALL')
     LIMIT 20`
  );
  console.log('DB Serials (calls_latest_hot):');
  for (const c of dbCalls) {
    console.log(`- '${c.serial}' (length: ${c.serial.length})`);
  }

  // Sample 20 serials from CRM
  const crmRes = await postQuery({
    rawSql: `
      SELECT TOP 20 ProductSerialNo
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
    `
  });
  console.log('CRM Serials:');
  const crmRows = crmRes.data || [];
  for (const r of crmRows) {
    const s = r.ProductSerialNo;
    console.log(`- '${s}' (length: ${s.length})`);
  }
}

main().catch(console.error);
