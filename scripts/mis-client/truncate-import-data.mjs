#!/usr/bin/env node
/**
 * Truncate MIS client import batches/rows and remove stored files.
 * Does NOT touch mis_client_sources or mapping tables.
 *
 * Usage:
 *   npm run db:truncate-mis-client-import
 */
import { config } from 'dotenv';
import { rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function resolveImportDir() {
  if (process.env.MIS_CLIENT_IMPORT_DIR?.trim()) {
    return process.env.MIS_CLIENT_IMPORT_DIR.trim();
  }
  return join(process.cwd(), '.cache', 'mis-client-import');
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('TRUNCATE mis_client_import_rows RESTART IDENTITY');
  await client.query('TRUNCATE mis_client_import_batches');
  console.log('Truncated mis_client_import_rows and mis_client_import_batches.');

  const importDir = resolveImportDir();
  if (existsSync(importDir)) {
    rmSync(importDir, { recursive: true, force: true });
    console.log(`Removed stored files: ${importDir}`);
  } else {
    console.log(`No stored files directory at ${importDir}`);
  }

  console.log('MIS client import data cleared. Config tables unchanged.');
} finally {
  await client.end();
}
