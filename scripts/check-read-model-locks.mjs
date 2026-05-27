import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

const root = path.join(process.cwd());
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

let url = process.env.DATABASE_URL.replace(/^["']|["']$/g, '');
url = url.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
url = url.replace(':6543/', ':5432/');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
const client = await pool.connect();
await client.query("SET statement_timeout = '15000'");
await client.query("SET lock_timeout = '3000'");

try {
  const activity = await client.query(`
    SELECT pid, state, wait_event_type, wait_event, query_start,
           left(query, 120) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
    ORDER BY query_start NULLS LAST
    LIMIT 20
  `);
  const locks = await client.query(`
    SELECT l.pid, l.mode, l.granted, c.relname, a.state, left(a.query, 80) AS query
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    LEFT JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE c.relname IN ('calls_latest_hot', 'sync_state')
    ORDER BY l.granted, l.pid
  `);
  const state = await client.query(
    `SELECT status, is_running, last_editedon, last_run_at FROM sync_state WHERE entity='calls_latest_hot'`
  );
  console.log(JSON.stringify({ state: state.rows[0], activity: activity.rows, locks: locks.rows }, null, 2));
} finally {
  client.release();
  await pool.end();
}
