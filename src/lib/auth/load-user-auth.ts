import 'server-only';

import { cache } from 'react';
import { withAppClient } from '@/lib/read-model/db';
import { expandPermissionList } from '@/lib/auth/rbac-catalog';
import type { AppUserAuthProfile } from '@/lib/auth/app-user-profile';

export type UserAuthContext = {
  profile: AppUserAuthProfile;
  permissions: string[];
  created_at?: Date | string;
};

type UserAuthRow = AppUserAuthProfile & {
  created_at?: Date | string;
  permission_names: string[] | null;
};

async function queryUserAuth(userId: string): Promise<UserAuthContext | null> {
  return withAppClient(async (client) => {
    const res = await client.query<UserAuthRow>(
      `SELECT u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses, u.avatar_url, u.role_id, u.created_at,
              COALESCE(array_agg(DISTINCT ap.name) FILTER (WHERE ap.name IS NOT NULL), '{}') AS permission_names
       FROM public.app_users u
       LEFT JOIN public.app_role_permissions arp ON arp.role_id = u.role_id
       LEFT JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE u.id = $1
       GROUP BY u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses, u.avatar_url, u.role_id, u.created_at`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) return null;

    const { permission_names, created_at, ...profile } = row;
    return {
      profile: profile as AppUserAuthProfile,
      permissions: expandPermissionList(permission_names ?? []),
      created_at,
    };
  });
}

/** Request-scoped cache: one JOIN per user id per server request. */
export const loadUserAuth = cache(async (userId: string): Promise<UserAuthContext | null> => {
  return queryUserAuth(userId);
});
