/**
 * Single source of truth for page, tab, and capability permissions.
 * Client-safe — no server-only imports.
 */

export type RbacPageGroup = 'Reports' | 'Administration';

export type RbacTab = {
  id: string;
  permission: string;
  label: string;
  parentPageId: string;
};

export type RbacPage = {
  id: string;
  permission: string;
  path: string;
  label: string;
  description: string;
  exactPath?: boolean;
  group: RbacPageGroup;
  tabs?: RbacTab[];
  /** When false, omitted from sidebar (still used for Roles / path access). */
  nav?: boolean;
};

export type RbacCapability = {
  permission: string;
  label: string;
  description: string;
};

export type MisTabId = 'summary' | 'register' | 'accounts' | 'client_import' | 'bd_mis_summary' | 'deployment_completion';

export type RbacApiSpec =
  | { pageId: string }
  | { pageId: 'mis_reports'; tabId: MisTabId }
  | { pageId: 'mis_reports'; shared: true };

const MIS_TABS: RbacTab[] = [
  {
    id: 'summary',
    permission: 'tab_mis_summary',
    label: 'Summary Dashboard',
    parentPageId: 'mis_reports',
  },
  {
    id: 'register',
    permission: 'tab_mis_register',
    label: 'Call Register',
    parentPageId: 'mis_reports',
  },
  {
    id: 'accounts',
    permission: 'tab_mis_accounts',
    label: 'Key Account MIS',
    parentPageId: 'mis_reports',
  },
  {
    id: 'client_import',
    permission: 'tab_mis_client_import',
    label: 'Client Import',
    parentPageId: 'mis_reports',
  },
  {
    id: 'bd_mis_summary',
    permission: 'tab_mis_bd_mis_summary',
    label: 'Cadbury+Coke+CRM Summary Dashboard',
    parentPageId: 'mis_reports',
  },
  {
    id: 'deployment_completion',
    permission: 'tab_mis_deployment_completion',
    label: 'Deployment Completion',
    parentPageId: 'mis_reports',
  },
];

export const RBAC_PAGES: RbacPage[] = [
  {
    id: 'mis_reports',
    permission: 'page_mis_reports',
    path: '/report',
    label: 'MIS Reports',
    description: 'Call register, summary, and accounts',
    exactPath: true,
    group: 'Reports',
    tabs: MIS_TABS,
  },
  {
    id: 'call_distribution',
    permission: 'page_call_distribution',
    path: '/report/distribution',
    label: 'Call Distribution',
    description: 'Franchisee map, idle assignees, and distribution KPIs',
    group: 'Reports',
  },
  {
    id: 'arcp_claims',
    permission: 'page_arcp_claims',
    path: '/report/arcp-claims',
    label: 'ARCP Claims',
    description: 'ARCP claims register and detail export',
    group: 'Reports',
  },
  {
    id: 'serial_audit',
    permission: 'page_serial_audit',
    path: '/report/serial-audit',
    label: 'Serial Wise History',
    description: 'Repeat serial complaints and repair audit',
    group: 'Reports',
  },
  {
    id: 'location_audit',
    permission: 'page_location_audit',
    path: '/report/location-audit',
    label: 'Location Audit',
    description: 'Technician visit location verification',
    group: 'Reports',
  },
  {
    id: 'warranty_master',
    permission: 'page_warranty_master',
    path: '/report/warranty-master',
    label: 'Warranty Master',
    description: 'Active machines by customer, group, and warranty period',
    group: 'Reports',
  },
  {
    id: 'admin_users',
    permission: 'manage_users',
    path: '/admin/users',
    label: 'User Management',
    description: 'Create and edit portal users',
    group: 'Administration',
  },
  {
    id: 'admin_roles',
    permission: 'manage_roles',
    path: '/admin/roles',
    label: 'Roles & Access',
    description: 'Define roles and page permissions',
    group: 'Administration',
  },
  {
    id: 'mis_email_settings',
    permission: 'page_mis_email_settings',
    path: '/admin/mis-email-settings',
    label: 'Mail & Alerts',
    description: 'Org settings, MIS email routing, and major repair alerts',
    group: 'Administration',
  },
  {
    id: 'mis_email_routing',
    permission: 'page_mis_email_routing',
    path: '/admin/mis-email-routing',
    label: 'MIS Email Routing',
    description: 'Legacy path — use Mail & Alerts hub',
    group: 'Administration',
    nav: false,
  },
  {
    id: 'major_repair_alerts',
    permission: 'page_major_repair_alerts',
    path: '/admin/major-repair-alerts',
    label: 'Major Repair Alerts',
    description: 'Legacy path — use Mail & Alerts hub',
    group: 'Administration',
    nav: false,
  },
  {
    id: 'performance_insights',
    permission: 'page_performance_insights',
    path: '/admin/performance-insights',
    label: 'Performance Insights',
    description: 'Client performance metrics and diagnostics',
    group: 'Administration',
  },
];

