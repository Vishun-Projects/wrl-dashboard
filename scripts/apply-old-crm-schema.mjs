#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const schemaDir = join(rootDir, 'docs', 'old-crm-schema');

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const path = join(rootDir, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles();

const databaseUrl = process.env.OLD_CRM_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('OLD_CRM_DATABASE_URL (or DATABASE_URL) is required');
  process.exit(1);
}

const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('00-create-database'))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(join(schemaDir, file), 'utf8');
    console.log(`Applying ${file}…`);
    await client.query(sql);
  }
  console.log('old_crm schema applied successfully.');
} finally {
  await client.end();
}
