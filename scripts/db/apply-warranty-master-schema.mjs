#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required in .env.local or .env');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const DDL = `
DROP TABLE IF EXISTS public.warranty_master_items CASCADE;

CREATE TABLE public.warranty_master_items (
  id BIGSERIAL PRIMARY KEY,
  serial_no VARCHAR(100) NOT NULL UNIQUE,
  billing_doc VARCHAR(100),
  billing_date DATE,
  fg_model VARCHAR(100) NOT NULL,
  material VARCHAR(100) NOT NULL,
  group_name VARCHAR(100) NOT NULL DEFAULT '',
  material_group VARCHAR(100) NOT NULL DEFAULT '',
  product_subgroup VARCHAR(100),
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  customer_subgroup VARCHAR(100) NOT NULL DEFAULT '',
  ship_to_party VARCHAR(255),
  ship_to_state VARCHAR(100),
  ship_to_city VARCHAR(100),
  inventory_number VARCHAR(100),
  warr_start_dt DATE,
  warr_end_dt DATE,
  city VARCHAR(100),
  pin_code VARCHAR(50),
  sheet_year SMALLINT,
  warranty_months SMALLINT NOT NULL DEFAULT 12,
  is_active BOOLEAN NOT NULL DEFAULT false,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wm_items_serial ON public.warranty_master_items (serial_no);
CREATE INDEX idx_wm_items_serial_upper ON public.warranty_master_items (UPPER(serial_no));
CREATE INDEX idx_wm_items_customer ON public.warranty_master_items (customer_name);
CREATE INDEX idx_wm_items_cust_subgroup ON public.warranty_master_items (customer_subgroup);
CREATE INDEX idx_wm_items_group ON public.warranty_master_items (group_name);
CREATE INDEX idx_wm_items_fg ON public.warranty_master_items (fg_model);
CREATE INDEX idx_wm_items_warr_end ON public.warranty_master_items (warr_end_dt);
CREATE INDEX idx_wm_items_active ON public.warranty_master_items (is_active);
CREATE INDEX idx_wm_items_state ON public.warranty_master_items (ship_to_state);
CREATE INDEX idx_wm_items_sheet_year ON public.warranty_master_items (sheet_year);
CREATE INDEX idx_wm_items_agg ON public.warranty_master_items (customer_name, group_name, warranty_months, fg_model);
`;

try {
  console.log('Applying warranty_master_items table schema migration...');
  await client.query(DDL);
  console.log('Schema applied successfully.');
} catch (err) {
  console.error('Failed to apply schema:', err);
  process.exit(1);
} finally {
  await client.end();
}
