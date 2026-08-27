import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
const url = (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '').replace(/^["']|["']$/g, '');
const client = new pg.Client({ connectionString: url });
await client.connect();

const pos = await client.query(`
  SELECT coalesce(action_type,'(null)') AS action_type,
         count(*)::int AS n,
         min(added_on) AS first_on,
         max(added_on) AS last_on,
         avg(distance)::float8 AS avg_d,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS med
  FROM crm_user_locations
  WHERE distance > 0
  GROUP BY 1
  ORDER BY n DESC
`);
console.log('all-time positive by action', pos.rows);

// haversine feasibility: do SERVICE START rows have latlong?
const ll = await client.query(`
  SELECT
    count(*) FILTER (WHERE nullif(btrim(latlong),'') IS NOT NULL)::int AS with_ll,
    count(*)::int AS n
  FROM crm_user_locations
  WHERE added_on >= now() - interval '7 days'
    AND action_type = 'SERVICE START'
`);
console.log('service start latlong 7d', ll.rows[0]);

// sample a call with multiple pings and latlongs
const call = await client.query(`
  SELECT trn_no, action_type, distance::text, latlong, left(added_on::text,19) AS added_on
  FROM crm_user_locations
  WHERE trn_no = (
    SELECT trn_no FROM crm_user_locations
    WHERE added_on >= now() - interval '3 days' AND nullif(btrim(trn_no),'') IS NOT NULL
      AND nullif(btrim(latlong),'') IS NOT NULL
    LIMIT 1
  )
  ORDER BY added_on
`);
console.log('one call timeline', call.rows);

await client.end();
