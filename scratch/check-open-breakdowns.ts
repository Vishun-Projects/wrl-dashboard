import dotenv from 'dotenv';
import path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

async function run() {
  const readModelUrl = process.env.DATABASE_URL;
  if (!readModelUrl) {
    console.error('DATABASE_URL is missing in .env.local');
    return;
  }
  const client = new Client({ connectionString: readModelUrl });
  await client.connect();
  try {
    // 1. Total open breakdown calls in calls_latest_hot (no date filter, no office filter)
    const res1 = await client.query(
      `SELECT count(*)::int AS count 
       FROM calls_latest_hot 
       WHERE call_type = 'BREAKDOWN' 
         AND status_bucket IN ('open_unallocated', 'assigned')`
    );
    console.log('1. Open breakdowns (no filters):', res1.rows[0].count);

    // 2. Total open breakdown calls in calls_latest_hot (excluding practice/winmax offices, no date filter)
    const res2 = await client.query(
      `SELECT count(*)::int AS count 
       FROM calls_latest_hot h
       LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
       WHERE h.call_type = 'BREAKDOWN' 
         AND h.status_bucket IN ('open_unallocated', 'assigned')
         AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`
    );
    console.log('2. Open breakdowns (excluding practice offices, no date filter):', res2.rows[0].count);

    // 3. Open breakdown calls in calls_latest_hot logged in 2026 (excluding practice/winmax offices)
    const res3 = await client.query(
      `SELECT count(*)::int AS count 
       FROM calls_latest_hot h
       LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
       WHERE h.call_type = 'BREAKDOWN' 
         AND h.status_bucket IN ('open_unallocated', 'assigned')
         AND h.logged_at >= '2026-01-01T00:00:00Z'
         AND COALESCE(d.vcompanyname, h.branch_name, h.franchisee_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`
    );
    console.log('3. Open breakdowns (logged >= 2026-01-01, excluding practice):', res3.rows[0].count);

    // 4. Let's see some example open calls to check their logged_at date distribution
    const res4 = await client.query(
      `SELECT MIN(logged_at) AS earliest, MAX(logged_at) AS latest, COUNT(*)::int AS count
       FROM calls_latest_hot
       WHERE call_type = 'BREAKDOWN'
         AND status_bucket IN ('open_unallocated', 'assigned')`
    );
    console.log('4. Logged date range of all open breakdowns:', res4.rows[0]);

    // 5. Check what call statuses exist in the DB for BREAKDOWN calls
    const res5 = await client.query(
      `SELECT status_bucket, COUNT(*)::int AS count
       FROM calls_latest_hot
       WHERE call_type = 'BREAKDOWN'
       GROUP BY status_bucket`
    );
    console.log('5. Call types / status buckets for BREAKDOWN:');
    console.table(res5.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
