import '@/lib/read-model/bootstrap-env';
import { withClient, closePool } from '@/lib/read-model/db';

async function main() {
  const result = await withClient(async (client) => {
    const sync = await client.query(`
      SELECT entity, status, is_running, last_run_at, rows_upserted_last,
             last_editedon::text, last_addedon::text
      FROM sync_state WHERE entity = 'calls_latest_hot'
    `);
    const runs = await client.query(`
      SELECT id, status, started_at::text, finished_at::text,
             rows_upserted, rows_deleted, error_message
      FROM sync_run_log WHERE entity = 'calls_latest_hot'
      ORDER BY started_at DESC LIMIT 5
    `);
    const hot = await client.query(`SELECT count(*)::int AS n FROM calls_latest_hot`);
    const openRuns = await client.query(`
      SELECT count(*)::int AS n FROM sync_run_log
      WHERE entity = 'calls_latest_hot' AND finished_at IS NULL
    `);
    return {
      hotRowCount: hot.rows[0]?.n,
      syncState: sync.rows[0],
      openRuns: openRuns.rows[0]?.n,
      recentRuns: runs.rows,
    };
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