export const MIS_EMAIL_SEND_PERMISSION = 'mis_email_send';

export const SUPER_ADMIN_PERMISSION = 'super_admin';

export const RBAC_CAPABILITIES: RbacCapability[] = [
  {
    permission: 'view_all_offices',
    label: 'View all offices',
    description: 'National data scope across all branches',
  },
  {
    permission: SUPER_ADMIN_PERMISSION,
    label: 'Super Admin',
    description:
      'Privileged portal controls (Activity Log, VPS Cron, Call Register account visibility). Do not grant to HOD.',
  },
  {
    permission: MIS_EMAIL_SEND_PERMISSION,
    label: 'MIS email reports',
    description: 'Compose, send, and receive scheduled MIS digests (admin still opts each user in)',
  },
  {
    permission: 'mis_client_import_upload',
    label: 'Import client MIS files',
    description: 'Upload Coke, Cadbury, and other client import files',
  },
  {
    permission: 'mis_client_import_delete',
    label: 'Delete client imports',
    description: 'Remove uploaded client import batches and their rows',
  },
];

/** Legacy permission names mapped to canonical tab permissions (pre-migration DB rows). */
const TAB_PERMISSION_ALIASES: Record<string, string> = {
  view_mis_summary: 'tab_mis_summary',
  view_summary: 'tab_mis_summary',
  view_mis_register: 'tab_mis_register',
  view_mis_accounts: 'tab_mis_accounts',
};

/** Permissions excluded from Roles UI "other" bucket — managed in hierarchical editor. */
export const RBAC_MANAGED_PERMISSIONS = new Set([
  ...RBAC_PAGES.map((p) => p.permission),
  ...MIS_TABS.map((t) => t.permission),
  ...RBAC_CAPABILITIES.map((c) => c.permission),
  ...Object.keys(TAB_PERMISSION_ALIASES),
]);

const PAGE_BY_ID = new Map(RBAC_PAGES.map((p) => [p.id, p]));
const PAGE_BY_PERMISSION = new Map(RBAC_PAGES.map((p) => [p.permission, p]));
const TAB_BY_ID = new Map(MIS_TABS.map((t) => [t.id, t]));

function expandPermissions(permissions: string[] | null | undefined): Set<string> {
  const list = Array.isArray(permissions) ? permissions : [];
  const expanded = new Set(list);
  for (const name of list) {
    const canonical = TAB_PERMISSION_ALIASES[name];
    if (canonical) expanded.add(canonical);
  }
  return expanded;
}

export function expandPermissionList(permissions: string[]): string[] {
  return [...expandPermissions(permissions)];
}

/** Legacy role column values that imply national office scope (prefer view_all_offices). */
export const LEGACY_HOD_ROLE_NAMES = [
  'hod',
  'Office Administrator',
  'Account Auditor',
] as const;

function hasPermission(permissions: string[], name: string): boolean {
  return expandPermissions(permissions).has(name);
}

function pageByPath(path: string): RbacPage | undefined {
  for (const page of RBAC_PAGES) {
    if (page.exactPath) {
      if (path === page.path) return page;
    } else if (path === page.path || path.startsWith(`${page.path}/`)) {
      return page;
    }
  }
  return undefined;
}

export function hasFullPageAccess(permissions: string[], pageId: string): boolean {
  const page = PAGE_BY_ID.get(pageId);
  if (!page) return false;
  return hasPermission(permissions, page.permission);
}

