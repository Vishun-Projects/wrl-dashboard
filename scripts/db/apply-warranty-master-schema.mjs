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
DROP TABLE IF EXISTS public.warranty_master_rollup CASCADE;
DROP TYPE IF EXISTS public.warranty_master_rollup CASCADE;
DROP TABLE IF EXISTS public.warranty_master_items CASCADE;
DROP TYPE IF EXISTS public.warranty_master_items CASCADE;
DROP TABLE IF EXISTS public.warranty_master_items_ingest CASCADE;
DROP TYPE IF EXISTS public.warranty_master_items_ingest CASCADE;

CREATE TABLE public.warranty_master_items (
  id BIGSERIAL PRIMARY KEY,
  serial_no VARCHAR(100) NOT NULL UNIQUE,
  billing_doc VARCHAR(100),
  billing_date DATE,
  material VARCHAR(100),
  group_name VARCHAR(100),
  material_group VARCHAR(100),
  customer_name VARCHAR(255),
  customer_subgroup VARCHAR(100),
  ship_to_party VARCHAR(255),
  ship_to_state VARCHAR(100),
  ship_to_city VARCHAR(100),
  inventory_number VARCHAR(100),
  warr_start_dt DATE,
  warr_end_dt DATE,
  pin_code VARCHAR(50),
  warranty_months SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT false,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wm_items_serial ON public.warranty_master_items (serial_no);
CREATE INDEX idx_wm_items_serial_upper ON public.warranty_master_items (UPPER(serial_no));
CREATE INDEX idx_wm_items_customer ON public.warranty_master_items (customer_name);
CREATE INDEX idx_wm_items_cust_subgroup ON public.warranty_master_items (customer_subgroup);
CREATE INDEX idx_wm_items_group ON public.warranty_master_items (group_name);
CREATE INDEX idx_wm_items_material ON public.warranty_master_items (material);
CREATE INDEX idx_wm_items_warr_end ON public.warranty_master_items (warr_end_dt);
CREATE INDEX idx_wm_items_active ON public.warranty_master_items (is_active);
CREATE INDEX idx_wm_items_state ON public.warranty_master_items (ship_to_state);
CREATE INDEX idx_wm_items_agg ON public.warranty_master_items (customer_name, group_name, warranty_months, material);

CREATE TABLE public.warranty_master_rollup (
  subgroup_key          text NOT NULL,
  subgroup_label        text NOT NULL,
  group_key             text NOT NULL,
  group_label           text NOT NULL,
  warranty_months       smallint NOT NULL,
  material              text NOT NULL,
  machine_count         integer NOT NULL,
  active_machine_count  integer NOT NULL,
  min_warr_end          date,
  max_warr_end          date,
  PRIMARY KEY (subgroup_key, group_key, warranty_months, material)
);

CREATE INDEX idx_wm_rollup_subgroup ON public.warranty_master_rollup (subgroup_key);
CREATE INDEX idx_wm_rollup_group ON public.warranty_master_rollup (group_key);
CREATE INDEX idx_wm_rollup_material ON public.warranty_master_rollup (material);
CREATE INDEX idx_wm_rollup_months ON public.warranty_master_rollup (warranty_months);
`;

try {
  console.log('Applying warranty_master_items + rollup schema (destructive recreate)...');
  await client.query(DDL);
  console.log('Schema applied successfully.');
} catch (err) {
  console.error('Failed to apply schema:', err);
  process.exit(1);
} finally {
  await client.end();
}
