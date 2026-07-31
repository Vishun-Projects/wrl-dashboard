import {
  ARCP_DEFAULT_DATE_FILTER_COLUMN,
  type ArcpClaimsQueryOpts,
  type ArcpDateFilterColumn,
} from '@/sql/arcp/query';

export type ArcpAppliedFiltersSnapshot = {
  startDateStr: string;
  endDateStr: string;
  arcpDateFilterColumn: ArcpDateFilterColumn;
  branchParam: string;
  franchiseeParam: string;
  callTypeParam: string;
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedCallTypes: string[];
};

export function appliedArcpFiltersKey(filters: ArcpAppliedFiltersSnapshot): string {
  return JSON.stringify({
    startDateStr: filters.startDateStr,
    endDateStr: filters.endDateStr,
    arcpDateFilterColumn: filters.arcpDateFilterColumn,
    branchParam: filters.branchParam,
    franchiseeParam: filters.franchiseeParam,
    callTypeParam: filters.callTypeParam,
  });
}

export function arcpFilterParams(filters: ArcpAppliedFiltersSnapshot): Record<string, string> {
  return {
    startDate: filters.startDateStr,
    endDate: filters.endDateStr,
    dateFilterColumn: filters.arcpDateFilterColumn,
    callType: filters.callTypeParam,
    ...(filters.branchParam ? { branch: filters.branchParam } : {}),
    ...(filters.franchiseeParam ? { franchisee: filters.franchiseeParam } : {}),
  };
}

export function arcpQueryOptsFromFilters(filters: ArcpAppliedFiltersSnapshot): ArcpClaimsQueryOpts {
  return {
    startDate: filters.startDateStr,
    endDate: filters.endDateStr,
    dateFilterColumn: filters.arcpDateFilterColumn,
    callType: filters.callTypeParam,
    branch: filters.branchParam || undefined,
    franchisee: filters.franchiseeParam || undefined,
  };
}

export function filtersFromLoadJobSnapshot(
  filters: Record<string, unknown>
): ArcpAppliedFiltersSnapshot | null {
  const startDateStr = String(filters.startDate ?? '');
  const endDateStr = String(filters.endDate ?? '');
  if (!startDateStr || !endDateStr) return null;

  const branchParam = String(filters.branch ?? '');
  const franchiseeParam = String(filters.franchisee ?? '');
  const callTypeParam = String(filters.callType ?? 'All');

  return {
    startDateStr,
    endDateStr,
    arcpDateFilterColumn:
      (filters.dateFilterColumn as ArcpDateFilterColumn) ?? ARCP_DEFAULT_DATE_FILTER_COLUMN,
    branchParam: branchParam === 'All' ? '' : branchParam,
    franchiseeParam: franchiseeParam === 'All' ? '' : franchiseeParam,
    callTypeParam,
    selectedBranch: branchParam && branchParam !== 'All' ? branchParam.split(',') : [],
    selectedFranchisee:
      franchiseeParam && franchiseeParam !== 'All' ? franchiseeParam.split(',') : [],
    selectedCallTypes:
      callTypeParam && callTypeParam !== 'All' ? callTypeParam.split(',') : [],
  };
}
