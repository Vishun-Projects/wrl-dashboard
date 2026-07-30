import { describe, expect, it } from 'vitest';
import { canViewSecurityAudit } from '@/lib/security/audit-access';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';

describe('super_admin gates', () => {
  it('isSuperAdmin requires super_admin permission', () => {
    expect(isSuperAdmin(['super_admin'])).toBe(true);
    expect(isSuperAdmin(['view_all_offices', 'manage_users'])).toBe(false);
    expect(isSuperAdmin([])).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it('Activity Log uses super_admin only', () => {
    expect(canViewSecurityAudit(['super_admin'])).toBe(true);
    expect(canViewSecurityAudit(['manage_users'])).toBe(false);
    expect(canViewSecurityAudit(['view_all_offices'])).toBe(false);
  });
});
