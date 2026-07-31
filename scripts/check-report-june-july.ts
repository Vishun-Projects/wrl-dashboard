import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';
import { buildCrmTransactionQuery } from '@/features/report/services/call-register/sql';

type QueryRow = Record<string, string>;

async function main() {
  const params = { dateFrom: '2026-06-01', dateTo: '2026-07-20' };
  const rawSql = buildCrmTransactionQuery(params);
  const crmRes = await postQuery({ rawSql });
  const crmRows = (crmRes.data || []) as Record<string, string>[];

  const campaRows = crmRows.filter(r => (r.Client || '').trim() === 'Reliance Campa Cola');
  console.log(`Campa Cola CRM records in range: ${campaRows.length}`);

  const serials = campaRows.map(r => (r.ProductSerialNo || '').trim()).filter(Boolean);
  if (serials.length === 0) return;

  // Query calls_latest_hot for these serials
  const dbCalls = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE serial IN (${serials.map((_, idx) => `$${idx + 1}`).join(', ')})`,
    ...serials
  );

  console.log(`Found ${dbCalls.length} matched calls in Postgres for these serials:`);
  console.log('Call types:', dbCalls.reduce((acc, c) => { acc[c.call_type] = (acc[c.call_type] || 0) + 1; return acc; }, {} as Record<string, number>));
  console.log('Status buckets:', dbCalls.reduce((acc, c) => { acc[c.status_bucket] = (acc[c.status_bucket] || 0) + 1; return acc; }, {} as Record<string, number>));
  console.log('Status labels:', dbCalls.reduce((acc, c) => { acc[c.status_label] = (acc[c.status_label] || 0) + 1; return acc; }, {} as Record<string, number>));

  // Let's list the ones that are solved or tech_solved
  const completed = dbCalls.filter(c => ['solved', 'tech_solved'].includes(c.status_bucket));
  console.log(`Completed calls: ${completed.length}`);
  if (completed.length > 0) {
    console.log(completed.slice(0, 10));
  }
}

main().catch(console.error);
