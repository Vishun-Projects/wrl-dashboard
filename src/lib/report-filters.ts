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
  { value: 'Cancelled', label: 'Cancelled' },
];

export const REGISTER_STATUS_PRESETS = {
  solved: ['Tech. Solve Call', 'Closed'],
  open: ['Open Unallocated', 'Assigned'],
  openUnallocated: ['Open Unallocated'],
  assigned: ['Assigned'],
  techSolved: ['Tech. Solve Call'],
  closed: ['Closed'],
  cancelled: ['Cancelled'],
} as const;

export function statusPresetMatches(selected: string[], preset: readonly string[]): boolean {
  if (selected.length !== preset.length) return false;
  const sortedSelected = [...selected].sort();
  const sortedPreset = [...preset].sort();
  return sortedSelected.every((value, index) => value === sortedPreset[index]);
}

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

/** Network/corpus bulk fetch always loads every call type; view filters apply client-side. */
export function resolveFetchCallTypesParam(): string {
  return 'All';
}

/** Call-type filter sent to summary API or server-paginated register fallback. */
export function resolveViewCallTypesParam(selectedCallTypes: string[]): string {
  if (selectedCallTypes.length > 0) return selectedCallTypes.join(',');
  return 'All';
}

export function parseCallTypesParam(callTypesParam?: string | null): string[] | null {
  if (!callTypesParam || callTypesParam === 'All' || callTypesParam === 'undefined' || callTypesParam === 'null') {
    return null;
  }
  const types = callTypesParam.split(',').map((s) => s.trim()).filter(Boolean);
  return types.length > 0 ? types : null;
}

export function normalizeCallTypeDisplay(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Client-side filter — mirrors appendCallTypeFilter (exact display label match). */
export function matchesCallTypeFilter(
  row: Record<string, unknown>,
  callTypesParam?: string | null
): boolean {
  const allowed = parseCallTypesParam(callTypesParam);
  if (!allowed) return true;
  const callType = normalizeCallTypeDisplay(row.calltype);
  if (!callType) return false;
  return allowed.some((t) => normalizeCallTypeDisplay(t) === callType);
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

export function isDefaultDateRange(range: ReportDateRange): boolean {
  if (range.label === 'Last 14 Days') return true;
  const def = defaultDateRange();
  return (
    range.start.toDateString() === def.start.toDateString() &&
    range.end.toDateString() === def.end.toDateString()
  );
}

export type ActiveFilterChipDescriptor = {
  id: string;
  label: string;
  removeKey:
    | 'search'
    | 'pincodeSearch'
    | 'dateRange'
    | 'dateFilterColumn'
    | 'selectedStatus'
    | 'selectedCallTypes'
    | 'priorityFilter'
    | 'portalFilter'
    | 'selectedBranch'
    | 'selectedFranchisee'
    | 'selectedState'
    | 'selectedCity'
    | 'selectedTechnician';
  removeValue?: string;
};

export type RegisterActiveFilterInput = RegisterViewFilterParts & {
  dateRange: ReportDateRange;
  dateFilterColumn: string;
  resolveLabel?: (field: ActiveFilterChipDescriptor['removeKey'], value: string) => string;
};

function chipLabelForValue(
  field: ActiveFilterChipDescriptor['removeKey'],
  value: string,
  resolveLabel?: RegisterActiveFilterInput['resolveLabel']
): string {
  if (resolveLabel) return resolveLabel(field, value);
  if (field === 'priorityFilter') {
    return value === 'major' ? 'Major' : value === 'minor' ? 'Minor' : value;
  }
  if (field === 'portalFilter') {
    const portal = REGISTER_PORTAL_OPTIONS.find((o) => o.value === value);
    return portal?.label || value;
  }
  return value;
}

function pushArrayChips(
  chips: ActiveFilterChipDescriptor[],
  field: ActiveFilterChipDescriptor['removeKey'],
  prefix: string,
  values: string[],
  resolveLabel?: RegisterActiveFilterInput['resolveLabel']
) {
  values.forEach((value) => {
    chips.push({
      id: `${field}:${value}`,
      label: `${prefix}: ${chipLabelForValue(field, value, resolveLabel)}`,
      removeKey: field,
      removeValue: value,
    });
  });
}

export function buildActiveFilterChips(input: RegisterActiveFilterInput): ActiveFilterChipDescriptor[] {
  const chips: ActiveFilterChipDescriptor[] = [];
  const { resolveLabel } = input;

  if ((input.search || '').trim()) {
    chips.push({
      id: 'search',
      label: `Search: ${input.search!.trim()}`,
      removeKey: 'search',
    });
  }

  if ((input.pincodeSearch || '').trim()) {
    chips.push({
      id: 'pincodeSearch',
      label: `Pincode: ${input.pincodeSearch!.trim()}`,
      removeKey: 'pincodeSearch',
    });
  }

  if (!isDefaultDateRange(input.dateRange)) {
    chips.push({
      id: 'dateRange',
      label: `Date: ${input.dateRange.label}`,
      removeKey: 'dateRange',
    });
  }

  if (input.dateFilterColumn === 'dsolvedatetime') {
    chips.push({
      id: 'dateFilterColumn',
      label: 'Date column: Solved Date',
      removeKey: 'dateFilterColumn',
    });
  }

  pushArrayChips(chips, 'selectedStatus', 'Status', input.selectedStatus, resolveLabel);
  pushArrayChips(chips, 'selectedCallTypes', 'Type', input.selectedCallTypes, resolveLabel);
  pushArrayChips(chips, 'priorityFilter', 'Priority', input.priorityFilter, resolveLabel);
  pushArrayChips(chips, 'portalFilter', 'Portal', input.portalFilter, resolveLabel);
  pushArrayChips(chips, 'selectedBranch', 'Branch', input.selectedBranch, resolveLabel);
  pushArrayChips(chips, 'selectedFranchisee', 'Franchisee', input.selectedFranchisee, resolveLabel);
  pushArrayChips(chips, 'selectedState', 'State', input.selectedState, resolveLabel);
  pushArrayChips(chips, 'selectedCity', 'City', input.selectedCity, resolveLabel);
  pushArrayChips(chips, 'selectedTechnician', 'Technician', input.selectedTechnician, resolveLabel);

  return chips;
}

export function countActiveFilters(input: RegisterActiveFilterInput): number {
  return buildActiveFilterChips(input).length;
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
