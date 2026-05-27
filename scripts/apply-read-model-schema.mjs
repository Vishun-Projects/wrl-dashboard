/**
 * Apply read-model Phase 1 schema to existing Postgres (Supabase).
 * Usage: node scripts/apply-read-model-schema.mjs [--verify-only]
 *
 * Reads DATABASE_URL from .env.local (falls back to .env).
 * Uses direct port 5432 for DDL (not pgbouncer transaction pooler).
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

function resolveDirectUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL not set in .env.local or .env');
  let url = raw.replace(/^["']|["']$/g, '');
  if (url.startsWith('prisma+postgres://')) {
    throw new Error('DATABASE_URL points at Prisma local dev — set Supabase URL in .env.local');
  }
  url = url.replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
  url = url.replace(':6543/', ':5432/');
  return url;
}

const CHUNK_FILES = [
  '01-extensions.sql',
  '02-enums.sql',
  '03-calls_latest_hot.sql',
  '04-call_metrics_daily.sql',
  '05-dimensions.sql',
  '06-sync-meta.sql',
  '07-seed-sync-state.sql',
];

const EXPECTED_TABLES = [
  'calls_latest_hot',
  'call_metrics_daily',
  'dim_offices',
  'dim_engineers',
  'dim_call_types',
  'sync_state',
  'sync_run_log',
  'raw_ingest_batches',
];

const EXPECTED_ENUMS = ['status_bucket_type', 'sync_batch_status', 'sync_run_status'];

async function runFile(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`\n>> Applying ${path.basename(filePath)}...`);
  await client.query(sql);
  console.log(`   OK`);
}

async function verify(client) {
  console.log('\n=== Verification ===\n');

  const tables = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  const tableNames = tables.rows.map((r) => r.tablename);
  console.log('Tables in public schema:', tableNames.join(', ') || '(none)');

  for (const t of EXPECTED_TABLES) {
    const ok = tableNames.includes(t);
    console.log(`  ${ok ? '✓' : '✗'} ${t}`);
    if (!ok) process.exitCode = 1;
  }

  const indexes = await client.query(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ANY($1::text[])
    ORDER BY tablename, indexname
  `, [EXPECTED_TABLES]);
  console.log(`\nIndexes on read-model tables: ${indexes.rows.length}`);
  for (const row of indexes.rows) {
    console.log(`  ${row.tablename}.${row.indexname}`);
  }

  const enums = await client.query(`
    SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
  `);
  const enumNames = enums.rows.map((r) => r.typname);
  console.log('\nEnums:', enumNames.join(', ') || '(none)');
  for (const e of EXPECTED_ENUMS) {
    const ok = enumNames.includes(e);
    console.log(`  ${ok ? '✓' : '✗'} ${e}`);
    if (!ok) process.exitCode = 1;
  }

  const explain = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT * FROM calls_latest_hot
    ORDER BY logged_at DESC
    LIMIT 50
  `);
  console.log('\nEXPLAIN ANALYZE (empty hot table pagination):');
  for (const row of explain.rows) {
    console.log(' ', row['QUERY PLAN']);
  }

  const ext = await client.query(`
    SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'
  `);
  console.log(`\npg_stat_statements: ${ext.rows.length ? 'enabled' : 'not available'}`);
}

async function main() {
  const verifyOnly = process.argv.includes('--verify-only');
  const connectionString = resolveDirectUrl(process.env.DATABASE_URL);
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to existing Supabase Postgres (direct :5432)');

  try {
    if (!verifyOnly) {
      const chunksDir = path.join(root, 'docs', 'read-model-phase1-schema');
      for (const file of CHUNK_FILES) {
        const fp = path.join(chunksDir, file);
        if (!fs.existsSync(fp)) throw new Error(`Missing chunk: ${fp}`);
        await runFile(client, fp);
      }
    }
    await verify(client);
  } finally {
    await client.end();
  }

  console.log(verifyOnly ? '\nVerify complete.' : '\nSchema apply complete.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  if (err.detail) console.error('Detail:', err.detail);
  process.exit(1);
});
