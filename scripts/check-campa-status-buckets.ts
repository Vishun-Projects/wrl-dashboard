import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking Campa Cola status_bucket distribution ===');
  const res = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT status_bucket, count(*)::int as cnt
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
     GROUP BY status_bucket`
  );
  console.log('Status bucket distribution:', res);

  const res2 = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT status_label, count(*)::int as cnt
     FROM calls_latest_hot
     WHERE account = 'Reliance Campa Cola'
     GROUP BY status_label`
  );
  console.log('Status label distribution:', res2);
}

main().catch(console.error);
