import { withAppClient } from '@/lib/read-model/db';
import { expandPermissionList } from '@/lib/auth/rbac-catalog';
import type { AppUserAuthProfile } from '@/lib/auth/app-user-profile';
import { USER_ASSIGNED_ROLES_LATERAL } from '@/lib/auth/user-roles-sql';

export type UserAuthContext = {
  profile: AppUserAuthProfile;
  permissions: string[];
  created_at?: Date | string;
};

type UserAuthRow = AppUserAuthProfile & {
  created_at?: Date | string;
  permission_names: string[] | null;
  role_ids: string[] | null;
};

/** Load user profile + permissions from Postgres (CLI-safe, no server-only). */
export async function queryUserAuth(userId: string): Promise<UserAuthContext | null> {
  return withAppClient(async (client) => {
    const res = await client.query<UserAuthRow>(
      `SELECT u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses, u.avatar_url, u.role_id, u.theme, u.created_at,
              COALESCE(array_agg(DISTINCT assigned.role_id) FILTER (WHERE assigned.role_id IS NOT NULL), '{}') AS role_ids,
              COALESCE(array_agg(DISTINCT ap.name) FILTER (WHERE ap.name IS NOT NULL), '{}') AS permission_names
       FROM public.app_users u
       ${USER_ASSIGNED_ROLES_LATERAL}
       LEFT JOIN public.app_role_permissions arp ON arp.role_id = assigned.role_id
       LEFT JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE u.id = $1
       GROUP BY u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses, u.avatar_url, u.role_id, u.theme, u.created_at`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) return null;

    const { permission_names, created_at, role_ids, ...profile } = row;
    const roleIds = (role_ids ?? []).map(String).filter(Boolean);
    return {
      profile: {
        ...(profile as AppUserAuthProfile),
        role_ids: roleIds.length > 0 ? roleIds : profile.role_id ? [String(profile.role_id)] : [],
      },
      permissions: expandPermissionList(permission_names ?? []),
      created_at,
    };
  });
}
