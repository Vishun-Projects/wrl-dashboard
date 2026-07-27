import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking June CRM records for Campa Cola ===');

  const res = await postQuery({
    rawSql: `
      SELECT COUNT(*) as cnt
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
        AND TRY_CONVERT(datetime, daddedon, 103) >= '2026-06-01'
        AND TRY_CONVERT(datetime, daddedon, 103) <= '2026-06-30 23:59:59'
    `
  });
  console.log('CRM records in June:', res.data);

  // Let's get the serials in June
  const res2 = await postQuery({
    rawSql: `
      SELECT ProductSerialNo
      FROM TransactionEntry
      WHERE Client = 'Reliance Campa Cola'
        AND ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
        AND TRY_CONVERT(datetime, daddedon, 103) >= '2026-06-01'
        AND TRY_CONVERT(datetime, daddedon, 103) <= '2026-06-30 23:59:59'
    `
  });
  const serials = (res2.data || []).map((r: QueryRow) => r.ProductSerialNo.trim()).filter(Boolean);
  console.log('Total serials in June:', serials.length);

  if (serials.length === 0) return;

  // Let's check matches in calls_latest_hot
  const dbCalls = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE serial IN (${serials.map((_, idx) => `$${idx + 1}`).join(', ')})`,
    ...serials
  );
  console.log(`Matched calls in DB: ${dbCalls.length}`);
}

main().catch(console.error);
