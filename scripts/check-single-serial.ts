import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking serial 42484260615341 in DB ===');
  const res = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT serial, account, call_type, status_bucket, status_label, logged_at
     FROM calls_latest_hot
     WHERE serial = '42484260615341'`
  );
  console.log('Record in calls_latest_hot:', res);
}

main().catch(console.error);
