import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';
import { buildCrmTransactionQuery } from '@/modules/mis/services/call-register/sql';

type QueryRow = Record<string, string>;

async function main() {
  const params = { dateFrom: '2026-07-01', dateTo: '2026-07-20' };
  const rawSql = buildCrmTransactionQuery(params);
  const crmRes = await postQuery({ rawSql });
  const crmRows = (crmRes.data || []) as Record<string, string>[];

  const abInbevSerials = crmRows
    .filter(r => (r.Client || '').trim() === 'ABInBeV')
    .map(r => (r.ProductSerialNo || '').trim())
    .filter(Boolean);

  console.log(`ABInBeV CRM serials in July: ${abInbevSerials.length}`);

  if (abInbevSerials.length === 0) return;

  const matches = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, account, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE serial IN (${abInbevSerials.slice(0, 100).map((_, idx) => `$${idx + 1}`).join(', ')})`,
    ...abInbevSerials.slice(0, 100)
  );

  console.log(`Matched calls in calls_latest_hot for 100 sample ABInBeV serials: ${matches.length}`);
  console.log('Sample of ABInBeV matched calls:');
  console.log(matches.slice(0, 10));

  // Let's check daddedon for matched ABInBeV serials
  const sampleSerials = matches.map(m => m.serial);
  if (sampleSerials.length > 0) {
    const crmMatches = await postQuery({
      rawSql: `
        SELECT ProductSerialNo, Client, daddedon
        FROM TransactionEntry
        WHERE ProductSerialNo IN (${sampleSerials.map(s => `'${s}'`).join(', ')})
      `
    });
    console.log('CRM info for matched ABInBeV serials:');
    console.log(crmMatches.data || []);
  }
}

main().catch(console.error);
