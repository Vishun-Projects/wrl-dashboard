import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

const root = path.join(process.cwd());
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

let url = process.env.DATABASE_URL.replace(/^["']|["']$/g, '');
url = url.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
url = url.replace(':6543/', ':5432/');

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
pool.on('connect', (client) => {
  void client.query("SET statement_timeout = '30000'");
});

try {
  const hot = await pool.query('SELECT count(*)::int AS c FROM calls_latest_hot');
  const state = await pool.query(
    `SELECT status, is_running, last_editedon, last_run_at FROM sync_state WHERE entity='calls_latest_hot'`
  );
  const dims = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM dim_offices) AS offices,
      (SELECT count(*)::int FROM dim_call_types) AS call_types,
      (SELECT count(*)::int FROM dim_engineers) AS engineers
  `);
  console.log(JSON.stringify({ hot: hot.rows[0], state: state.rows[0], dims: dims.rows[0] }, null, 2));
} finally {
  await pool.end();
}
