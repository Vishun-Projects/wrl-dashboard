import type { ArcpDateFilterColumn } from './query';

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
    arcpDateFilterColumn: (filters.dateFilterColumn as ArcpDateFilterColumn) ?? 'dcalllogdatetime',
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
