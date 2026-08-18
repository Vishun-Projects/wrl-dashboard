import dotenv from 'dotenv';
import path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

async function run() {
  const readModelUrl = process.env.DATABASE_URL;
  const oldCrmUrl = process.env.OLD_CRM_DATABASE_URL;

  console.log('Read Model DB:', readModelUrl ? 'Configured' : 'Missing');
  console.log('Old CRM DB:', oldCrmUrl ? 'Configured' : 'Missing');

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const startDate = '2026-01-01T00:00:00Z';
  const endDate = `${yesterdayStr}T23:59:59Z`;

  console.log(`Checking date range: ${startDate} to ${endDate}`);

  // Query Read Model
  if (readModelUrl) {
    const client = new Client({ connectionString: readModelUrl });
    await client.connect();
    try {
      const res = await client.query(
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
        [startDate, endDate]
      );
      console.log('Read Model calls_latest_hot counts:', res.rows[0]);
    } catch (err) {
      console.error('Read Model Query Error:', err);
    } finally {
      await client.end();
    }
  }

  // Query Old CRM
  if (oldCrmUrl) {
    const client = new Client({ connectionString: oldCrmUrl });
    await client.connect();
    try {
      // Let's first check what the table name and structure is in old_crm
      // We can query trhcalls
      const res = await client.query(
        `SELECT 
           count(*)::int AS total,
           count(*) FILTER (WHERE tc.bapproval = true OR tc.bsolved = true)::int AS solved,
           count(*) FILTER (WHERE tc.ncancelreason NOT IN (0, 2))::int AS cancelled,
           count(*) FILTER (WHERE COALESCE(tc.ncancelreason, 0) IN (0, 2) AND tc.bapproval = false AND tc.bsolved = false)::int AS open
         FROM trhcalls tc
         LEFT JOIN dim_offices d ON d.ncode = tc.nofficeid
         WHERE tc.calltype = 'BREAKDOWN'
           AND tc.callsdtrndate >= $1::timestamptz
           AND tc.callsdtrndate <= $2::timestamptz
           AND COALESCE(d.vcompanyname, tc.branch_office_name, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`,
        [startDate, endDate]
      );
      console.log('Old CRM trhcalls counts:', res.rows[0]);
    } catch (err) {
      console.error('Old CRM Query Error:', err);
    } finally {
      await client.end();
    }
  }
}

run().catch(console.error);
