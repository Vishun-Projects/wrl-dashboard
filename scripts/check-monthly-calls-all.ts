import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { prisma } from '@/lib/db/prisma';

type QueryRow = Record<string, string>;

async function main() {
  console.log('=== Checking monthly calls in calls_latest_hot for all accounts ===');
  const res = await prisma.$queryRawUnsafe<QueryRow[]>(
    `SELECT account, 
            TO_CHAR(logged_at, 'YYYY-MM') as month_yr, 
            count(*)::int as cnt
     FROM calls_latest_hot
     WHERE logged_at >= '2026-01-01'
     GROUP BY account, TO_CHAR(logged_at, 'YYYY-MM')
     ORDER BY month_yr DESC, cnt DESC`
  );
  console.log(res);
}

main().catch(console.error);
