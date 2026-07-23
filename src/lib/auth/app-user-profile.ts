import 'server-only';

import { loadUserAuth } from '@/lib/auth/load-user-auth';

export type AppUserAuthProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[];
  visible_statuses: string[] | null;
  avatar_url: string | null;
  role_id: string | null;
  /** All assigned roles (union of permissions). Primary display role is role_id. */
  role_ids?: string[];
  theme: string;
};

/** Load app_users row via Postgres (no PostgREST HTTPS). */
export async function fetchAppUserAuthProfile(
  userId: string
): Promise<AppUserAuthProfile | null> {
  const auth = await loadUserAuth(userId);
  return auth?.profile ?? null;
}
