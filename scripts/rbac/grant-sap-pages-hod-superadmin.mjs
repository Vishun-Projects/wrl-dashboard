#!/usr/bin/env node
/**
 * Grant dedicated CRM+SAP / SAP page permissions to HOD and Super Admin.
 *
 * These pages used to inherit from page_mis_reports; that shortcut was removed,
 * so privileged roles need explicit grants.
 *
 * Usage:
 *   node scripts/rbac/grant-sap-pages-hod-superadmin.mjs
 */
import { config } from 'dotenv';
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

/** Pages that previously leaked via MIS inheritance — restore for HOD / Super Admin only. */
const PAGE_PERMS = [
  'page_call_visits',
  'page_spare_loan_check',
  'page_zss02',
  'page_spare_stock_analysis',
  'page_mb51_aging',
  'page_compressor_barcodes',
  'page_rejected_calls',
  'page_warranty_comparison',
];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // Ensure permission rows exist
  for (const name of PAGE_PERMS) {
    await client.query(
      `INSERT INTO public.app_permissions (id, name, description)
       SELECT gen_random_uuid(), $1, $1
       WHERE NOT EXISTS (SELECT 1 FROM public.app_permissions WHERE name = $1)`,
      [name]
    );
  }

  const rolesRes = await client.query(
    `SELECT DISTINCT r.id, r.name
     FROM public.app_roles r
     LEFT JOIN public.app_role_permissions rp ON rp.role_id = r.id
     LEFT JOIN public.app_permissions p ON p.id = rp.permission_id
     WHERE lower(r.name) IN ('hod', 'super admin', 'superadmin', 'super_admin')
        OR p.name = 'super_admin'
        OR (p.name = 'view_all_offices' AND EXISTS (
              SELECT 1
              FROM public.app_role_permissions rp2
              JOIN public.app_permissions p2 ON p2.id = rp2.permission_id
              WHERE rp2.role_id = r.id AND p2.name IN ('manage_users', 'manage_roles')
            ))
     ORDER BY r.name`
  );

  if (rolesRes.rows.length === 0) {
    console.error('No HOD / Super Admin roles found');
    process.exit(1);
  }

  console.log(`Target roles: ${rolesRes.rows.map((r) => r.name).join(', ')}`);

  for (const permName of PAGE_PERMS) {
    const permRes = await client.query(
      `SELECT id FROM public.app_permissions WHERE name = $1`,
      [permName]
    );
    const permId = permRes.rows[0]?.id;
    if (!permId) {
      console.error(`Missing permission ${permName}`);
      continue;
    }

    console.log(`\n${permName}`);
    for (const role of rolesRes.rows) {
      const ins = await client.query(
        `INSERT INTO public.app_role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING
         RETURNING role_id`,
        [role.id, permId]
      );
      console.log(`  ${ins.rowCount ? '+' : '='} ${role.name}`);
    }
  }

  console.log('\nDone — re-login or refresh session to pick up new permissions.');
} finally {
  await client.end();
}
