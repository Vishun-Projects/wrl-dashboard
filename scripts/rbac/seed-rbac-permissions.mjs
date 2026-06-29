#!/usr/bin/env node
/**
 * Seed canonical RBAC permissions (pages, tabs, capabilities).
 *
 * Usage:
 *   node scripts/rbac/seed-rbac-permissions.mjs
 *   DATABASE_URL=postgres://... node scripts/rbac/seed-rbac-permissions.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

/** Keep in sync with ALL_PERMISSION_SEED in src/lib/auth/rbac-catalog.ts */
const ALL_PERMISSION_SEED = [
  { name: 'page_mis_reports', description: 'Call register, summary, and accounts' },
  { name: 'page_call_distribution', description: 'Franchisee map, idle assignees, and distribution KPIs' },
  { name: 'page_arcp_claims', description: 'ARCP claims register and detail export' },
  { name: 'page_serial_audit', description: 'Repeat serial complaints and repair audit' },
  { name: 'page_location_audit', description: 'Technician visit location verification' },
  { name: 'page_warranty_master', description: 'Active machines by customer, group, and warranty period' },
  { name: 'manage_users', description: 'Create and edit portal users' },
  { name: 'manage_roles', description: 'Define roles and page permissions' },
  { name: 'page_performance_insights', description: 'Client performance metrics and diagnostics' },
  { name: 'tab_mis_summary', description: 'Summary Dashboard tab on MIS Reports' },
  { name: 'tab_mis_register', description: 'Call Register tab on MIS Reports' },
  { name: 'tab_mis_accounts', description: 'Key Account MIS tab on MIS Reports' },
  { name: 'tab_mis_client_import', description: 'Client file import tab on MIS Reports' },
  { name: 'view_all_offices', description: 'National data scope across all branches' },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (.env.local or env var)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  let inserted = 0;
  let existing = 0;

  for (const seed of ALL_PERMISSION_SEED) {
    const res = await client.query(
      `INSERT INTO public.app_permissions (id, name, description)
       SELECT gen_random_uuid(), $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM public.app_permissions WHERE name = $1)
       RETURNING id`,
      [seed.name, seed.description]
    );
    if (res.rowCount > 0) {
      inserted++;
      console.log(`+ ${seed.name}`);
    } else {
      existing++;
      console.log(`= ${seed.name} (already exists)`);
    }
  }

  console.log(`\nDone. Inserted ${inserted}, already present ${existing}.`);
} finally {
  await client.end();
}
