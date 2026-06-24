import 'server-only';

import { prisma } from '@/lib/db/prisma';
import {
  hasAnyReportPageAccess,
  hasCapability,
  resolveApiAccess,
  type RbacApiSpec,
} from '@/lib/auth/rbac-catalog';

export const HOD_ROLES = [
  'super_admin',
  'hod',
  'Super Admin',
  'Office Administrator',
  'Account Auditor',
] as const;

export type ReportSecurity = {
  isHod: boolean;
  assignedOffices: string[];
  forbidden?: boolean;
};

export function isHodUser(
  profile: { role?: string } | undefined,
  permissions: string[]
): boolean {
  return (
    hasCapability(permissions, 'view_all_offices') ||
    (HOD_ROLES as readonly string[]).includes(profile?.role || '')
  );
}

async function loadUserPermissions(userId: string): Promise<{
  profile: { office_ids?: string[]; role?: string; role_id?: string | null } | undefined;
  permissions: string[];
}> {
  const userProfileResult = await prisma.$queryRawUnsafe<
    { office_ids?: string[]; role?: string; role_id?: string | null }[]
  >(
    `SELECT u.office_ids, u.role, u.role_id
     FROM public.app_users u
     WHERE u.id = $1
     LIMIT 1`,
    userId
  );
  const profile = userProfileResult?.[0];

  let permissions: string[] = [];
  if (profile?.role_id) {
    const permissionRows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT ap.name
       FROM public.app_role_permissions arp
       JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE arp.role_id = $1`,
      profile.role_id
    );
    permissions = permissionRows.map((row) => row.name).filter(Boolean);
  }

  return { profile, permissions };
}

/** Resolves HOD flag and office scope for report APIs. */
export async function resolveReportSecurity(
  userId: string,
  spec?: RbacApiSpec | null
): Promise<ReportSecurity> {
  const { profile, permissions } = await loadUserPermissions(userId);

  if (spec) {
    if (!resolveApiAccess(permissions, spec)) {
      return { isHod: false, assignedOffices: [], forbidden: true };
    }
  } else if (!hasAnyReportPageAccess(permissions)) {
    return { isHod: false, assignedOffices: [], forbidden: true };
  }

  const assignedOffices = profile?.office_ids || [];
  const isHod = isHodUser(profile, permissions);

  return { isHod, assignedOffices };
}
