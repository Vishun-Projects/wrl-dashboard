import { config } from 'dotenv';
import { join } from 'path';

// Load env files
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Explicitly use pooled database (port 6543)
process.env.USE_DIRECT_DATABASE = 'false';

import { getAppPool, closePool } from '@/lib/read-model/db';

async function main() {
  const pool = getAppPool();
  console.log('=== RUNNING EXPLAIN ANALYZE ON SLOW QUERIES ===');

  // Let's get a valid source_id from mis_client_sources
  const sourceRes = await pool.query('SELECT id, code FROM mis_client_sources LIMIT 1;');
  const sourceId = sourceRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
  const sourceCode = sourceRes.rows[0]?.code || 'test';
  console.log(`Using source_id: ${sourceId} (${sourceCode})`);

  // Query 1: WITH keyed AS ...
  try {
    console.log('\n--- EXPLAIN QUERY 1 (WITH keyed AS ...) ---');
    const q1 = `
      EXPLAIN (ANALYZE, BUFFERS)
      WITH keyed AS (
        SELECT
          r.batch_id,
          b.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY r.source_id, r.call_key
            ORDER BY b.created_at DESC
          ) AS rn,
          MIN(b.created_at) OVER (PARTITION BY r.source_id, r.call_key) AS first_batch_at
        FROM mis_client_import_rows r
        JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
        WHERE r.source_id = $1::uuid AND b.status = 'completed'
      )
      SELECT * FROM keyed LIMIT 10;
    `;
    const res = await pool.query(q1, [sourceId]);
    res.rows.forEach(r => console.log(r['QUERY PLAN']));
  } catch (err) {
    console.error('Q1 explain failed:', err);
  }

  // Query 2: queryBdMisCrmSummary branch query
  try {
    console.log('\n--- EXPLAIN QUERY 2 (queryBdMisCrmSummary branch query) ---');
    const periodStart = '2026-01-01T00:00:00';
    const periodEnd = '2026-08-31T23:59:59';
    const q2 = `
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT
        h.nofficeid AS office_id,
        d.nunder AS parent_id,
        COALESCE(d.vcompanyname, h.branch_name, 'UNKNOWN') AS branch,
        COALESCE(NULLIF(trim(h.region), ''), CASE COALESCE(CASE WHEN COALESCE(d_reg.nunder, 0) = 0 THEN d_reg.nzone ELSE dp_reg.nzone END, 0) WHEN 1 THEN 'WEST ZONE' WHEN 2 THEN 'NORTH ZONE' WHEN 3 THEN 'EAST ZONE' WHEN 4 THEN 'SOUTH ZONE' ELSE 'OTHER' END) AS region,
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total_calls,
        count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved_calls,
        count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled_calls,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_calls,
        count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved_calls,
        COALESCE(MAX(h.branch_headcount), 0)::int AS headcount
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      LEFT JOIN dim_offices d_reg ON d_reg.ncode = h.nofficeid
      LEFT JOIN dim_offices dp_reg ON dp_reg.ncode = d_reg.nunder AND COALESCE(d_reg.nunder, 0) <> 0
      WHERE h.logged_at >= $1::timestamptz
        AND h.logged_at <= $2::timestamptz
        AND COALESCE(d.vcompanyname, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'
      GROUP BY h.nofficeid, d.nunder, d.vcompanyname, h.branch_name, COALESCE(NULLIF(trim(h.region), ''), CASE COALESCE(CASE WHEN COALESCE(d_reg.nunder, 0) = 0 THEN d_reg.nzone ELSE dp_reg.nzone END, 0) WHEN 1 THEN 'WEST ZONE' WHEN 2 THEN 'NORTH ZONE' WHEN 3 THEN 'EAST ZONE' WHEN 4 THEN 'SOUTH ZONE' ELSE 'OTHER' END);
    `;
    const res = await pool.query(q2, [periodStart, periodEnd]);
    res.rows.forEach(r => console.log(r['QUERY PLAN']));
  } catch (err) {
    console.error('Q2 explain failed:', err);
  }

  // Query 4: SELECT DISTINCT trim(h.account) AS account FROM calls_latest_hot h
  try {
    console.log('\n--- EXPLAIN QUERY 4 (SELECT DISTINCT trim(h.account) ...) ---');
    const q4 = `
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT DISTINCT trim(h.account) AS account
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE COALESCE(d.vcompanyname, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)';
    `;
    const res = await pool.query(q4);
    res.rows.forEach(r => console.log(r['QUERY PLAN']));
  } catch (err) {
    console.error('Q4 explain failed:', err);
  }

  // Query 7: SELECT vtrnno FROM calls_latest_hot WHERE vtrnno IS NOT NULL AND TRIM(vtrnno) <> $3 ...
  try {
    console.log('\n--- EXPLAIN QUERY 7 (TRIM(vtrnno) ...) ---');
    const q7 = `
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT vtrnno
      FROM calls_latest_hot
      WHERE vtrnno IS NOT NULL AND TRIM(vtrnno) <> ''
      LIMIT 10;
    `;
    const res = await pool.query(q7);
    res.rows.forEach(r => console.log(r['QUERY PLAN']));
  } catch (err) {
    console.error('Q7 explain failed:', err);
  }

  console.log('\n=== EXPLAIN COMPLETE ===');
}

main()
  .catch((err) => {
    console.error('Error running explains:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
