import type { MisTabId } from '@/lib/auth/rbac-catalog';

export function exportLabelForMisTab(
  tab: MisTabId,
  format: 'excel' | 'csv' = 'excel'
): string {
  if (tab === 'register') {
    return format === 'csv' ? 'Call Register CSV' : 'Call Register Excel';
  }
  if (tab === 'summary') return 'Summary Dashboard Excel';
  if (tab === 'accounts') return 'Key Account MIS Excel';
  if (tab === 'bd_mis_summary') return 'BD MIS Summary Excel';
  return 'Report Excel';
}

/** Maps frozen source tab to export branch — used to verify tab routing at enqueue time. */
export function resolveExportBranch(
  sourceTab: MisTabId
): 'register' | 'bd_mis_summary' | 'summary' | 'accounts' | 'unsupported' {
  if (sourceTab === 'register') return 'register';
  if (sourceTab === 'bd_mis_summary') return 'bd_mis_summary';
  if (sourceTab === 'summary') return 'summary';
  if (sourceTab === 'accounts') return 'accounts';
  return 'unsupported';
}