export function canAccessPage(permissions: string[], pageId: string): boolean {
  const page = PAGE_BY_ID.get(pageId);
  if (!page) return false;
  // Mail & Alerts hub + legacy paths share one OR-gate so any legacy/admin/HOD grant opens the hub.
  if (
    pageId === 'mis_email_routing' ||
    pageId === 'major_repair_alerts' ||
    pageId === 'mis_email_settings'
  ) {
    if (
      hasCapability(permissions, 'view_all_offices') ||
      hasPermission(permissions, 'manage_users') ||
      hasPermission(permissions, 'manage_roles') ||
      hasPermission(permissions, 'page_mis_email_settings') ||
      hasPermission(permissions, 'page_mis_email_routing') ||
      hasPermission(permissions, 'page_major_repair_alerts')
    ) {
      return true;
    }
  }
  if (hasFullPageAccess(permissions, pageId)) return true;
  if (page.tabs?.length) {
    return page.tabs.some((tab) => hasPermission(permissions, tab.permission));
  }
  return false;
}

export function canAccessTab(permissions: string[], pageId: string, tabId: string): boolean {
  const page = PAGE_BY_ID.get(pageId);
  const tab = TAB_BY_ID.get(tabId);
  if (!page || !tab || tab.parentPageId !== pageId) return false;
  if (hasFullPageAccess(permissions, pageId)) return true;
  return hasPermission(permissions, tab.permission);
}

export function hasAnyMisAccess(permissions: string[]): boolean {
  return canAccessPage(permissions, 'mis_reports');
}

export function canAccessMisTab(permissions: string[], tabId: MisTabId): boolean {
  return canAccessTab(permissions, 'mis_reports', tabId);
}

/** Role may use Profile email + digests when admin also sets mis_email_enabled. */
export function hasMisEmailSendAccess(permissions: string[]): boolean {
  return hasCapability(permissions, MIS_EMAIL_SEND_PERMISSION);
}

/**
 * Which digest report types a role can include.
 * page_mis_reports alone counts as all core MIS tabs (summary / register / accounts).
 */
export function resolveMisEmailReportIncludes(permissions: string[]): {
  includeSummary: boolean;
  includeDetailed: boolean;
  includeKeyAccount: boolean;
} {
  return {
    includeSummary: canAccessMisTab(permissions, 'summary'),
    includeDetailed: canAccessMisTab(permissions, 'register'),
    includeKeyAccount: canAccessMisTab(permissions, 'accounts'),
  };
}

/** Roles UI / Users toggle: need mail capability + at least one MIS report type. */
export function canAssignMisEmail(permissions: string[]): boolean {
  if (!hasMisEmailSendAccess(permissions)) return false;
  const includes = resolveMisEmailReportIncludes(permissions);
  return includes.includeSummary || includes.includeDetailed || includes.includeKeyAccount;
}

export function canAccessMisShared(permissions: string[]): boolean {
  return hasAnyMisAccess(permissions);
}

export function resolveApiAccess(
  permissions: string[],
  spec: RbacApiSpec
): boolean {
  if ('shared' in spec && spec.shared) {
    return canAccessMisShared(permissions);
  }
  if ('tabId' in spec && spec.tabId) {
    return canAccessMisTab(permissions, spec.tabId);
  }
  return canAccessPage(permissions, spec.pageId);
}

export function visiblePages(permissions: string[]): RbacPage[] {
  return RBAC_PAGES.filter(
    (page) => page.nav !== false && canAccessPage(permissions, page.id)
  );
}

export function visibleTabs(permissions: string[], pageId: string): RbacTab[] {
  const page = PAGE_BY_ID.get(pageId);
  if (!page?.tabs) return [];
  return page.tabs.filter((tab) => canAccessTab(permissions, pageId, tab.id));
}

export function defaultMisTab(permissions: string[]): MisTabId {
  if (canAccessMisTab(permissions, 'register')) return 'register';
  if (canAccessMisTab(permissions, 'summary')) return 'summary';
  if (canAccessMisTab(permissions, 'accounts')) return 'accounts';
  return 'summary';
}

export function isPublicAuthRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  return (
    path === '/login' ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password')
  );
}

