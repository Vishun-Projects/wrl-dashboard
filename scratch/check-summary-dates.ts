import dotenv from 'dotenv';
import path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

async function run() {
  const readModelUrl = process.env.DATABASE_URL;
  if (!readModelUrl) return;

  const client = new Client({ connectionString: readModelUrl });
  await client.connect();

  try {
    // Current month dates (e.g. August 2026)
    const periodStart = '2026-08-01T00:00:00Z';
    const periodEnd = '2026-08-09T23:59:59Z';
    const agingDate = '2026-08-09';

    console.log(`Testing month_to_date: ${periodStart} to ${periodEnd}`);

    // Query 1: branchRows with date filter
    const res1 = await client.query(
      `SELECT count(*)::int AS open_calls
       FROM calls_latest_hot h
       LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
       WHERE h.call_type = 'BREAKDOWN'
         AND h.logged_at >= $1::timestamptz
         AND h.logged_at <= $2::timestamptz
         AND h.status_bucket IN ('open_unallocated', 'assigned')
         AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`,
      [periodStart, periodEnd]
    );
    console.log('Open calls in month_to_date (from branchRows):', res1.rows[0].open_calls);

    // Query 2: agingRows with date filter
    const res2 = await client.query(
      `SELECT 
         SUM(CASE WHEN ($1::date - h.logged_at::date) <= 2 THEN 1 ELSE 0 END)::int AS age_2,
         SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 3 AND 7 THEN 1 ELSE 0 END)::int AS age_3,
         SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS age_7,
         SUM(CASE WHEN ($1::date - h.logged_at::date) > 15 THEN 1 ELSE 0 END)::int AS age_15
       FROM calls_latest_hot h
       LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
       WHERE h.call_type = 'BREAKDOWN'
         AND h.logged_at >= $2::timestamptz
         AND h.logged_at <= $3::timestamptz
         AND h.status_bucket IN ('open_unallocated', 'assigned')
         AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`,
      [agingDate, periodStart, periodEnd]
    );
    const agingFiltered = res2.rows[0];
    const openFiltered = (agingFiltered.age_2 || 0) + (agingFiltered.age_3 || 0) + (agingFiltered.age_7 || 0) + (agingFiltered.age_15 || 0);
    console.log('Open calls in month_to_date (from agingRows with start date filter):', agingFiltered, 'Sum:', openFiltered);

    // Query 3: agingRows WITHOUT start date filter (i.e. all open calls logged on or before periodEnd)
    const res3 = await client.query(
      `SELECT 
         SUM(CASE WHEN ($1::date - h.logged_at::date) <= 2 THEN 1 ELSE 0 END)::int AS age_2,
         SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 3 AND 7 THEN 1 ELSE 0 END)::int AS age_3,
         SUM(CASE WHEN ($1::date - h.logged_at::date) BETWEEN 8 AND 15 THEN 1 ELSE 0 END)::int AS age_7,
         SUM(CASE WHEN ($1::date - h.logged_at::date) > 15 THEN 1 ELSE 0 END)::int AS age_15
       FROM calls_latest_hot h
       LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
       WHERE h.call_type = 'BREAKDOWN'
         AND h.logged_at <= $2::timestamptz
         AND h.status_bucket IN ('open_unallocated', 'assigned')
         AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`,
      [agingDate, periodEnd]
    );
    const agingUnfiltered = res3.rows[0];
    const openUnfiltered = (agingUnfiltered.age_2 || 0) + (agingUnfiltered.age_3 || 0) + (agingUnfiltered.age_7 || 0) + (agingUnfiltered.age_15 || 0);
    console.log('Open calls WITHOUT start date filter (all open calls as of periodEnd):', agingUnfiltered, 'Sum:', openUnfiltered);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
