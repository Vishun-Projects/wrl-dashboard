import { describe, expect, it } from 'vitest';
import {
  canAccessMisTab,
  canAssignMisEmail,
  expandPermissionList,
  resolveMisEmailReportIncludes,
} from '@/lib/auth/rbac-catalog';
import { normalizeRoleIds } from '@/lib/auth/user-roles';

describe('normalizeRoleIds', () => {
  it('dedupes role_ids and falls back to role_id', () => {
    expect(normalizeRoleIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(normalizeRoleIds([], 'primary')).toEqual(['primary']);
    expect(normalizeRoleIds(null, 'primary')).toEqual(['primary']);
    expect(normalizeRoleIds([])).toEqual([]);
  });
});

describe('multi-role permission union', () => {
  it('unions tab permissions across roles', () => {
    const permissions = expandPermissionList(['tab_mis_summary', 'tab_mis_register']);
    expect(canAccessMisTab(permissions, 'summary')).toBe(true);
    expect(canAccessMisTab(permissions, 'register')).toBe(true);
    expect(canAccessMisTab(permissions, 'accounts')).toBe(false);
    expect(resolveMisEmailReportIncludes(permissions)).toEqual({
      includeSummary: true,
      includeDetailed: true,
      includeKeyAccount: false,
    });
  });

  it('allows MIS email when send capability + any report tab are present together', () => {
    expect(canAssignMisEmail(['tab_mis_summary', 'mis_email_send'])).toBe(true);
    expect(
      canAssignMisEmail(['tab_mis_summary', 'tab_mis_register', 'mis_email_send'])
    ).toBe(true);
  });
});