export function canAccessPath(
  permissions: string[],
  path: string
): boolean {
  // Authenticated users always reach /profile; public auth routes need no RBAC.
  if (isPublicAuthRoute(path) || path.startsWith('/profile')) return true;

  if (path === '/admin' || path === '/admin/') {
    return hasPermission(permissions, 'manage_users') || hasPermission(permissions, 'manage_roles');
  }

  if (path === '/admin/sync' || path.startsWith('/admin/sync/')) {
    return hasPermission(permissions, 'manage_users');
  }

  // Activity Log + VPS Cron: super_admin only (not manage_users / HOD).
  if (path === '/admin/security-audit' || path.startsWith('/admin/security-audit/')) {
    return hasPermission(permissions, SUPER_ADMIN_PERMISSION);
  }

  if (path === '/admin/vps-cron' || path.startsWith('/admin/vps-cron/')) {
    return hasPermission(permissions, SUPER_ADMIN_PERMISSION);
  }

  const page = pageByPath(path);
  if (!page) return false;
  return canAccessPage(permissions, page.id);
}

export function defaultLandingPath(permissions: string[]): string {
  const reportPages = RBAC_PAGES.filter((p) => p.group === 'Reports');
  for (const page of reportPages) {
    if (canAccessPage(permissions, page.id)) return page.path;
  }
  for (const page of RBAC_PAGES) {
    if (canAccessPage(permissions, page.id)) return page.path;
  }
  return '/login';
}

/** @deprecated Use defaultLandingPath */
export function defaultReportLandingPath(permissions: string[]): string {
  return defaultLandingPath(permissions);
}

export function hasPagePermission(permissions: string[], permission: string): boolean {
  const page = PAGE_BY_PERMISSION.get(permission);
  if (page) return canAccessPage(permissions, page.id);
  for (const tab of MIS_TABS) {
    if (tab.permission === permission) {
      return canAccessTab(permissions, 'mis_reports', tab.id);
    }
  }
  return hasPermission(permissions, permission);
}

export function hasAnyReportPageAccess(permissions: string[]): boolean {
  return RBAC_PAGES.some((p) => p.group === 'Reports' && canAccessPage(permissions, p.id));
}

export function hasCapability(permissions: string[], permission: string): boolean {
  return hasPermission(permissions, permission);
}

/** Privileged portal controls — above HOD (view_all_offices alone is not enough). */
export function isSuperAdmin(permissions: string[] | null | undefined): boolean {
  return hasCapability(permissions ?? [], SUPER_ADMIN_PERMISSION);
}

/** Client-safe office scope: empty office_ids = all branches; non-empty = restrict. */
export function seesAllOfficesForUser(
  permissions: string[],
  role: string,
  officeIds: string[]
): boolean {
  if (hasCapability(permissions, 'view_all_offices')) return true;
  if ((LEGACY_HOD_ROLE_NAMES as readonly string[]).includes(role)) return true;
  return officeIds.length === 0;
}

export function accessLabelsForPermissions(permissionNames: string[]): string[] {
  const labels: string[] = [];
  for (const page of RBAC_PAGES) {
    if (!canAccessPage(permissionNames, page.id)) continue;
    if (page.id === 'mis_reports' && page.tabs) {
      const tabs = visibleTabs(permissionNames, page.id);
      if (hasFullPageAccess(permissionNames, page.id) || tabs.length === page.tabs.length) {
        labels.push(page.label);
      } else if (tabs.length > 0) {
        labels.push(`${page.label} (${tabs.map((t) => t.label).join(', ')})`);
      }
    } else {
      labels.push(page.label);
    }
  }
  for (const cap of RBAC_CAPABILITIES) {
    if (hasCapability(permissionNames, cap.permission)) {
      labels.push(cap.label);
    }
  }
  return labels;
}

/** @deprecated Use accessLabelsForPermissions */
export function pageLabelsForPermissions(permissionNames: string[]): string[] {
  return accessLabelsForPermissions(permissionNames);
}

export function getPageById(pageId: string): RbacPage | undefined {
  return PAGE_BY_ID.get(pageId);
}

export function getTabById(tabId: string): RbacTab | undefined {
  return TAB_BY_ID.get(tabId);
}

export type PageAccessDefinition = {
  permission: string;
  label: string;
  description: string;
  path: string;
  exactPath?: boolean;
  group: RbacPageGroup;
};

