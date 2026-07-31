import {
  buildRegisterExportQuery,
  buildRegisterListQueryKey,
  type RegisterExportQueryParts,
  type RegisterViewFilterParts,
} from '@/modules/mis/services/filters';

type RegisterViewFilterSelection = Pick<
  RegisterViewFilterParts,
  | 'search'
  | 'pincodeSearch'
  | 'selectedState'
  | 'selectedCity'
  | 'selectedRegion'
  | 'selectedAccount'
  | 'selectedBranch'
  | 'selectedFranchisee'
  | 'selectedTechnician'
  | 'selectedStatus'
  | 'priorityFilter'
  | 'portalFilter'
  | 'repairFilter'
>;

export type RegisterListQueryKeyInput = {
  officeIdsParam: string;
  callTypesParam: string;
  startDateStr: string;
  endDateStr: string;
  dateFilterColumn: string;
  agingAsOf: string;
  pageLimit: number;
  viewFilters: RegisterViewFilterSelection;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

export function buildRegisterListQueryKeyFromViewFilters(input: RegisterListQueryKeyInput): string {
  return buildRegisterListQueryKey({
    officeIdsParam: input.officeIdsParam,
    callTypesParam: input.callTypesParam,
    searchForUrl: input.viewFilters.search || '',
    pincodeForUrl: input.viewFilters.pincodeSearch || '',
    startDateStr: input.startDateStr,
    endDateStr: input.endDateStr,
    dateFilterColumn: input.dateFilterColumn,
    selectedState: input.viewFilters.selectedState,
    selectedCity: input.viewFilters.selectedCity,
    selectedRegion: input.viewFilters.selectedRegion,
    selectedAccount: input.viewFilters.selectedAccount,
    selectedBranch: input.viewFilters.selectedBranch,
    selectedFranchisee: input.viewFilters.selectedFranchisee,
    selectedTechnician: input.viewFilters.selectedTechnician,
    selectedStatus: input.viewFilters.selectedStatus,
    priorityFilter: input.viewFilters.priorityFilter,
    portalFilter: input.viewFilters.portalFilter,
    repairFilter: input.viewFilters.repairFilter,
    agingAsOf: input.agingAsOf,
    pageLimit: input.pageLimit,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
  });
}

export type RegisterExportQueryFromViewFiltersInput = {
  officeId: string;
  callType: string;
  startDate: string;
  endDate: string;
  dateFilterColumn: string;
  viewFilters: RegisterViewFilterSelection;
};

export function buildRegisterExportQueryFromViewFilters(
  input: RegisterExportQueryFromViewFiltersInput
): ReturnType<typeof buildRegisterExportQuery> {
  const parts: RegisterExportQueryParts = {
    officeId: input.officeId,
    callType: input.callType,
    startDate: input.startDate,
    endDate: input.endDate,
    dateFilterColumn: input.dateFilterColumn,
    search: input.viewFilters.search || undefined,
    pincode: input.viewFilters.pincodeSearch || undefined,
    selectedState: input.viewFilters.selectedState,
    selectedCity: input.viewFilters.selectedCity,
    selectedRegion: input.viewFilters.selectedRegion,
    selectedAccount: input.viewFilters.selectedAccount,
    selectedBranch: input.viewFilters.selectedBranch,
    selectedFranchisee: input.viewFilters.selectedFranchisee,
    selectedTechnician: input.viewFilters.selectedTechnician,
    selectedStatus: input.viewFilters.selectedStatus,
    priorityFilter: input.viewFilters.priorityFilter,
    portalFilter: input.viewFilters.portalFilter,
    repairFilter: input.viewFilters.repairFilter,
  };
  return buildRegisterExportQuery(parts);
}
