import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

async function main() {
  console.log('=== Reliance Campa Cola Call Types and Counts ===');
  const counts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT call_type, count(*)::int as c,
      count(*) filter (where status_bucket = 'solved')::int as solved,
      count(*) filter (where status_bucket = 'tech_solved')::int as tech_solved,
      count(*) filter (where status_label ilike '%solved%')::int as label_solved,
      count(*) filter (where status_label ilike '%completed%')::int as label_completed
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
     GROUP BY call_type`
  );
  console.log(counts);

  console.log('\n=== Sample Reliance Campa Cola Serials and Call Types ===');
  const samples = await prisma.$queryRawUnsafe<any[]>(
    `SELECT serial, call_type, status_bucket, status_label
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND serial IS NOT NULL AND serial <> ''
     LIMIT 10`
  );
  console.log(samples);

  console.log('\n=== Comparing some TransactionEntry serials with calls_latest_hot ===');
  // Fetch from CRM database using postQuery
  const { postQuery } = await import('@/lib/db/proxy');
  const crmRes = await postQuery({
    rawSql: `
      SELECT DISTINCT TOP 10 ProductSerialNo, Client
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
    `
  });
  const crmSerials = crmRes.data || [];
  console.log('CRM Serials:', crmSerials);

  if (crmSerials.length > 0) {
    const serialList = crmSerials.map((s: any) => s.ProductSerialNo.trim());
    const matches = await prisma.$queryRawUnsafe<any[]>(
      `SELECT serial, account, call_type, status_bucket, status_label
       FROM calls_latest_hot
       WHERE serial IN (${serialList.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...serialList
    );
    console.log('Matches in calls_latest_hot for these CRM serials:', matches);
  }
}

main().catch(console.error);
