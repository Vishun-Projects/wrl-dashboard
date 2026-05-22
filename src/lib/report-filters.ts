import type { RegisterMultiSelectOption } from '@/components/RegisterMultiSelect';
import { looksLikeBranchOffice } from '@/lib/trhcalls-query';

export type ReportDateRange = { start: Date; end: Date; label: string };

export function migrateStringFilter(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (!val || val === 'All' || val === 'all') return [];
  return [String(val)];
}

export function joinFilterParam(values: string[]): string | undefined {
  if (!values.length) return undefined;
  return values.join(',');
}

export function serializeFilterKey(values: string[]): string {
  return values.length ? [...values].sort().join(',') : 'All';
}

export function filtersEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return serializeFilterKey(a || []) === serializeFilterKey(b || []);
}

export function matchesFilterSelection(value: string, selected: string[] | string | undefined): boolean {
  if (Array.isArray(selected)) {
    if (selected.length === 0) return true;
    return selected.includes(value);
  }
  if (!selected || selected === 'All') return true;
  return value === selected;
}

export const REGISTER_STATUS_OPTIONS: RegisterMultiSelectOption[] = [
  { value: 'Open Unallocated', label: 'Open Unallocated' },
  { value: 'Assigned', label: 'Assigned' },
  { value: 'Tech. Solve Call', label: 'Tech. Solve Call' },
  { value: 'Closed', label: 'Closed' },
];

export const REGISTER_PRIORITY_OPTIONS: RegisterMultiSelectOption[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
];

export const REGISTER_PORTAL_OPTIONS: RegisterMultiSelectOption[] = [
  { value: 'unseen', label: 'Unseen' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'On hold' },
  { value: 'comments', label: 'Comments' },
];

export function buildSummaryQueryKey(parts: {
  officeIdsParam: string;
  callTypesParam: string;
  startDateStr: string;
  endDateStr: string;
  agingAsOf: string;
}) {
  return JSON.stringify(parts);
}

