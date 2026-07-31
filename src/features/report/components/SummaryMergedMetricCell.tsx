import {
  accountMergeFlags,
  accountOpenCallsFromAging,
  accountOpenCallsFromAgingByAccount,
  accountRowScore,
  buildAccountDisplayRows,
  buildClientOnlyAccountRows,
  buildClientOnlyRegionalRows,
  DEFAULT_CLIENT_MERGE_WITH_CRM,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  displayLoggedCallCount,
  filterClientAccountSummary,
  filterKeyAccountRows,
  filterTopAccountsByZone,
  findAccountMetric,
  findAccountMetricByAccount,
  findBranchMetric,
  findBranchRowMetric,
  isAccountExcludedFromZoneTop,
  isCadburyAccount,
  isClientImportAccount,
  isCokeAccount,
  listAvailableKeyAccounts,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeFlagsFromSelection,
  mergedMetricValue,
  mergeSelectedMetrics,
  rollupAccountsByAccount,
  rollupCrmAccountsByRegion,
  resolveSummaryRegionMetric,
  resolveSummaryRegionOpenCalls,
  sumAccountMetric,
  sumAccountMetricByRegion,
  sumBranchLoggedCalls,
  sumBranchMetric,
  sumMergedAccountMetric,
  sumMergedAccountMetricByRegion,
  sumMergedAccountOpenCalls,
  sumMergedAccountOpenCallsByRegion,
  sumMergedGrandMetric,
  sumMergedGrandOpenCalls,
  buildMergedAccountMetricRow,
  type ClientMergeWithCrmPrefs,
  type ClientRegionalRow,
  type MergeSelection,
  type MergedAccountMetricRow,
} from '@/features/report/services/account-merge';

export {
  accountMergeFlags,
  accountOpenCallsFromAging,
  accountOpenCallsFromAgingByAccount,
  accountRowScore,
  buildAccountDisplayRows,
  buildClientOnlyAccountRows,
  buildClientOnlyRegionalRows,
  buildMergedAccountMetricRow,
  DEFAULT_CLIENT_MERGE_WITH_CRM,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  displayLoggedCallCount,
  filterClientAccountSummary,
  filterKeyAccountRows,
  filterTopAccountsByZone,
  findAccountMetric,
  findAccountMetricByAccount,
  findBranchMetric,
  findBranchRowMetric,
  isAccountExcludedFromZoneTop,
  isCadburyAccount,
  isClientImportAccount,
  isCokeAccount,
  listAvailableKeyAccounts,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeFlagsFromSelection,
  mergedMetricValue,
  mergeSelectedMetrics,
  rollupAccountsByAccount,
  rollupCrmAccountsByRegion,
  resolveSummaryRegionMetric,
  resolveSummaryRegionOpenCalls,
  sumAccountMetric,
  sumAccountMetricByRegion,
  sumBranchLoggedCalls,
  sumBranchMetric,
  sumMergedAccountMetric,
  sumMergedAccountMetricByRegion,
  sumMergedAccountOpenCalls,
  sumMergedAccountOpenCallsByRegion,
  sumMergedGrandMetric,
  sumMergedGrandOpenCalls,
  type ClientMergeWithCrmPrefs,
  type ClientRegionalRow,
  type MergeSelection,
  type MergedAccountMetricRow,
};

type Props = {
  crm: number;
  client: number;
  /** @deprecated Use mergeSelection */
  includeClientImport?: boolean;
  mergeSelection?: MergeSelection;
  className?: string;
  onClick?: () => void;
};

function resolveMergeSelection(
  includeClientImport?: boolean,
  mergeSelection?: MergeSelection
): MergeSelection {
  if (mergeSelection) return mergeSelection;
  return { crm: true, client: includeClientImport !== false };
}

export function SummaryMergedMetricCell({
  crm,
  client,
  includeClientImport,
  mergeSelection,
  className = '',
  onClick,
}: Props) {
  const selection = resolveMergeSelection(includeClientImport, mergeSelection);
  const value = mergeSelectedMetrics(crm, client, selection);

  return (
    <td
      className={`p-2 border border-slate-300 text-center ${onClick ? 'cursor-pointer hover:bg-black/5' : ''} ${className}`}
      onClick={onClick}
    >
      {value.toLocaleString()}
    </td>
  );
}
