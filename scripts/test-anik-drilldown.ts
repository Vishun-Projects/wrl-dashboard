import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { prisma } from '@/lib/db/prisma';
import { querySummaryDrilldown } from '@/lib/read-model/queries/drilldown';

async function main() {
  const accounts = await prisma.$queryRawUnsafe<Array<{ account: string; region: string; c: number }>>(
    `SELECT h.account, h.region, count(*)::int as c
     FROM calls_latest_hot h
     WHERE h.account ILIKE '%anik%'
       AND h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-07-01 23:59:59'
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND h.status_bucket IN ('solved', 'tech_solved')
     GROUP BY h.account, h.region`
  );
  console.log('db accounts', accounts);

  const rows = await querySummaryDrilldown({
    type: 'total_solved',
    account: 'Anik Milk',
    region: 'WEST ZONE',
    startDate: '2026-01-01',
    endDate: '2026-07-01',
    callType: 'BREAKDOWN',
    isHod: true,
  });
  console.log('drilldown count', rows.length);
  console.log(rows);
}

main().catch(console.error);
