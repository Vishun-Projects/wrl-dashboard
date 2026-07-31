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
  
  // 1. Fetch CRM rows
  const rawSql = buildCrmTransactionQuery(params);
  const crmRes = await postQuery({ rawSql });
  const crmRows = (crmRes.data || []) as Record<string, string>[];

  const campaColaSerials = crmRows
    .filter(r => (r.Client || '').trim() === 'Reliance Campa Cola')
    .map(r => (r.ProductSerialNo || '').trim())
    .filter(Boolean);

  console.log(`Campa Cola CRM serials in July: ${campaColaSerials.length}`);

  if (campaColaSerials.length === 0) return;

  // Let's check if any of these serials exist in calls_latest_hot at all
  const CHUNK_SIZE = 500;
  const matches: QueryRow[] = [];
  for (let i = 0; i < campaColaSerials.length; i += CHUNK_SIZE) {
    const chunk = campaColaSerials.slice(i, i + CHUNK_SIZE);
    const dbRows = await prisma.$queryRawUnsafe<QueryRow[]>(
      `SELECT serial, account, call_type, status_bucket, status_label, logged_at
       FROM calls_latest_hot
       WHERE serial IN (${chunk.map((_, idx) => `$${idx + 1}`).join(', ')})`,
      ...chunk
    );
    matches.push(...dbRows);
  }

  console.log(`Matched calls in calls_latest_hot for July serials: ${matches.length}`);
  if (matches.length > 0) {
    console.log('Sample of matched calls:');
    console.log(matches.slice(0, 10));

    // Let's count call types and statuses in matches
    const callTypes: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    const accounts: Record<string, number> = {};
    for (const m of matches) {
      callTypes[m.call_type] = (callTypes[m.call_type] || 0) + 1;
      statuses[m.status_bucket] = (statuses[m.status_bucket] || 0) + 1;
      accounts[m.account] = (accounts[m.account] || 0) + 1;
    }
    console.log('Call Types distribution in matches:', callTypes);
    console.log('Status Buckets distribution in matches:', statuses);
    console.log('Accounts distribution in matches:', accounts);
  }
}

main().catch(console.error);
