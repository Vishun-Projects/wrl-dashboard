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

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const permRes = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = 'page_athena_reconciliation'`
  );
  const permId = permRes.rows[0]?.id;
  if (!permId) {
    console.error('Permission page_athena_reconciliation not found in app_permissions');
    process.exit(1);
  }

  // Grant to all roles that have any report page or admin access
  const rolesRes = await client.query(
    `SELECT DISTINCT r.id, r.name
     FROM public.app_roles r
     JOIN public.app_role_permissions rp ON rp.role_id = r.id
     JOIN public.app_permissions p ON p.id = rp.permission_id
     WHERE p.name IN ('page_mis_reports', 'page_warranty_master', 'page_serial_audit', 'manage_roles', 'manage_users', 'view_all_offices', 'super_admin')`
  );

  console.log(`Found ${rolesRes.rows.length} eligible roles:`);
  for (const role of rolesRes.rows) {
    await client.query(
      `INSERT INTO public.app_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [role.id, permId]
    );
    console.log(`+ Granted to role ${role.name}`);
  }

  console.log('Successfully granted page_athena_reconciliation to all eligible roles.');
} finally {
  await client.end();
}
