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
  console.log('Connected to DB...');

  await client.query(`DROP TABLE IF EXISTS athena_failed_calls_normalized CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS athena_failed_calls_raw CASCADE;`);

  const sql = readFileSync(
    resolve(process.cwd(), 'docs/read-model-phase1-schema/27-athena-failed-calls-reconciliation.sql'),
    'utf8'
  );
  await client.query(sql);
  console.log('Successfully recreated Athena tables!');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
