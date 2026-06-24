import { createClient } from '../supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';

/** Permission lookup via Postgres (works with self-hosted VPS; avoids PostgREST). */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const auth = await loadUserAuth(userId);
  return auth?.permissions ?? [];
}

/** Session from Supabase Auth; profile + permissions from Postgres. */
export async function getUserInfo() {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return getUserInfoById(userId);
}

/** Resolve only authenticated user id (no app_users/permissions query). */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);
  return user?.id ?? null;
}

/** Resolve full app profile + permissions for a known user id. */
export async function getUserInfoById(userId: string) {
  const auth = await loadUserAuth(userId);
  if (!auth) return null;
  return { ...auth.profile, created_at: auth.created_at, permissions: auth.permissions };
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
