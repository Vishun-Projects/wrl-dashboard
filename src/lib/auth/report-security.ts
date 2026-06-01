import 'server-only';

import { prisma } from '@/lib/prisma';

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
export async function resolveReportSecurity(userId: string): Promise<ReportSecurity> {
  const permissions = await prisma.getUserPermissions(userId);
  if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
    return { isHod: false, assignedOffices: [], forbidden: true };
  }

  const userProfileResult = await prisma.$queryRawUnsafe<
    { office_ids?: string[]; role?: string }[]
  >('SELECT office_ids, role FROM public.app_users WHERE id = $1 LIMIT 1', userId);
  const profile = userProfileResult?.[0];
  const assignedOffices = profile?.office_ids || [];
  const isHod = isHodUser(profile, permissions);

  return { isHod, assignedOffices };
}
