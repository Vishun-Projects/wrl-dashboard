#!/usr/bin/env node
/**
 * One-time migration: legacy permissions → canonical RBAC permissions.
 *
 * Usage:
 *   node scripts/rbac/migrate-legacy-permissions.mjs
 *   node scripts/rbac/migrate-legacy-permissions.mjs --dry-run
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

const dryRun = process.argv.includes('--dry-run');

const REPORT_PAGE_PERMS = [
  'page_mis_reports',
  'page_call_distribution',
  'page_arcp_claims',
  'page_serial_audit',
  'page_location_audit',
  'page_warranty_master',
];

const MIS_TAB_PERMS = [
  'tab_mis_summary',
  'tab_mis_register',
  'tab_mis_accounts',
  'tab_mis_client_import',
];

const MIS_CLIENT_IMPORT_CAP_PERMS = [
  'mis_client_import_upload',
  'mis_client_import_delete',
];

const LEGACY_TO_CANONICAL = {
  view_mis_summary: 'tab_mis_summary',
  view_summary: 'tab_mis_summary',
  view_mis_register: 'tab_mis_register',
  view_mis_accounts: 'tab_mis_accounts',
};

const ALL_SEED = [
  ...REPORT_PAGE_PERMS.map((name) => ({ name, description: `Page: ${name}` })),
  { name: 'manage_users', description: 'Create and edit portal users' },
  { name: 'manage_roles', description: 'Define roles and page permissions' },
  ...MIS_TAB_PERMS.map((name) => ({ name, description: `MIS tab: ${name}` })),
  ...MIS_CLIENT_IMPORT_CAP_PERMS.map((name) => ({
    name,
    description: `Client import capability: ${name}`,
  })),
  {
    name: 'view_all_offices',
    description: 'National data scope across all branches',
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

async function ensurePermission(name, description) {
  const existing = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = $1 LIMIT 1`,
    [name]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  if (dryRun) {
    console.log(`[dry-run] would insert permission ${name}`);
    return null;
  }
  const inserted = await client.query(
    `INSERT INTO public.app_permissions (id, name, description)
     VALUES (gen_random_uuid(), $1, $2)
     RETURNING id`,
    [name, description]
  );
  return inserted.rows[0].id;
}

async function getPermissionId(name) {
  const res = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = $1 LIMIT 1`,
    [name]
  );
  return res.rows[0]?.id ?? null;
}

async function roleHasPermission(roleId, permissionId) {
  if (!permissionId) return false;
  const res = await client.query(
    `SELECT 1 FROM public.app_role_permissions WHERE role_id = $1 AND permission_id = $2 LIMIT 1`,
    [roleId, permissionId]
  );
  return res.rows.length > 0;
}

async function grantPermission(roleId, permissionId) {
  if (!permissionId) return;
  if (await roleHasPermission(roleId, permissionId)) return;
  if (dryRun) {
    console.log(`[dry-run] would grant permission ${permissionId} to role ${roleId}`);
    return;
  }
  await client.query(
    `INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)`,
    [roleId, permissionId]
  );
}

try {
  console.log(dryRun ? 'DRY RUN — no writes' : 'Migrating legacy RBAC permissions…');

  for (const seed of ALL_SEED) {
    await ensurePermission(seed.name, seed.description);
  }
  for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
    await ensurePermission(canonical, `MIS tab: ${canonical}`);
    await ensurePermission(legacy, `DEPRECATED — use ${canonical}`);
  }

  const rolesRes = await client.query(`
    SELECT r.id, r.name,
           COALESCE(json_agg(ap.name) FILTER (WHERE ap.name IS NOT NULL), '[]') AS permissions
    FROM public.app_roles r
    LEFT JOIN public.app_role_permissions rp ON rp.role_id = r.id
    LEFT JOIN public.app_permissions ap ON ap.id = rp.permission_id
    GROUP BY r.id
    ORDER BY r.name
  `);

  for (const role of rolesRes.rows) {
    const before = [...(role.permissions ?? [])];
    const grants = new Set();

    const hasLegacyFull =
      before.includes('view_calls') || before.includes('view_reports');

    if (hasLegacyFull) {
      for (const p of REPORT_PAGE_PERMS) grants.add(p);
      for (const p of MIS_TAB_PERMS) grants.add(p);
    }

    if (before.includes('page_mis_reports')) {
      for (const p of MIS_TAB_PERMS) grants.add(p);
    }

    for (const [legacy, canonical] of Object.entries(LEGACY_TO_CANONICAL)) {
      if (before.includes(legacy)) grants.add(canonical);
    }

    if (before.includes('tab_mis_summary') || before.includes('tab_mis_accounts')) {
      grants.add('tab_mis_client_import');
    }

    if (
      before.includes('tab_mis_client_import') ||
      before.includes('page_mis_reports')
    ) {
      for (const p of MIS_CLIENT_IMPORT_CAP_PERMS) grants.add(p);
    }

    for (const p of before) {
      if (
        REPORT_PAGE_PERMS.includes(p) ||
        MIS_TAB_PERMS.includes(p) ||
        p === 'view_all_offices' ||
        p === 'manage_users' ||
        p === 'manage_roles'
      ) {
        grants.add(p);
      }
    }

    console.log(`\nRole: ${role.name}`);
    console.log('  Before:', before.join(', ') || '(none)');

    for (const perm of grants) {
      const pid = await getPermissionId(perm);
      await grantPermission(role.id, pid);
    }

    const legacyRemove = [
      'view_calls',
      'view_reports',
      ...Object.keys(LEGACY_TO_CANONICAL),
    ];
    for (const legacy of legacyRemove) {
      if (!before.includes(legacy)) continue;
      const legacyId = await getPermissionId(legacy);
      if (!legacyId) continue;
      if (dryRun) {
        console.log(`[dry-run] would remove legacy ${legacy} from role ${role.name}`);
        continue;
      }
      await client.query(
        `DELETE FROM public.app_role_permissions WHERE role_id = $1 AND permission_id = $2`,
        [role.id, legacyId]
      );
    }

    const afterRes = await client.query(
      `SELECT ap.name
       FROM public.app_role_permissions rp
       JOIN public.app_permissions ap ON ap.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY ap.name`,
      [role.id]
    );
    console.log(
      '  After:',
      afterRes.rows.map((r) => r.name).join(', ') || '(none)'
    );
  }

  console.log('\nDone.');
} finally {
  await client.end();
}
