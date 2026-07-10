import { hasPagePermission } from '@/lib/auth/rbac-catalog';

export const PERFORMANCE_INSIGHTS_PATH = '/admin/performance-insights';

export function canAccessPerformanceInsights(permissions: string[]): boolean {
  return hasPagePermission(permissions, 'page_performance_insights');
}

export function isPerformanceInsightsPath(path: string): boolean {
  return path === PERFORMANCE_INSIGHTS_PATH || path.startsWith(`${PERFORMANCE_INSIGHTS_PATH}/`);
}
