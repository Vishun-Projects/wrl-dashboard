#!/usr/bin/env node
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
config({ path: join(root, '.env.local') });
config({ path: join(root, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = readFileSync(join(root, 'docs', 'app-users-theme.sql'), 'utf8');
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  console.log('Applying app_users.theme migration…');
  await client.query(sql);
  console.log('Done.');
} finally {
  await client.end();
}
