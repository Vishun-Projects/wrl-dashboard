import { isSuperAdmin } from '@/lib/auth/rbac-catalog';

/** Activity Log — Super Admin only (not HOD / manage_users alone). */
export function canViewSecurityAudit(permissions: string[] | null | undefined): boolean {
  return isSuperAdmin(permissions);
}
