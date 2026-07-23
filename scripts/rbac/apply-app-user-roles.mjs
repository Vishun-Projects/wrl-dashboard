#!/usr/bin/env node
/**
 * Apply docs/app-user-roles.sql (multi-role junction + backfill).
 *
 *   node scripts/rbac/apply-app-user-roles.mjs
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
config({ path: join(root, '.env.local') });
config({ path: join(root, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = readFileSync(join(root, 'docs', 'app-user-roles.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(sql);
  const count = await client.query('SELECT COUNT(*)::int AS n FROM public.app_user_roles');
  console.log(`OK — app_user_roles rows: ${count.rows[0].n}`);
} finally {
  await client.end();
}
