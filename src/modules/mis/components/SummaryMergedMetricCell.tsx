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
} from '@/modules/mis/services/account-merge';

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
  mergeSelection: MergeSelection;
  className?: string;
  onClick?: () => void;
};

export function SummaryMergedMetricCell({
  crm,
  client,
  mergeSelection,
  className = '',
  onClick,
}: Props) {
  const value = mergeSelectedMetrics(crm, client, mergeSelection);

  return (
    <td
      className={`p-2 border border-slate-300 text-center ${onClick ? 'cursor-pointer hover:bg-black/5' : ''} ${className}`}
      onClick={onClick}
    >
      {value.toLocaleString()}
    </td>
  );
}
