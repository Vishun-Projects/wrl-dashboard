import { createClient } from '../supabase/server';
import { withAppClient } from '../read-model/db';
import { requireSupabaseUser } from '@/lib/auth/server-user';

type AppUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[];
  visible_statuses: string[] | null;
  avatar_url: string | null;
  role_id: string | null;
  created_at: Date | string;
};

async function fetchPermissionsForRole(roleId: string | null | undefined): Promise<string[]> {
  if (!roleId) return [];

  return withAppClient(async (client) => {
    const res = await client.query<{ name: string }>(
      `SELECT ap.name
       FROM public.app_role_permissions arp
       JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE arp.role_id = $1`,
      [roleId]
    );
    return res.rows.map((row) => row.name).filter(Boolean);
  });
}

async function fetchAppUserProfile(userId: string): Promise<AppUserRow | null> {
  return withAppClient(async (client) => {
    const res = await client.query<AppUserRow>(
      `SELECT id, name, email, role, office_ids, visible_statuses, avatar_url, role_id, created_at
       FROM public.app_users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  });
}

/** Permission lookup via Postgres (works with self-hosted VPS; avoids PostgREST). */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const profile = await fetchAppUserProfile(userId);
  if (!profile?.role_id) return [];
  return fetchPermissionsForRole(profile.role_id);
}

/** Session from Supabase Auth; profile + permissions from Postgres. */
export async function getUserInfo() {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);

  if (!user) return null;

  const profile = await fetchAppUserProfile(user.id);
  if (!profile) return null;

  const permissions = await fetchPermissionsForRole(profile.role_id);
  return { ...profile, permissions };
}

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: 'branch_manager' | 'hod' | 'super_admin';
  office_ids: string[];
  visible_statuses?: string[];
  permissions: string[];
};
