/**
 * Load live RBAC from Postgres for handover export.
 * Requires DATABASE_URL (.env.local).
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export function loadHandoverEnv() {
  config({ path: path.join(ROOT, '.env.local') });
  config({ path: path.join(ROOT, '.env') });
}

export async function fetchRbacSnapshot() {
  loadHandoverEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to export RBAC from production. Set it in .env.local and re-run npm run handover:export',
    );
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const rolesRes = await client.query(`
      SELECT r.id, r.name, r.description,
        COUNT(u.id)::int AS user_count
      FROM public.app_roles r
      LEFT JOIN public.app_users u ON u.role_id = r.id
      GROUP BY r.id, r.name, r.description
      ORDER BY r.name
    `);

    const grantsRes = await client.query(`
      SELECT r.name AS role_name, ap.name AS permission
      FROM public.app_role_permissions rp
      JOIN public.app_roles r ON r.id = rp.role_id
      JOIN public.app_permissions ap ON ap.id = rp.permission_id
      ORDER BY r.name, ap.name
    `);

    return {
      exportedAt: new Date().toISOString(),
      roles: rolesRes.rows,
      grants: grantsRes.rows,
    };
  } finally {
    await client.end();
  }
}

export function buildRoleMatrixRows(allPerms, snapshot) {
  const grantSet = new Set(snapshot.grants.map((g) => `${g.role_name}\0${g.permission}`));
  return allPerms.map((permission) => {
    const row = { permission };
    for (const role of snapshot.roles) {
      row[role.name] = grantSet.has(`${role.name}\0${permission}`) ? 'Y' : '';
    }
    return row;
  });
}

export function buildRolePermissionsSheet(snapshot) {
  return snapshot.grants.map((g) => ({
    role: g.role_name,
    permission: g.permission,
  }));
}

export function generateRolesSnapshotMarkdown(snapshot, catalog) {
  const { pages, tabs, caps } = catalog;
  const permMeta = new Map();
  const permLabels = new Map();
  for (const p of pages) {
    permMeta.set(p.permission, { type: 'page', label: p.label });
    if (!permLabels.has(p.permission)) permLabels.set(p.permission, []);
    permLabels.get(p.permission).push(p.label);
  }
  for (const t of tabs) permMeta.set(t.permission, { type: 'tab', label: t.label });
  for (const c of caps) permMeta.set(c.permission, { type: 'capability', label: c.label });

  const byRole = new Map();
  for (const g of snapshot.grants) {
    if (!byRole.has(g.role_name)) byRole.set(g.role_name, []);
    byRole.get(g.role_name).push(g.permission);
  }

  const lines = [
    '# Portal roles snapshot (production DB)',
    '',
    `> **Generated:** ${snapshot.exportedAt.slice(0, 19)}Z from \`app_roles\`, \`app_role_permissions\`, \`app_users\`. Regenerate: \`npm run handover:export\`.`,
    '',
    'This is the **live** role configuration in the portal database — not a workshop template.',
    '',
    '## Roles',
    '',
    '| Role | Active users | Description |',
    '| --- | ---: | --- |',
  ];

  for (const r of snapshot.roles) {
    const desc = (r.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';
    lines.push(`| ${r.name} | ${r.user_count} | ${desc} |`);
  }

  lines.push('', '## Permissions by role', '');

  for (const r of snapshot.roles) {
    const perms = byRole.get(r.name) || [];
    lines.push(`### ${r.name}`, '');
    if (!perms.length) {
      lines.push('_No permissions assigned._', '');
      continue;
    }
    for (const p of perms) {
      const labels = permLabels.get(p);
      const meta = permMeta.get(p);
      let suffix = '';
      if (labels && labels.length > 1) {
        suffix = ` — pages: ${labels.join(', ')}`;
      } else if (meta) {
        suffix = ` — ${meta.type}: ${meta.label}`;
      }
      lines.push(`- \`${p}\`${suffix}`);
    }
    lines.push('');
  }

  lines.push(
    '## Matrix export',
    '',
    'Full permission × role grid: [`RBAC_MATRIX.xlsx`](RBAC_MATRIX.xlsx) sheet **RoleMatrix**.',
    '',
    '## Related',
    '',
    '- [RBAC_DECISION_FLOW.md](RBAC_DECISION_FLOW.md) — how authz is enforced',
    '- Roles UI: `/admin/roles`',
    '',
  );

  return lines.join('\n');
}
