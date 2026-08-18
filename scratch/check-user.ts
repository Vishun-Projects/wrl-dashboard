import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

import { prisma } from '../src/lib/db/prisma';

async function run() {
  // Let's get the date range that the email would use for "year_to_yesterday"
  // Yesterday's date in IST
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  
  const startDate = '2026-01-01T00:00:00Z';
  const endDate = `${yesterdayStr}T23:59:59Z`;

  console.log(`Querying date range: ${startDate} to ${endDate}`);

  // Query counts for BREAKDOWN
  const counts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 
       count(*)::int AS total,
       count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved,
       count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled,
       count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open
     FROM calls_latest_hot h
     LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
     WHERE h.call_type = 'BREAKDOWN'
       AND h.logged_at >= $1::timestamptz
       AND h.logged_at <= $2::timestamptz
       AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`,
    startDate,
    endDate
  );
  console.log('Counts with date range (BREAKDOWN):', counts[0]);
}

run().catch(console.error);
