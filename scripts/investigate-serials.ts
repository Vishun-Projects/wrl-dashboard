import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';

type QueryRow = Record<string, string>;

async function main() {
  // Let's get 50 serials from calls_latest_hot for Reliance Campa Cola
  const hotRows = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, logged_at
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND serial IS NOT NULL AND serial <> ''
     ORDER BY logged_at DESC
     LIMIT 50`
  );
  console.log('Sample serials from calls_latest_hot:', hotRows.map(r => r.serial));

  // Let's check if any of these hot serials exist in CRM TransactionEntry
  if (hotRows.length > 0) {
    const serialList = hotRows.map(r => r.serial.trim());
    const crmMatches = await postQuery({
      rawSql: `
        SELECT ProductSerialNo, Client, daddedon
        FROM TransactionEntry
        WHERE ProductSerialNo IN (${serialList.map(s => `'${s}'`).join(', ')})
      `
    });
    console.log('CRM matches for hot serials:', crmMatches.data || []);
  }

  // Let's also check if the serials in CRM match but maybe have formatting differences (e.g. leading zeros, spaces, length, etc.)
  // Let's check the length distribution of serials in both
  const hotLen = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT length(trim(serial)) as len, count(*) as c
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND serial IS NOT NULL AND serial <> ''
     GROUP BY 1 ORDER BY 1`
  );
  console.log('Serial length distribution in calls_latest_hot:', hotLen);

  const crmLen = await postQuery({
    rawSql: `
      SELECT len(trim(ProductSerialNo)) as len, count(*) as c
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
      GROUP BY len(trim(ProductSerialNo))
      ORDER BY len
    `
  });
  console.log('Serial length distribution in CRM TransactionEntry:', crmLen.data || []);
}

main().catch(console.error);
