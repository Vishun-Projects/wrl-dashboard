import 'server-only';

import {
  hasAnyReportPageAccess,
  hasCapability,
  LEGACY_HOD_ROLE_NAMES,
  resolveApiAccess,
  type RbacApiSpec,
} from '@/lib/auth/rbac-catalog';
import { loadUserAuth } from '@/lib/auth/load-user-auth';

export const HOD_ROLES = LEGACY_HOD_ROLE_NAMES;

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

/** HOD / view_all_offices ⇒ national scope; else restrict to assigned office_ids. */
export async function resolveReportSecurity(
  userId: string,
  spec?: RbacApiSpec | null
): Promise<ReportSecurity> {
  const auth = await loadUserAuth(userId);
  const profile = auth?.profile;
  const permissions = auth?.permissions ?? [];

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

/** Office scope for exports — same page/tab gate as interactive register (no bypass). */
export async function resolveExportOfficeScope(userId: string): Promise<ReportSecurity> {
  return resolveReportSecurity(userId, {
    pageId: 'mis_reports',
    tabId: 'register',
  });
}
