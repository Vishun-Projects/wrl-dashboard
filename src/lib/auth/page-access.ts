/** Re-exports from the unified RBAC catalog (backward-compatible import path). */

export type { PageAccessDefinition, RbacPageGroup } from '@/lib/auth/rbac-catalog';

export {
  ALL_PAGE_ACCESS,
  ADMIN_PAGE_ACCESS,
  REPORT_PAGE_ACCESS,
  PAGE_PERMISSION_SEED,
  ALL_PERMISSION_SEED,
  TAB_PERMISSION_SEED,
  CAPABILITY_PERMISSION_SEED,
  getPageAccessDefinition,
  isReportPagePermission,
  hasPagePermission,
  hasAnyReportPageAccess,
  canAccessPath,
  defaultReportLandingPath,
  defaultLandingPath,
  pageLabelsForPermissions,
  accessLabelsForPermissions,
  groupPermissionsForRolesUi,
  visiblePages,
  canAccessPage,
  hasAnyMisAccess,
  type RolesUiPageRow,
} from '@/lib/auth/rbac-catalog';
