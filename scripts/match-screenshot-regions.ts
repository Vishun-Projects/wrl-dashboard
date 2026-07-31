import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { querySummaryDashboard } from '@/sql/read-model/summary';

const targets = {
  'NORTH ZONE': 12088,
  'EAST ZONE': 18189,
  'SOUTH ZONE': 43988,
  'WEST ZONE': 138,
};

async function main() {
  const ranges = [
    ['2026-07-01', '2026-07-03'],
    ['2026-06-01', '2026-06-30'],
    ['2026-05-01', '2026-05-31'],
    ['2026-04-01', '2026-04-30'],
    ['2026-01-01', '2026-03-31'],
    ['2026-01-01', '2026-06-30'],
    ['2026-01-01', '2026-07-03'],
  ];

  for (const [start, end] of ranges) {
    const data = await querySummaryDashboard({
      startDate: start,
      endDate: end,
      agingAsOf: end,
      callTypes: ['BREAKDOWN'],
    });
    const byRegion = Object.fromEntries(
      [...new Set(data.accountSummary.map((a) => a.region))].map((region) => [
        region,
        data.accountSummary
          .filter((a) => a.region === region)
          .reduce((s, a) => s + a.total_solved, 0),
      ])
    );
    const matches = Object.entries(targets).filter(
      ([region, target]) => byRegion[region] === target
    );
    if (matches.length) {
      console.log(`MATCH ${start} to ${end}:`, matches);
    }
    console.log(start, end, byRegion);
  }
}

main().catch(console.error);
