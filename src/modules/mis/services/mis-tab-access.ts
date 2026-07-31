import {
  canAccessMisTab,
  visibleTabs,
  type MisTabId,
} from '@/lib/auth/rbac-catalog';

export type MisAccess = {
  register: boolean;
  summary: boolean;
  accounts: boolean;
  client_import: boolean;
  deployment_completion: boolean;
  bd_mis_summary: boolean;
};

export type MisTabOption = { id: MisTabId; label: string; allowed: true };

export function buildMisAccess(
  userPermissions: string[],
  bdMisSummaryTabEnabled: boolean
): MisAccess {
  return {
    register: canAccessMisTab(userPermissions, 'register'),
    summary: canAccessMisTab(userPermissions, 'summary'),
    accounts: canAccessMisTab(userPermissions, 'accounts'),
    client_import: canAccessMisTab(userPermissions, 'client_import'),
    deployment_completion: canAccessMisTab(userPermissions, 'deployment_completion'),
    bd_mis_summary:
      bdMisSummaryTabEnabled && canAccessMisTab(userPermissions, 'bd_mis_summary'),
  };
}

export function buildMisTabs(
  userPermissions: string[],
  bdMisSummaryTabEnabled: boolean
): MisTabOption[] {
  return visibleTabs(userPermissions, 'mis_reports')
    .filter((tab) => bdMisSummaryTabEnabled || tab.id !== 'bd_mis_summary')
    .map((tab) => ({
      id: tab.id as MisTabId,
      label: tab.label,
      allowed: true as const,
    }));
}

export function resolveActiveMisTab(
  current: MisTabId,
  availableTabs: ReadonlyArray<Pick<MisTabOption, 'id'>>,
  fallback: MisTabId
): MisTabId {
  if (availableTabs.some((tab) => tab.id === current)) return current;
  return fallback;
}