export function buildRegisterListQueryKey(parts: {
  officeIdsParam: string;
  callTypesParam: string;
  searchForUrl: string;
  pincodeForUrl: string;
  startDateStr: string;
  endDateStr: string;
  dateFilterColumn: string;
  selectedState: string[];
  selectedCity: string[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedTechnician: string[];
  selectedStatus: string[];
  priorityFilter: string[];
  portalFilter: string[];
  agingAsOf: string;
}) {
  return JSON.stringify({
    ...parts,
    selectedState: serializeFilterKey(parts.selectedState),
    selectedCity: serializeFilterKey(parts.selectedCity),
    selectedBranch: serializeFilterKey(parts.selectedBranch),
    selectedFranchisee: serializeFilterKey(parts.selectedFranchisee),
    selectedTechnician: serializeFilterKey(parts.selectedTechnician),
    selectedStatus: serializeFilterKey(parts.selectedStatus),
    priorityFilter: serializeFilterKey(parts.priorityFilter),
    portalFilter: serializeFilterKey(parts.portalFilter),
  });
}

export function buildDistributionCacheKey(startDate: string, endDate: string, callTypes: string[]): string {
  return `${startDate}|${endDate}|${serializeFilterKey(callTypes)}`;
}

/** Default call type for Summary / Key Account MIS when the user has not changed the filter. */
export const SUMMARY_DEFAULT_CALL_TYPE = 'BREAKDOWN';

export function findBreakdownCallType(callTypes: string[]): string | null {
  if (!callTypes.length) return null;
  const exact = callTypes.find((t) => t.trim().toUpperCase() === SUMMARY_DEFAULT_CALL_TYPE);
  if (exact) return exact;
  return callTypes.find((t) => /breakdown/i.test(t)) ?? null;
}

export function resolveCallTypesParam(
  selectedCallTypes: string[],
  opts: {
    activeTab: 'register' | 'summary' | 'accounts';
    callTypesFilterTouched: boolean;
    availableCallTypes: string[];
  }
): string {
  if (selectedCallTypes.length > 0) return selectedCallTypes.join(',');
  if (
    (opts.activeTab === 'summary' || opts.activeTab === 'accounts') &&
    !opts.callTypesFilterTouched
  ) {
    return findBreakdownCallType(opts.availableCallTypes) ?? SUMMARY_DEFAULT_CALL_TYPE;
  }
  return 'All';
}

export type FilterCallsCriteria = {
  state?: string[] | string;
  city?: string[] | string;
  branch?: string[] | string;
  franchisee?: string[] | string;
  technician?: string[] | string;
  selectedOfficeIds?: string[];
  selectedBranch?: string[];
  selectedFranchisee?: string[];
  pincodeSearch?: string;
};

export function buildMainBranchOptions(
  offices: Array<{ ncode: number | string; vcompanyname: string }>,
  branchesList: Array<{ ncode: string; vcompanyname: string }> = []
): RegisterMultiSelectOption[] {
  const options = new Map<string, RegisterMultiSelectOption>();

  offices
    .filter((office) => looksLikeBranchOffice(String(office.vcompanyname || '')))
    .forEach((office) => {
      const value = String(office.ncode);
      options.set(value, { value, label: office.vcompanyname });
    });

  branchesList.forEach((branch) => {
    const value = String(branch.ncode);
    options.set(value, { value, label: branch.vcompanyname });
  });

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function buildFranchiseeOptions(
  offices: Array<{ ncode: number | string; vcompanyname: string; nunder?: number | string }>,
  selectedBranch: string[],
  franchiseesList: Array<{ ncode: string; vcompanyname: string }> = []
): RegisterMultiSelectOption[] {
  const options = new Map<string, RegisterMultiSelectOption>();

  offices
    .filter((office) => !looksLikeBranchOffice(String(office.vcompanyname || '')))
    .filter((office) => {
      if (selectedBranch.length === 0) return true;
      return selectedBranch.includes(String(office.nunder || ''));
    })
    .forEach((office) => {
      const value = String(office.ncode);
      options.set(value, { value, label: office.vcompanyname });
    });

  franchiseesList.forEach((franchisee) => {
    const value = String(franchisee.ncode);
    options.set(value, { value, label: franchisee.vcompanyname });
  });

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function resolveSummaryOfficeIdsParam(
  offices: Array<{ ncode: number | string; nunder?: number | string }>,
  selectedBranch: string[],
  selectedFranchisee: string[]
): string {
  if (selectedFranchisee.length > 0) return selectedFranchisee.join(',');
  if (selectedBranch.length === 0) return 'All';

  const ids = new Set<string>();
  selectedBranch.forEach((branchId) => {
    ids.add(branchId);
    offices
      .filter((office) => String(office.nunder || '') === branchId)
      .forEach((office) => ids.add(String(office.ncode)));
  });

  return Array.from(ids).join(',');
}

export function filterCallsCSR(calls: any[], criteria: FilterCallsCriteria, exclude?: string) {
  return calls.filter((c) => {
    if (exclude !== 'state' && !matchesFilterSelection(c.state || '', criteria.state)) return false;
    if (exclude !== 'city' && !matchesFilterSelection(c.city || c.ncode || '', criteria.city)) return false;

    if (exclude !== 'branch') {
      const branchSelection = criteria.selectedBranch?.length
        ? criteria.selectedBranch
        : criteria.selectedOfficeIds;
      if (branchSelection && branchSelection.length > 0) {
        const branchCode = String(c.resolved_branch_code || c.nofficeid || '');
        if (!branchSelection.includes(branchCode)) return false;
      } else if (!matchesFilterSelection(String(c.resolved_branch_code || c.nofficeid || ''), criteria.branch)) {
        return false;
      }
    }

    if (exclude !== 'franchisee') {
      const franchiseeSelection = criteria.selectedFranchisee?.length
        ? criteria.selectedFranchisee
        : undefined;
      const cFranCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
      const officeId = String(c.nofficeid || '');
      if (franchiseeSelection && franchiseeSelection.length > 0) {
        const matchesFranchisee =
          franchiseeSelection.includes(cFranCode) ||
          franchiseeSelection.includes(officeId);
        if (!matchesFranchisee) return false;
      } else if (
        !matchesFilterSelection(cFranCode, criteria.franchisee) &&
        !matchesFilterSelection(officeId, criteria.franchisee)
      ) {
        return false;
      }
    }

    if (exclude !== 'technician' && !matchesFilterSelection(String(c.nengineer || ''), criteria.technician)) {
      return false;
    }

    if (exclude !== 'pincodeSearch' && criteria.pincodeSearch && criteria.pincodeSearch.trim() !== '') {
      const pin = c.pincode || c.Pincode || '';
      if (!String(pin).toLowerCase().includes(criteria.pincodeSearch.toLowerCase())) return false;
    }

    return true;
  });
}

export function defaultDateRange(): ReportDateRange {
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { start, end, label: 'Last 14 Days' };
}

export type RegisterViewFilterParts = {
  search?: string;
  pincodeSearch?: string;
  selectedState: string[];
  selectedCity: string[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedTechnician: string[];
  selectedCallTypes: string[];
  selectedOfficeIds: string[];
  selectedStatus: string[];
  priorityFilter: string[];
  portalFilter: string[];
};

export function isAnyFilterActive(parts: RegisterViewFilterParts): boolean {
  return (
    (parts.search || '') !== '' ||
    (parts.pincodeSearch || '') !== '' ||
    parts.selectedState.length > 0 ||
    parts.selectedCity.length > 0 ||
    parts.selectedBranch.length > 0 ||
    parts.selectedFranchisee.length > 0 ||
    parts.selectedTechnician.length > 0 ||
    parts.selectedCallTypes.length > 0 ||
    parts.selectedOfficeIds.length > 0 ||
    parts.selectedStatus.length > 0 ||
    parts.priorityFilter.length > 0 ||
    parts.portalFilter.length > 0
  );
}
