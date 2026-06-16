import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { hasAnyReportPageAccess, hasPagePermission } from '@/lib/auth/page-access';

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
    permissions.includes('view_all_offices') ||
    (HOD_ROLES as readonly string[]).includes(profile?.role || '')
  );
}

/** Resolves HOD flag and office scope for report APIs (register, corpus, serial audit, location audit). */
export async function resolveReportSecurity(
  userId: string,
  opts?: { pagePermission?: string }
): Promise<ReportSecurity> {
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

  if (opts?.pagePermission) {
    if (!hasPagePermission(permissions, opts.pagePermission)) {
      return { isHod: false, assignedOffices: [], forbidden: true };
    }
  } else if (!hasAnyReportPageAccess(permissions)) {
    return { isHod: false, assignedOffices: [], forbidden: true };
  }

  const assignedOffices = profile?.office_ids || [];
  const isHod = isHodUser(profile, permissions);

  return { isHod, assignedOffices };
}
