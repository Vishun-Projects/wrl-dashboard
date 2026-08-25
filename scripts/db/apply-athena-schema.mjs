import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local'), override: true });
config({ path: resolve(process.cwd(), '.env'), override: true });

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Terminate any stuck locks
  try {
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND query ILIKE '%athena%'
        AND state IN ('idle in transaction', 'active');
    `);
  } catch (e) {
    console.log('Ignore terminate error:', e.message);
  }

  console.log('Applying 27-athena-failed-calls-reconciliation.sql...');
  const sql = readFileSync(
    resolve(process.cwd(), 'docs/read-model-phase1-schema/27-athena-failed-calls-reconciliation.sql'),
    'utf8'
  );
  await client.query(sql);
  console.log('27-athena-failed-calls-reconciliation.sql applied successfully!');
  await client.end();
}

main().catch(console.error);
