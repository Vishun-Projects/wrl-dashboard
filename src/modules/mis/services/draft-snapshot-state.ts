import {
  buildDraftFilterSnapshot,
  defaultAgingAsOfForRange,
  type ReportDateRange,
  type ReportFilterSnapshot,
} from '@/modules/mis/services/filters';
import type { RegisterDateFilterColumn } from '@/sql/trhcalls/query';

export type DraftSnapshotStateInput = {
  search: string;
  pincodeSearch: string;
  dateRange: ReportDateRange;
  agingAsOf: string;
  dateFilterColumn: RegisterDateFilterColumn;
  selectedOfficeIds: string[];
  selectedCallTypes: string[];
  selectedStatus: string[];
  priorityFilter: string[];
  portalFilter: string[];
  repairFilter: string[];
  selectedState: string[];
  selectedCity: string[];
  selectedRegion: string[];
  selectedAccount: string[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedTechnician: string[];
};

export function buildDraftSnapshotFromState(
  input: DraftSnapshotStateInput
): ReportFilterSnapshot {
  return buildDraftFilterSnapshot(input);
}

export function buildClearedDraftSnapshotFromState(
  input: DraftSnapshotStateInput,
  resetDateRange: ReportDateRange,
  resetDateFilterColumn: RegisterDateFilterColumn
): ReportFilterSnapshot {
  return buildDraftFilterSnapshot({
    ...input,
    search: '',
    pincodeSearch: '',
    dateRange: resetDateRange,
    agingAsOf: defaultAgingAsOfForRange(resetDateRange),
    dateFilterColumn: resetDateFilterColumn,
    selectedState: [],
    selectedCity: [],
    selectedRegion: [],
    selectedAccount: [],
    selectedBranch: [],
    selectedFranchisee: [],
    selectedTechnician: [],
    selectedCallTypes: [],
    selectedOfficeIds: [],
    selectedStatus: [],
    priorityFilter: [],
    portalFilter: [],
    repairFilter: [],
  });
}
