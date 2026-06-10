import { createClient } from '../supabase/server';
import { supabaseAdmin } from '../supabase/admin';

async function fetchPermissionsForRole(roleId: string | null | undefined): Promise<string[]> {
  if (!roleId) return [];

  const { data: rolePerms, error: rpError } = await supabaseAdmin
    .from('app_role_permissions')
    .select('permission_id')
    .eq('role_id', roleId);

  if (rpError || !rolePerms?.length) return [];

  const permissionIds = rolePerms
    .map((row) => row.permission_id)
    .filter((id): id is string => id != null);

  if (permissionIds.length === 0) return [];

  const { data: permissions, error: permError } = await supabaseAdmin
    .from('app_permissions')
    .select('name')
    .in('id', permissionIds);

  if (permError || !permissions?.length) return [];
  return permissions.map((p) => p.name).filter(Boolean);
}

/** Permission lookup via Supabase REST — does not use the Postgres pool. */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const { data: profile, error } = await supabaseAdmin
    .from('app_users')
    .select('role_id')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile) return [];
  return fetchPermissionsForRole(profile.role_id);
}

/** Loads profile + permissions via Supabase REST (no Postgres pool slot). */
export async function getUserInfo() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabaseAdmin
    .from('app_users')
    .select('id, name, email, role, office_ids, visible_statuses, avatar_url, role_id, report_preferences, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile) return null;

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
