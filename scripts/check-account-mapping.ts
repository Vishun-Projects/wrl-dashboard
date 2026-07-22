import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';
import { buildCrmTransactionQuery } from '@/features/report/lib/call-register/sql';

async function main() {
  const params = { dateFrom: '2026-07-01', dateTo: '2026-07-20' };
  const rawSql = buildCrmTransactionQuery(params);
  const crmRes = await postQuery({ rawSql });
  const crmRows = (crmRes.data || []) as Record<string, string>[];

  const campaSerials = crmRows
    .filter(r => (r.Client || '').trim() === 'Reliance Campa Cola')
    .map(r => (r.ProductSerialNo || '').trim())
    .filter(Boolean);

  console.log(`Campa Cola CRM serials: ${campaSerials.length}`);

  if (campaSerials.length === 0) return;

  // Let's query DB for matches regardless of account
  const chunks = [];
  const chunkSize = 200;
  for (let i = 0; i < campaSerials.length; i += chunkSize) {
    chunks.push(campaSerials.slice(i, i + chunkSize));
  }

  let totalMatches = 0;
  const accounts: Record<string, number> = {};

  for (const chunk of chunks.slice(0, 50)) { // check first 10,000 serials
    const dbMatches = await prisma.$queryRawUnsafe<any[]>(
      `SELECT serial, account, call_type, status_bucket, status_label
       FROM calls_latest_hot
       WHERE serial IN (${chunk.map((_, idx) => `$${idx + 1}`).join(', ')})`,
      ...chunk
    );
    totalMatches += dbMatches.length;
    for (const m of dbMatches) {
      accounts[m.account] = (accounts[m.account] || 0) + 1;
    }
  }

  console.log(`Checked first 10,000 serials. Total matches found: ${totalMatches}`);
  console.log('Accounts of matches:', accounts);
}

main().catch(console.error);
