import { createClient } from '../supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { cookies } from 'next/headers';
import { evaluatePortalSession } from '@/lib/auth/session-policy-server';

/** Permission lookup via Postgres (works with self-hosted VPS; avoids PostgREST). */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const auth = await loadUserAuth(userId);
  return auth?.permissions ?? [];
}

/** Session from Supabase Auth; profile + permissions from Postgres. */
export async function getUserInfo() {
  if (process.env.NODE_ENV === 'development') {
    return getUserInfoById('178af4d4-85e1-4610-8bb0-bf223c01d6aa');
  }
  const userId = await getSessionUserId();
  if (!userId) return null;
  return getUserInfoById(userId);
}

/**
 * Resolve only authenticated user id (no app_users/permissions query).
 * Cookie sessions must also pass absolute 3-day portal TTL.
 */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);
  if (!user) return null;
  try {
    const cookieStore = await cookies();
    const portal = evaluatePortalSession(cookieStore.getAll());
    if (!portal.ok) return null;
  } catch {
    return null;
  }
  return user.id;
}

export async function getPortalSessionExpiry(): Promise<{
  ok: boolean;
  sessionExpiresAt: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const portal = evaluatePortalSession(cookieStore.getAll());
    if (!portal.ok) return { ok: false, sessionExpiresAt: null };
    return { ok: true, sessionExpiresAt: portal.expiresAtIso };
  } catch {
    return { ok: false, sessionExpiresAt: null };
  }
}

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
