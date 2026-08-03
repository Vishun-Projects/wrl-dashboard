#!/usr/bin/env node
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
config({ path: join(root, '.env.local') });
config({ path: join(root, '.env') });

const schemaDir = join(root, 'docs', 'read-model-phase1-schema');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(join(schemaDir, file), 'utf8');
    console.log(`Applying ${file}…`);
    await client.query(sql);
  }
  console.log('Read model schema applied successfully.');
} finally {
  await client.end();
}
