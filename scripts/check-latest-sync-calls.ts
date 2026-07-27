import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking latest calls in calls_latest_hot ===');
  const latest = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT id, serial, account, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     ORDER BY logged_at DESC
     LIMIT 10`
  );
  console.log('Latest 10 calls in DB:', latest);

  // Let's count calls logged in July 2026 by account
  const julyCount = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT account, count(*)::int as cnt
     FROM calls_latest_hot
     WHERE logged_at >= '2026-07-01'
     GROUP BY account
     ORDER BY cnt DESC`
  );
  console.log('July 2026 calls by account:', julyCount);
}

main().catch(console.error);