export const REPORT_PAGE_ACCESS: PageAccessDefinition[] = RBAC_PAGES.filter(
  (p) => p.group === 'Reports'
).map((p) => ({
  permission: p.permission,
  label: p.label,
  description: p.description,
  path: p.path,
  exactPath: p.exactPath,
  group: p.group,
}));

export const ADMIN_PAGE_ACCESS: PageAccessDefinition[] = RBAC_PAGES.filter(
  (p) => p.group === 'Administration'
).map((p) => ({
  permission: p.permission,
  label: p.label,
  description: p.description,
  path: p.path,
  exactPath: p.exactPath,
  group: p.group,
}));

export const ALL_PAGE_ACCESS: PageAccessDefinition[] = [
  ...REPORT_PAGE_ACCESS,
  ...ADMIN_PAGE_ACCESS,
];

export function getPageAccessDefinition(permission: string): PageAccessDefinition | undefined {
  return ALL_PAGE_ACCESS.find((p) => p.permission === permission);
}

export function isReportPagePermission(permission: string): boolean {
  return REPORT_PAGE_ACCESS.some((p) => p.permission === permission);
}

export const TAB_PERMISSION_SEED: Array<{ name: string; description: string }> =
  MIS_TABS.map((t) => ({
    name: t.permission,
    description: `${t.label} tab on MIS Reports`,
  }));

export const PAGE_PERMISSION_SEED: Array<{ name: string; description: string }> =
  RBAC_PAGES.map((p) => ({ name: p.permission, description: p.description }));

export const CAPABILITY_PERMISSION_SEED: Array<{ name: string; description: string }> =
  RBAC_CAPABILITIES.map((c) => ({ name: c.permission, description: c.description }));

export const ALL_PERMISSION_SEED: Array<{ name: string; description: string }> = [
  ...PAGE_PERMISSION_SEED,
  ...TAB_PERMISSION_SEED,
  ...CAPABILITY_PERMISSION_SEED,
];

export type RolesUiPageRow = {
  id: string;
  name: string;
  description?: string | null;
  definition: PageAccessDefinition;
  pageId: string;
  tabs: Array<{
    id: string;
    name: string;
    description?: string | null;
    permission: string;
    label: string;
  }>;
};

export function groupPermissionsForRolesUi(
  allPermissions: Array<{ id: string; name: string; description?: string | null }>
): {
  pages: RolesUiPageRow[];
  capabilities: Array<{ id: string; name: string; description?: string | null }>;
  other: Array<{ id: string; name: string; description?: string | null }>;
} {
  const pages: RolesUiPageRow[] = [];

  for (const page of RBAC_PAGES) {
    if (page.nav === false) continue;
    const row = allPermissions.find((p) => p.name === page.permission);
    if (!row) continue;

    const tabs =
      page.tabs?.map((tab) => {
        const tabRow = allPermissions.find((p) => p.name === tab.permission);
        return {
          id: tabRow?.id ?? tab.permission,
          name: tab.permission,
          description: tabRow?.description ?? null,
          permission: tab.permission,
          label: tab.label,
        };
      }) ?? [];

    pages.push({
      ...row,
      definition: {
        permission: page.permission,
        label: page.label,
        description: page.description,
        path: page.path,
        exactPath: page.exactPath,
        group: page.group,
      },
      pageId: page.id,
      tabs,
    });
  }

  const capabilities = RBAC_CAPABILITIES.map((cap) => {
    const row = allPermissions.find((p) => p.name === cap.permission);
    return row ?? { id: cap.permission, name: cap.permission, description: cap.description };
  });

  const other = allPermissions.filter((p) => !RBAC_MANAGED_PERMISSIONS.has(p.name));

  return { pages, capabilities, other };
}

/** @deprecated Use canAccessMisTab */
export type MisReportFeature = 'register' | 'summary' | 'accounts' | 'shared';

/** @deprecated Use canAccessMisTab / canAccessMisShared */
export function hasMisFeatureAccess(permissions: string[], feature: MisReportFeature): boolean {
  if (feature === 'shared') return canAccessMisShared(permissions);
  return canAccessMisTab(permissions, feature);
}

/** @deprecated Use hasAnyMisAccess */
export function hasAnyMisReportAccess(permissions: string[]): boolean {
  return hasAnyMisAccess(permissions);
}
