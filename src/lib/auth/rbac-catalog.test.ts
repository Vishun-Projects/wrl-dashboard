import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_SEED,
  RBAC_PAGES,
  canAccessMisTab,
  canAccessPage,
  canAccessPath,
  canAssignMisEmail,
  defaultLandingPath,
  defaultMisTab,
  expandPermissionList,
  hasMisEmailSendAccess,
  resolveApiAccess,
  resolveMisEmailReportIncludes,
  seesAllOfficesForUser,
  visiblePages,
} from './rbac-catalog';

describe('expandPermissionList', () => {
  it('returns permissions unchanged (legacy aliases migrated in DB)', () => {
    const expanded = expandPermissionList(['view_mis_summary', 'tab_mis_register']);
    expect(expanded).toEqual(['view_mis_summary', 'tab_mis_register']);
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
    expect(canAccessPath(['super_admin'], '/admin/security-audit')).toBe(true);
    expect(canAccessPath(['manage_users'], '/admin/security-audit')).toBe(false);
    expect(canAccessPath(['manage_roles'], '/admin/security-audit')).toBe(false);
    expect(canAccessPath(['super_admin'], '/admin/vps-cron')).toBe(true);
    expect(canAccessPath(['manage_users'], '/admin/vps-cron')).toBe(false);
  });

  it('allows MIS report with page or tab permission', () => {
    expect(canAccessPath(['page_mis_reports'], '/report')).toBe(true);
    expect(canAccessPath(['tab_mis_register'], '/report')).toBe(true);
    expect(canAccessPath(['page_call_distribution'], '/report/distribution')).toBe(true);
    expect(canAccessPath(['tab_mis_register'], '/report/distribution')).toBe(false);
  });

  it('exactPath MIS does not leak into distribution or ARCP', () => {
    expect(canAccessPath(['page_mis_reports'], '/report')).toBe(true);
    expect(canAccessPath(['page_mis_reports'], '/report/distribution')).toBe(false);
    expect(canAccessPath(['page_mis_reports'], '/report/arcp-claims')).toBe(false);
    expect(canAccessPath(['tab_mis_register'], '/report/arcp-claims')).toBe(false);
  });

  it('gates admin hub, ARCP, and distribution by dedicated permissions', () => {
    expect(canAccessPath([], '/admin')).toBe(false);
    expect(canAccessPath([], '/report/distribution')).toBe(false);
    expect(canAccessPath([], '/report/arcp-claims')).toBe(false);
    expect(canAccessPath(['manage_users'], '/admin')).toBe(true);
    expect(canAccessPath(['manage_roles'], '/admin')).toBe(true);
    expect(canAccessPath(['manage_roles'], '/admin/sync')).toBe(false);
    expect(canAccessPath(['page_arcp_claims'], '/report/arcp-claims')).toBe(true);
    expect(canAccessPath(['page_call_distribution'], '/report/distribution')).toBe(true);
    expect(canAccessPath([], '/profile')).toBe(true);
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

  it('BD MIS and deployment completion need their tabs (or full MIS page)', () => {
    expect(
      resolveApiAccess(['tab_mis_register'], {
        pageId: 'mis_reports',
        tabId: 'bd_mis_summary',
      })
    ).toBe(false);
    expect(
      resolveApiAccess(['tab_mis_bd_mis_summary'], {
        pageId: 'mis_reports',
        tabId: 'bd_mis_summary',
      })
    ).toBe(true);
    expect(
      resolveApiAccess(['tab_mis_deployment_completion'], {
        pageId: 'mis_reports',
        tabId: 'deployment_completion',
      })
    ).toBe(true);
    expect(
      resolveApiAccess(['page_mis_reports'], {
        pageId: 'mis_reports',
        tabId: 'bd_mis_summary',
      })
    ).toBe(true);
    expect(
      resolveApiAccess(['page_mis_reports'], {
        pageId: 'mis_reports',
        tabId: 'deployment_completion',
      })
    ).toBe(true);
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

describe('visiblePages', () => {
  it('hides legacy routing and major-repair from sidebar', () => {
    const pages = visiblePages(['manage_users', 'page_mis_email_settings']);
    const paths = pages.map((p) => p.path);
    expect(paths).toContain('/admin/mis-email-settings');
    expect(paths).not.toContain('/admin/mis-email-routing');
    expect(paths).not.toContain('/admin/major-repair-alerts');
  });

  it('legacy routing permission still opens Mail & Alerts hub', () => {
    expect(canAccessPage(['page_mis_email_routing'], 'mis_email_settings')).toBe(true);
    expect(canAccessPath(['page_major_repair_alerts'], '/admin/mis-email-settings')).toBe(true);
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

  it('hasMisEmailSendAccess requires mis_email_send', () => {
    expect(hasMisEmailSendAccess(['mis_email_send'])).toBe(true);
    expect(hasMisEmailSendAccess(['tab_mis_summary'])).toBe(false);
  });

  it('Serial Audit / Client Import alone do not unlock report includes', () => {
    expect(resolveMisEmailReportIncludes(['page_serial_audit'])).toEqual({
      includeSummary: false,
      includeDetailed: false,
      includeKeyAccount: false,
    });
    expect(resolveMisEmailReportIncludes(['tab_mis_client_import'])).toEqual({
      includeSummary: false,
      includeDetailed: false,
      includeKeyAccount: false,
    });
    expect(canAssignMisEmail(['mis_email_send', 'page_serial_audit'])).toBe(false);
    expect(canAssignMisEmail(['mis_email_send', 'tab_mis_client_import'])).toBe(false);
  });

  it('requires mis_email_send plus a report type to assign email', () => {
    expect(canAssignMisEmail(['tab_mis_summary'])).toBe(false);
    expect(canAssignMisEmail(['mis_email_send'])).toBe(false);
    expect(canAssignMisEmail(['mis_email_send', 'tab_mis_summary'])).toBe(true);
    expect(canAssignMisEmail(['mis_email_send', 'page_mis_reports'])).toBe(true);
  });
});
