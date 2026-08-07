import { config } from 'dotenv';
import { join } from 'path';
import pg from 'pg';

// Load environment variables
const root = join(process.cwd());
config({ path: join(root, '.env.local') });
config({ path: join(root, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// Strip pgbouncer=true because VACUUM requires direct/session-level admin execution
// and cannot run under PGBouncer transaction mode if it's strictly set.
// Note: api.wrl-fsm.cloud:6543 is Supavisor (can do session mode or transaction mode).
// If we run VACUUM, let's connect.
async function main() {
  console.log('Connecting to database to execute VACUUM ANALYZE...');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const tables = [
    'calls_latest_hot',
    'mis_client_import_rows',
    'mis_client_import_batches',
    'crm_transaction_entry'
  ];

  try {
    for (const table of tables) {
      console.log(`\n[VACUUM] Starting VACUUM ANALYZE on ${table}...`);
      const start = Date.now();
      await client.query(`VACUUM ANALYZE ${table};`);
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[VACUUM] Completed ${table} in ${duration}s`);
    }
    console.log('\nAll tables successfully vacuumed and analyzed.');
  } catch (err) {
    console.error('Error executing vacuum:', err);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});
