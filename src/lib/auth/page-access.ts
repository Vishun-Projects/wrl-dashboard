/** Page-level access definitions — used in Roles UI, sidebar, and route guards. */

export type PageAccessDefinition = {
  permission: string;
  label: string;
  description: string;
  path: string;
  /** When true, only exact path match (e.g. /report vs /report/distribution). */
  exactPath?: boolean;
  group: 'Reports' | 'Administration';
};

export const REPORT_PAGE_ACCESS: PageAccessDefinition[] = [
  {
    permission: 'page_mis_reports',
    label: 'MIS Reports',
    description: 'Call register, summary, and accounts tabs',
    path: '/report',
    exactPath: true,
    group: 'Reports',
  },
  {
    permission: 'page_call_distribution',
    label: 'Call Distribution',
    description: 'Franchisee map, idle assignees, and distribution KPIs',
    path: '/report/distribution',
    group: 'Reports',
  },
  {
    permission: 'page_arcp_claims',
    label: 'ARCP Claims',
    description: 'ARCP claims register and detail export',
    path: '/report/arcp-claims',
    group: 'Reports',
  },
  {
    permission: 'page_serial_audit',
    label: 'Serial Wise History',
    description: 'Repeat serial complaints and repair audit',
    path: '/report/serial-audit',
    group: 'Reports',
  },
  {
    permission: 'page_location_audit',
    label: 'Location Audit',
    description: 'Technician visit location verification',
    path: '/report/location-audit',
    group: 'Reports',
  },
];

export const ADMIN_PAGE_ACCESS: PageAccessDefinition[] = [
  {
    permission: 'manage_users',
    label: 'User Management',
    description: 'Create and edit portal users',
    path: '/admin/users',
    group: 'Administration',
  },
  {
    permission: 'manage_roles',
    label: 'Roles & Access',
    description: 'Define roles and page permissions',
    path: '/admin/roles',
    group: 'Administration',
  },
];

export const ALL_PAGE_ACCESS: PageAccessDefinition[] = [
  ...REPORT_PAGE_ACCESS,
  ...ADMIN_PAGE_ACCESS,
];

const PAGE_BY_PERMISSION = new Map(ALL_PAGE_ACCESS.map((p) => [p.permission, p]));

const LEGACY_REPORT_GRANTS = new Set(['view_calls', 'view_reports']);

export function getPageAccessDefinition(permission: string): PageAccessDefinition | undefined {
  return PAGE_BY_PERMISSION.get(permission);
}

export function isReportPagePermission(permission: string): boolean {
  return REPORT_PAGE_ACCESS.some((p) => p.permission === permission);
}

/** User has a specific page permission (includes legacy broad report grants). */
export function hasPagePermission(permissions: string[], permission: string): boolean {
  if (permissions.includes(permission)) return true;
  if (isReportPagePermission(permission)) {
    return [...LEGACY_REPORT_GRANTS].some((legacy) => permissions.includes(legacy));
  }
  return false;
}

export function hasAnyReportPageAccess(permissions: string[]): boolean {
  if ([...LEGACY_REPORT_GRANTS].some((legacy) => permissions.includes(legacy))) return true;
  return REPORT_PAGE_ACCESS.some((page) => permissions.includes(page.permission));
}

function pathMatchesPage(path: string, page: PageAccessDefinition): boolean {
  if (page.exactPath) return path === page.path;
  return path === page.path || path.startsWith(`${page.path}/`);
}

/** Whether the user may open this app route. Profile/login always allowed. */
export function canAccessPath(permissions: string[], path: string): boolean {
  if (path === '/login' || path.startsWith('/profile')) return true;

  for (const page of ALL_PAGE_ACCESS) {
    if (pathMatchesPage(path, page)) {
      return hasPagePermission(permissions, page.permission);
    }
  }

  return true;
}

/** First report page the user can access — for landing redirects. */
export function defaultReportLandingPath(permissions: string[]): string {
  for (const page of REPORT_PAGE_ACCESS) {
    if (hasPagePermission(permissions, page.permission)) return page.path;
  }
  return '/report';
}

/** Human-readable page labels granted to a role (for table chips). */
export function pageLabelsForPermissions(permissionNames: string[]): string[] {
  const labels: string[] = [];
  for (const page of ALL_PAGE_ACCESS) {
    if (hasPagePermission(permissionNames, page.permission)) {
      labels.push(page.label);
    }
  }
  return labels;
}

/** Group DB permission rows for the Roles modal. */
export function groupPermissionsForRolesUi(
  allPermissions: Array<{ id: string; name: string; description?: string | null }>
): {
  pages: Array<{ id: string; name: string; description?: string | null; definition: PageAccessDefinition }>;
  other: Array<{ id: string; name: string; description?: string | null }>;
} {
  const pagePermissionNames = new Set(ALL_PAGE_ACCESS.map((p) => p.permission));
  const pages: Array<{
    id: string;
    name: string;
    description?: string | null;
    definition: PageAccessDefinition;
  }> = [];

  for (const page of ALL_PAGE_ACCESS) {
    const row = allPermissions.find((p) => p.name === page.permission);
    if (row) {
      pages.push({ ...row, definition: page });
    }
  }

  const other = allPermissions.filter(
    (p) =>
      !pagePermissionNames.has(p.name) &&
      !LEGACY_REPORT_GRANTS.has(p.name)
  );

  return { pages, other };
}

export const PAGE_PERMISSION_SEED: Array<{ name: string; description: string }> =
  ALL_PAGE_ACCESS.map((p) => ({ name: p.permission, description: p.description }));
