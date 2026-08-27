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

/** Roles that already have any report page or admin access get the cancelled-calls report. */
const REPORT_ELIGIBLE = [
  'page_mis_reports',
  'page_warranty_master',
  'page_serial_audit',
  'page_athena_reconciliation',
  'page_cancelled_calls',
  'manage_roles',
  'manage_users',
  'view_all_offices',
  'super_admin',
];

/** Mail & Alerts / HOD roles get cancelled-call digest recipient config. */
const ALERTS_ELIGIBLE = [
  'page_major_repair_alerts',
  'page_mis_email_settings',
  'page_mis_email_routing',
  'page_cancelled_call_alerts',
  'manage_users',
  'manage_roles',
  'view_all_offices',
  'super_admin',
];

async function grantToEligibleRoles(client, permissionName, eligiblePermNames) {
  const permRes = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = $1`,
    [permissionName]
  );
  const permId = permRes.rows[0]?.id;
  if (!permId) {
    console.error(`Permission ${permissionName} not found — run seed-rbac-permissions.mjs first`);
    process.exit(1);
  }

  const rolesRes = await client.query(
    `SELECT DISTINCT r.id, r.name
     FROM public.app_roles r
     JOIN public.app_role_permissions rp ON rp.role_id = r.id
     JOIN public.app_permissions p ON p.id = rp.permission_id
     WHERE p.name = ANY($1::text[])`,
    [eligiblePermNames]
  );

  console.log(`\n${permissionName}: ${rolesRes.rows.length} eligible role(s)`);
  for (const role of rolesRes.rows) {
    await client.query(
      `INSERT INTO public.app_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [role.id, permId]
    );
    console.log(`  + ${role.name}`);
  }
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await grantToEligibleRoles(client, 'page_cancelled_calls', REPORT_ELIGIBLE);
  await grantToEligibleRoles(client, 'page_cancelled_call_alerts', ALERTS_ELIGIBLE);
  console.log('\nDone — re-login or refresh session to pick up new permissions.');
} finally {
  await client.end();
}
