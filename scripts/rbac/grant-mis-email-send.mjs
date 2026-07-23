#!/usr/bin/env node
/**
 * Seed mis_email_send capability and grant it to roles that already have MIS report access
 * (or users with mis_email_enabled), so existing digests keep working.
 *
 *   node scripts/rbac/grant-mis-email-send.mjs
 *   node scripts/rbac/grant-mis-email-send.mjs --dry-run
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

const dryRun = process.argv.includes('--dry-run');
const PERM = 'mis_email_send';
const DESC =
  'Compose, send, and receive scheduled MIS digests (admin still opts each user in)';

const MIS_MARKERS = [
  'page_mis_reports',
  'tab_mis_summary',
  'tab_mis_register',
  'tab_mis_accounts',
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  let permId;
  const existing = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = $1 LIMIT 1`,
    [PERM]
  );
  if (existing.rows[0]?.id) {
    permId = existing.rows[0].id;
    console.log(`= ${PERM} exists (${permId})`);
  } else if (dryRun) {
    console.log(`[dry-run] would insert ${PERM}`);
    permId = null;
  } else {
    const inserted = await client.query(
      `INSERT INTO public.app_permissions (id, name, description)
       VALUES (gen_random_uuid(), $1, $2)
       RETURNING id`,
      [PERM, DESC]
    );
    permId = inserted.rows[0].id;
    console.log(`+ ${PERM} (${permId})`);
  }

  const rolesRes = await client.query(
    `SELECT DISTINCT r.id, r.name
     FROM public.app_roles r
     WHERE EXISTS (
       SELECT 1
       FROM public.app_role_permissions arp
       JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE arp.role_id = r.id AND ap.name = ANY($1::text[])
     )
     OR EXISTS (
       SELECT 1 FROM public.app_users u
       WHERE u.role_id = r.id AND u.mis_email_enabled = true
     )
     ORDER BY r.name`,
    [MIS_MARKERS]
  );

  let granted = 0;
  let skipped = 0;

  for (const role of rolesRes.rows) {
    if (!permId) {
      console.log(`[dry-run] would grant ${PERM} → ${role.name}`);
      granted++;
      continue;
    }
    const has = await client.query(
      `SELECT 1 FROM public.app_role_permissions
       WHERE role_id = $1 AND permission_id = $2 LIMIT 1`,
      [role.id, permId]
    );
    if (has.rowCount > 0) {
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] would grant ${PERM} → ${role.name}`);
      granted++;
      continue;
    }
    await client.query(
      `INSERT INTO public.app_role_permissions (role_id, permission_id)
       VALUES ($1, $2)`,
      [role.id, permId]
    );
    console.log(`→ granted ${PERM} to role ${role.name}`);
    granted++;
  }

  console.log(
    `\nDone. Roles touched=${granted}, already had=${skipped}, candidates=${rolesRes.rowCount}`
  );
} finally {
  await client.end();
}
