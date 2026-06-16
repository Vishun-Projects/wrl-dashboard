import 'server-only';

import { withAppClient } from '@/lib/read-model/db';

export type AppUserAuthProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[];
  visible_statuses: string[] | null;
  avatar_url: string | null;
  role_id: string | null;
};

/** Load app_users row via Postgres (no PostgREST HTTPS). */
export async function fetchAppUserAuthProfile(
  userId: string
): Promise<AppUserAuthProfile | null> {
  return withAppClient(async (client) => {
    const res = await client.query<AppUserAuthProfile>(
      `SELECT id, name, email, role, office_ids, visible_statuses, avatar_url, role_id
       FROM public.app_users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  });
}
