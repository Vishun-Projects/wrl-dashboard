#!/usr/bin/env node
/**
 * Grant page_arcp_provision to every role that already has page_arcp_claims.
 *
 *   DATABASE_URL=... node scripts/rbac/grant-arcp-provision.mjs
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

const PERM = 'page_arcp_provision';
const DESC = 'Rate card × qty vs CRM charged by branch';

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(
    `INSERT INTO public.app_permissions (id, name, description)
     SELECT gen_random_uuid(), $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM public.app_permissions WHERE name = $1)`,
    [PERM, DESC]
  );

  const permRes = await client.query(`SELECT id FROM public.app_permissions WHERE name = $1`, [PERM]);
  const permId = permRes.rows[0]?.id;
  if (!permId) throw new Error(`${PERM} missing after insert`);

  const rolesRes = await client.query(
    `SELECT DISTINCT r.id, r.name
     FROM public.app_roles r
     JOIN public.app_role_permissions rp ON rp.role_id = r.id
     JOIN public.app_permissions p ON p.id = rp.permission_id
     WHERE p.name = 'page_arcp_claims'`
  );

  console.log(`${PERM}: granting to ${rolesRes.rows.length} role(s) with page_arcp_claims`);
  for (const role of rolesRes.rows) {
    await client.query(
      `INSERT INTO public.app_role_permissions (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [role.id, permId]
    );
    console.log(`  + ${role.name}`);
  }
  console.log('Done — sign out/in (or hard refresh) to pick up the new permission.');
} finally {
  await client.end();
}
