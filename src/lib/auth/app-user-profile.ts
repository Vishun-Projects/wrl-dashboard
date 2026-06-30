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
  theme: string;
};

/** Load app_users row via Postgres (no PostgREST HTTPS). */
export async function fetchAppUserAuthProfile(
  userId: string
): Promise<AppUserAuthProfile | null> {
  const auth = await loadUserAuth(userId);
  return auth?.profile ?? null;
}
