import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { prisma } from '@/lib/db/prisma';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';

const PERIOD_START = '2026-01-01T00:00:00';
const PERIOD_END = '2026-06-30T23:59:59';

async function count(label: string, extraWhere = '', includePractice = false) {
  const practiceFilter = includePractice ? '' : SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ total: number; open_calls: number; cancelled: number; solved: number }>
  >(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_calls,
      count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled,
      count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${extraWhere}
      ${practiceFilter}
    `,
    PERIOD_START,
    PERIOD_END
  );
  console.log(label, rows[0]);
}

async function main() {
  const breakdown = `AND upper(trim(h.call_type)) = 'BREAKDOWN'`;
  await count('Jan-Jun BREAKDOWN excl practice', breakdown);
  await count('Jan-Jun BREAKDOWN incl practice', breakdown, true);
  await count('Jan-Jun all call types excl practice');
  await count('YTD open/assigned no end date', `AND h.status_bucket IN ('open_unallocated','assigned')`);

  const ytdOpen = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int n FROM calls_latest_hot
     WHERE logged_at >= '2026-01-01' AND status_bucket IN ('open_unallocated','assigned')`
  );
  console.log('My audit scope (YTD open, no end date):', ytdOpen[0].n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect?.());
