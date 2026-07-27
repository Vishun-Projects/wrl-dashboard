import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking Campa Cola calls in July 2026 ===');
  const res = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, account, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
       AND logged_at >= '2026-07-01' AND logged_at <= '2026-07-20 23:59:59'`
  );
  console.log(`Found ${res.length} calls:`);
  console.log(res);
}

main().catch(console.error);
