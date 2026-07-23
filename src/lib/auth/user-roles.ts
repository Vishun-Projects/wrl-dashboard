import { prisma } from '@/lib/db/prisma';
import { expandPermissionList } from '@/lib/auth/rbac-catalog';

export function normalizeRoleIds(raw: unknown, fallbackRoleId?: unknown): string[] {
  const fromArray = Array.isArray(raw)
    ? raw.map((v) => String(v ?? '').trim()).filter(Boolean)
    : [];
  if (fromArray.length > 0) {
    return [...new Set(fromArray)];
  }
  const single = String(fallbackRoleId ?? '').trim();
  return single ? [single] : [];
}

export async function replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
  const unique = [...new Set(roleIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error('At least one role is required');
  }

  await prisma.$queryRawUnsafe(`DELETE FROM public.app_user_roles WHERE user_id = $1`, userId);
  for (const roleId of unique) {
    await prisma.$queryRawUnsafe(
      `INSERT INTO public.app_user_roles (user_id, role_id) VALUES ($1, $2)`,
      userId,
      roleId
    );
  }
}

export async function loadPermissionsForRoleIds(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(array_agg(DISTINCT ap.name) FILTER (WHERE ap.name IS NOT NULL), '{}') AS permission_names
     FROM public.app_role_permissions arp
     JOIN public.app_permissions ap ON ap.id = arp.permission_id
     WHERE arp.role_id = ANY($1::uuid[])`,
    roleIds
  )) as { permission_names: string[] }[];
  return expandPermissionList(rows[0]?.permission_names ?? []);
}

export async function loadRoleNamesByIds(
  roleIds: string[]
): Promise<Map<string, string>> {
  if (roleIds.length === 0) return new Map();
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, name FROM public.app_roles WHERE id = ANY($1::uuid[])`,
    roleIds
  )) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}
