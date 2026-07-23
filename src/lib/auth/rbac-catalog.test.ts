import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_SEED,
  RBAC_PAGES,
  canAccessMisTab,
  canAccessPath,
  canAssignMisEmail,
  defaultLandingPath,
  defaultMisTab,
  expandPermissionList,
  resolveApiAccess,
  resolveMisEmailReportIncludes,
  seesAllOfficesForUser,
} from './rbac-catalog';

describe('expandPermissionList', () => {
  it('maps legacy MIS tab aliases to canonical names', () => {
    const expanded = expandPermissionList(['view_mis_summary']);
    expect(expanded).toContain('tab_mis_summary');
  });
});

describe('canAccessPath', () => {
  it('allows login and profile without permissions', () => {
    expect(canAccessPath([], '/login')).toBe(true);
    expect(canAccessPath([], '/profile')).toBe(true);
    expect(canAccessPath([], '/forgot-password')).toBe(true);
    expect(canAccessPath([], '/reset-password')).toBe(true);
  });

  it('requires manage_users for admin sync', () => {
    expect(canAccessPath(['manage_users'], '/admin/sync')).toBe(true);
    expect(canAccessPath(['manage_roles'], '/admin/sync')).toBe(false);
  });

  it('allows MIS report with page or tab permission', () => {
    expect(canAccessPath(['page_mis_reports'], '/report')).toBe(true);
    expect(canAccessPath(['tab_mis_register'], '/report')).toBe(true);
    expect(canAccessPath(['page_call_distribution'], '/report/distribution')).toBe(true);
    expect(canAccessPath(['tab_mis_register'], '/report/distribution')).toBe(false);
  });
});

describe('seesAllOfficesForUser', () => {
  it('treats empty office_ids as all branches', () => {
    expect(seesAllOfficesForUser([], 'branch_manager', [])).toBe(true);
  });

  it('restricts when office_ids are set without view_all_offices', () => {
    expect(seesAllOfficesForUser([], 'branch_manager', ['101'])).toBe(false);
  });

  it('grants national scope with view_all_offices', () => {
    expect(seesAllOfficesForUser(['view_all_offices'], 'branch_manager', ['101'])).toBe(true);
  });
});

describe('defaultMisTab', () => {
  it('prefers register then summary then accounts', () => {
    expect(defaultMisTab(['tab_mis_register', 'tab_mis_summary'])).toBe('register');
    expect(defaultMisTab(['tab_mis_summary', 'tab_mis_accounts'])).toBe('summary');
    expect(defaultMisTab(['tab_mis_accounts'])).toBe('accounts');
  });
});

describe('defaultLandingPath', () => {
  it('returns first accessible report page', () => {
    expect(defaultLandingPath(['page_arcp_claims'])).toBe('/report/arcp-claims');
    expect(defaultLandingPath(['manage_users'])).toBe('/admin/users');
  });
});

describe('resolveApiAccess', () => {
  it('allows shared MIS endpoints with any MIS tab', () => {
    expect(resolveApiAccess(['tab_mis_register'], { pageId: 'mis_reports', shared: true })).toBe(
      true
    );
    expect(resolveApiAccess([], { pageId: 'mis_reports', shared: true })).toBe(false);
  });

  it('checks tab-specific MIS APIs', () => {
    expect(
      resolveApiAccess(['tab_mis_summary'], { pageId: 'mis_reports', tabId: 'summary' })
    ).toBe(true);
    expect(
      resolveApiAccess(['tab_mis_register'], { pageId: 'mis_reports', tabId: 'summary' })
    ).toBe(false);
  });
});

describe('canAccessMisTab', () => {
  it('grants all tabs when page_mis_reports is present', () => {
    expect(canAccessMisTab(['page_mis_reports'], 'accounts')).toBe(true);
    expect(canAccessMisTab(['page_mis_reports'], 'client_import')).toBe(true);
  });

  it('grants client import tab with dedicated permission', () => {
    expect(canAccessMisTab(['tab_mis_client_import'], 'client_import')).toBe(true);
    expect(canAccessMisTab(['tab_mis_client_import'], 'summary')).toBe(false);
  });
});

describe('ALL_PERMISSION_SEED', () => {
  it('includes every page and tab permission', () => {
    const seeded = new Set(ALL_PERMISSION_SEED.map((p) => p.name));
    for (const page of RBAC_PAGES) {
      expect(seeded.has(page.permission), `missing ${page.permission}`).toBe(true);
      for (const tab of page.tabs ?? []) {
        expect(seeded.has(tab.permission), `missing ${tab.permission}`).toBe(true);
      }
    }
  });

  it('includes client import capabilities', () => {
    const seeded = new Set(ALL_PERMISSION_SEED.map((p) => p.name));
    expect(seeded.has('mis_client_import_upload')).toBe(true);
    expect(seeded.has('mis_client_import_delete')).toBe(true);
  });

  it('includes mis_email_send capability', () => {
    const seeded = new Set(ALL_PERMISSION_SEED.map((p) => p.name));
    expect(seeded.has('mis_email_send')).toBe(true);
  });
});

describe('mis email access helpers', () => {
  it('page_mis_reports unlocks all core report includes', () => {
    expect(resolveMisEmailReportIncludes(['page_mis_reports'])).toEqual({
      includeSummary: true,
      includeDetailed: true,
      includeKeyAccount: true,
    });
  });

  it('requires mis_email_send plus a report type to assign email', () => {
    expect(canAssignMisEmail(['tab_mis_summary'])).toBe(false);
    expect(canAssignMisEmail(['mis_email_send'])).toBe(false);
    expect(canAssignMisEmail(['mis_email_send', 'tab_mis_summary'])).toBe(true);
    expect(canAssignMisEmail(['mis_email_send', 'page_mis_reports'])).toBe(true);
  });
});
