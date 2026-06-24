#!/usr/bin/env node
/**
 * Apply RBAC DB maintenance: indexes + grant admin capabilities.
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
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
  const sql = readFileSync(join(__dirname, 'add-rbac-indexes.sql'), 'utf8');
  await client.query(sql);
  console.log('Indexes applied (or already exist).');

  const permRes = await client.query(
    `SELECT id FROM public.app_permissions WHERE name = 'page_performance_insights' LIMIT 1`
  );
  const insightsPermId = permRes.rows[0]?.id;
  if (!insightsPermId) {
    console.warn('page_performance_insights permission not found — run seed first');
  } else {
    const adminRoles = await client.query(
      `SELECT DISTINCT r.id, r.name
       FROM public.app_roles r
       JOIN public.app_role_permissions arp ON arp.role_id = r.id
       JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE ap.name IN ('manage_users', 'manage_roles')
       ORDER BY r.name`
    );

    for (const role of adminRoles.rows) {
      const has = await client.query(
        `SELECT 1 FROM public.app_role_permissions
         WHERE role_id = $1 AND permission_id = $2 LIMIT 1`,
        [role.id, insightsPermId]
      );
      if (has.rowCount > 0) {
        console.log(`= ${role.name}: already has page_performance_insights`);
        continue;
      }
      await client.query(
        `INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)`,
        [role.id, insightsPermId]
      );
      console.log(`+ ${role.name}: granted page_performance_insights`);
    }
  }

  const indexCheck = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_app_role_permissions_role_id',
        'idx_app_users_role_id',
        'idx_app_permissions_name'
      )
    ORDER BY indexname
  `);
  console.log('\nIndexes present:', indexCheck.rows.map((r) => r.indexname).join(', ') || '(none)');
} finally {
  await client.end();
}
