import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { prisma } from '@/lib/db/prisma';
import { querySummaryDashboard } from '@/sql/read-model/summary';

async function main() {
  const data = await querySummaryDashboard({
    startDate: '2026-01-01',
    endDate: '2026-07-02',
    callTypes: ['BREAKDOWN'],
    agingAsOf: '2026-07-02',
  });
  const agra = data.branchSummary.filter((b) => /agra/i.test(b.branch));
  console.log('agra branches', JSON.stringify(agra, null, 2));
  const offices = await prisma.$queryRawUnsafe<
    Array<{ ncode: number; vcompanyname: string; nunder: number | null }>
  >(`SELECT ncode, vcompanyname, nunder FROM dim_offices WHERE vcompanyname ILIKE '%agra%' ORDER BY ncode`);
  console.log('dim', offices);
}

main().catch(console.error);
