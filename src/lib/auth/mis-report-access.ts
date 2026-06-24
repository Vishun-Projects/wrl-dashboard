/** Re-exports from the unified RBAC catalog (backward-compatible import path). */

export type { MisReportFeature, MisTabId } from '@/lib/auth/rbac-catalog';

export {
  TAB_PERMISSION_SEED as MIS_TAB_PERMISSION_SEED,
  hasMisFeatureAccess,
  hasAnyMisReportAccess,
  hasAnyMisAccess,
  canAccessMisTab,
  canAccessMisShared,
  defaultMisTab,
  visibleTabs,
} from '@/lib/auth/rbac-catalog';
