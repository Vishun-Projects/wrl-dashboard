/**
 * Remove broken accounts from failed user creation (no role_id / no app_users profile):
 * - app_users rows where role_id IS NULL
 * - Supabase Auth users with no matching app_users row (orphaned logins)
 *
 *   npx tsx scripts/ops/cleanup-users-without-role.ts           # dry run
 *   npx tsx scripts/ops/cleanup-users-without-role.ts --execute # delete
 */
import '@/lib/read-model/bootstrap-env';
import { withClient, closePool } from '@/lib/read-model/db';
import { supabaseAdmin } from '@/lib/supabase/admin';

type OrphanProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
};

async function listProfilesWithoutRole(): Promise<OrphanProfile[]> {
  return withClient(async (client) => {
    const res = await client.query<OrphanProfile>(`
      SELECT id, email, name, role, created_at::text AS created_at
      FROM public.app_users
      WHERE role_id IS NULL
      ORDER BY created_at DESC
    `);
    return res.rows;
  });
}

async function listAuthOrphans(): Promise<{ id: string; email?: string; created_at?: string }[]> {
  const profileIds = await withClient(async (client) => {
    const res = await client.query<{ id: string }>(`SELECT id FROM public.app_users`);
    return new Set(res.rows.map((r) => r.id));
  });

  const orphans: { id: string; email?: string; created_at?: string }[] = [];
  let page = 1;
  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (!profileIds.has(u.id)) {
        orphans.push({ id: u.id, email: u.email, created_at: u.created_at });
      }
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  return orphans;
}

async function deleteProfile(id: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('DELETE FROM public.app_users WHERE id = $1', [id]);
  });
}

async function main() {
  const execute = process.argv.includes('--execute');
  const nullRoleProfiles = await listProfilesWithoutRole();
  const authOrphans = await listAuthOrphans();

  const total = nullRoleProfiles.length + authOrphans.length;
  if (total === 0) {
    console.log('No broken accounts (NULL role_id or auth-only orphans).');
    return;
  }

  if (nullRoleProfiles.length > 0) {
    console.log(`app_users without role_id (${nullRoleProfiles.length}):\n`);
    for (const row of nullRoleProfiles) {
      console.log(`  ${row.email}  ${row.id}  created ${row.created_at}`);
    }
    console.log('');
  }

  if (authOrphans.length > 0) {
    console.log(`Auth-only orphans — no app_users profile (${authOrphans.length}):\n`);
    for (const row of authOrphans) {
      console.log(`  ${row.email ?? '(no email)'}  ${row.id}  ${row.created_at ?? ''}`);
    }
    console.log('');
  }

  if (!execute) {
    console.log('Dry run only. Re-run with --execute to delete the accounts above.');
    return;
  }

  console.log('Deleting...\n');

  for (const row of nullRoleProfiles) {
    await deleteProfile(row.id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(row.id);
    if (error) {
      console.error(`  FAIL profile ${row.email}: ${error.message}`);
    } else {
      console.log(`  OK   profile+auth ${row.email}`);
    }
  }

  for (const row of authOrphans) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(row.id);
    if (error) {
      console.error(`  FAIL auth orphan ${row.email ?? row.id}: ${error.message}`);
    } else {
      console.log(`  OK   auth orphan ${row.email ?? row.id}`);
    }
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
