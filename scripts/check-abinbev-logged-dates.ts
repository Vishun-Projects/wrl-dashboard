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
     WHERE serial IN (${abInbevSerials.map((_, idx) => `$${idx + 1}`).join(', ')})`,
    ...abInbevSerials
  );

  console.log(`Matched calls in calls_latest_hot for July ABInBeV serials: ${matches.length}`);
  
  // Count logged_at year-month distribution for matched ABInBeV serials
  const loggedDist: Record<string, number> = {};
  for (const m of matches) {
    const d = new Date(m.logged_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    loggedDist[key] = (loggedDist[key] || 0) + 1;
  }
  console.log('Logged dates (Year-Month) distribution for matched ABInBeV serials:', loggedDist);
}

main().catch(console.error);
