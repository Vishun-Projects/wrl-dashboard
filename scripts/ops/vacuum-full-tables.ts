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

async function main() {
  console.log('Connecting to database to execute VACUUM FULL on mis_client_import_rows...');
  // Note: Using direct database connection, bypassing session pooling where possible
  // as VACUUM FULL requires an exclusive lock and cannot run in a transaction block.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const tables = [
    'mis_client_import_rows',
  ];

  try {
    for (const table of tables) {
      console.log(`\n[VACUUM FULL] Starting VACUUM FULL on ${table}...`);
      console.log(`[WARNING] This operation takes an ACCESS EXCLUSIVE lock on the table.`);
      const start = Date.now();
      await client.query(`VACUUM FULL ${table};`);
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[VACUUM FULL] Completed ${table} in ${duration}s`);
    }
    console.log('\nVACUUM FULL successfully executed. Disk space reclaimed.');
  } catch (err) {
    console.error('Error executing vacuum full:', err);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});
