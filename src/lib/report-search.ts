import { enrichTrhcallBranchFranchisee } from '@/lib/trhcalls-query';
import { distributionDataCache, globalReportCache } from '@/lib/report-data-store';
import {
  filterCallsCSR,
  isAnyFilterActive,
  matchesCallTypeFilter,
  type RegisterViewFilterParts,
} from '@/lib/report-filters';
import { getPortalAuditCache, matchesPortalFilter } from '@/lib/report-portal-cache';
import { getCallIdentityKey } from '@/lib/report-sync';

export type { RegisterViewFilterParts };

export function normalizeTrnSearch(search: string): string {
  return search.trim().replace(/-/g, '');
}

/** Matches API getExactTrnQuery — e.g. 26E22919 */
export function isExactVtrnnoSearch(search: string): boolean {
  const cleaned = normalizeTrnSearch(search);
  return /^[A-Za-z0-9]{3}\d{2}\d+$/.test(cleaned);
}

export function isTrnLikeSearch(search: string): boolean {
  const cleaned = normalizeTrnSearch(search);
  if (!cleaned) return false;
  return isExactVtrnnoSearch(cleaned) || /^[A-Za-z0-9]{2,}\d+$/.test(cleaned);
}

/** Numeric internal call id (trhcalls.ncode). */
export function isNumericIdSearch(search: string): boolean {
  const cleaned = search.trim();
  return cleaned.length > 0 && /^\d+$/.test(cleaned);
}

/** Direct lookup by TRN, call centre id, internal id, or serial — cache-first, then API. */
export function isIdentifierLookupSearch(search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) return false;
  if (isTrnLikeSearch(trimmed) || isNumericIdSearch(trimmed)) return true;
  return trimmed.length >= 3 && !/\s/.test(trimmed);
}

export function callMatchesTrnSearch(row: Record<string, unknown>, search: string): boolean {
  return callMatchesIdentifierSearch(row, search);
}

export function callMatchesIdentifierSearch(row: Record<string, unknown>, search: string): boolean {
  const cleaned = normalizeTrnSearch(search).toUpperCase();
  const raw = search.trim();
  if (!cleaned && !raw) return false;

  const trnCandidates = [
    row.UniqueCallNo,
    row.vtrnno,
    row.vtransfercallno,
    row.vcclid,
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).replace(/-/g, '').toUpperCase());

  if (isExactVtrnnoSearch(search)) {
    if (trnCandidates.some((c) => c === cleaned)) return true;
  } else if (isTrnLikeSearch(search)) {
    if (trnCandidates.some((c) => c.includes(cleaned))) return true;
  } else {
    const needle = raw.toLowerCase();
    if (trnCandidates.some((c) => c.toLowerCase().includes(needle))) return true;
    const vcclid = row.vcclid != null ? String(row.vcclid).trim() : '';
    if (vcclid && vcclid.toLowerCase().includes(needle)) return true;
  }

  if (isNumericIdSearch(search)) {
    const id = row.id ?? row.ncode;
    if (id != null && String(id).trim() === raw) return true;
  }

  const serials = [row.callsvserialno, row.vserialno]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim());
  const serialNeedle = raw.toLowerCase();
  if (serials.some((s) => s.toLowerCase() === serialNeedle || s.toLowerCase().includes(serialNeedle))) {
    return true;
  }

  return false;
}

export function mapCachedRowToRegisterRow(row: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> =
    row.UniqueCallNo && row.PartyName !== undefined
      ? { ...row }
      : {
          ...row,
          UniqueCallNo: row.vtrnno ?? row.UniqueCallNo,
          vcclid: row.vcclid,
          serviceman: row.serviceman ?? row.technician_name,
          Pincode: row.Pincode ?? row.pincode,
          callsvserialno: row.callsvserialno ?? row.vserialno,
          PartyName: row.PartyName ?? row.party_name,
          Status: row.Status ?? row.callstatus,
          callstatus: row.callstatus,
          callsolved: row.callsolved ?? row.bsolved,
          id: row.id ?? row.ncode,
          nofficeid: row.nofficeid,
          office_name: row.office_name ?? row.officename,
          office_under: row.office_under,
          branch_office_name: row.branch_office_name,
          officeId: row.officeId ?? row.nofficeid,
          parentId: row.parentId ?? row.office_under,
          region: row.region,
          account: row.account,
          branch_headcount: row.branch_headcount,
          has_visit: row.has_visit,
          franchisee_name: row.franchisee_name,
          franchisee_code: row.franchisee_code,
          technician_office_name: row.technician_office_name,
          technician_office_id: row.technician_office_id,
          transfer_office_name: row.transfer_office_name,
          ntransfertooffice: row.ntransfertooffice,
        };

  return enrichTrhcallBranchFranchisee(base);
}

export function findCallsInMemoryCaches(search: string): Record<string, unknown>[] {
  if (!isIdentifierLookupSearch(search)) return [];

  const hits = new Map<string, Record<string, unknown>>();

  const scan = (rows: Record<string, unknown>[] | undefined) => {
    if (!rows?.length) return;
    for (const row of rows) {
      if (!callMatchesIdentifierSearch(row, search)) continue;
      const key = getCallIdentityKey(row);
      if (!key || hits.has(key)) continue;
      hits.set(key, mapCachedRowToRegisterRow(row));
    }
  };

  scan(distributionDataCache?.allCalls as Record<string, unknown>[] | undefined);
  scan(globalReportCache?.data as Record<string, unknown>[] | undefined);

  return Array.from(hits.values());
}

export async function findCallsInIndexedDb(
  search: string,
  getCallsFromDB: () => Promise<Record<string, unknown>[]>
): Promise<Record<string, unknown>[]> {
  if (!isIdentifierLookupSearch(search)) return [];

  try {
    const rows = await getCallsFromDB();
    return rows
      .filter((row) => callMatchesIdentifierSearch(row, search))
      .map((row) => mapCachedRowToRegisterRow(row));
  } catch {
    return [];
  }
}

export function callMatchesRegisterSearch(
  row: Record<string, unknown>,
  search: string,
  pincodeSearch = ''
): boolean {
  if (pincodeSearch.trim()) {
    const pin = String(row.Pincode ?? row.pincode ?? '');
    if (!pin.toLowerCase().includes(pincodeSearch.trim().toLowerCase())) return false;
  }
  if (!search.trim()) return true;

  if (isIdentifierLookupSearch(search)) {
    return callMatchesIdentifierSearch(row, search);
  }

  const needle = search.trim().toLowerCase();
  const fields = [
    row.UniqueCallNo,
    row.vtrnno,
    row.vtransfercallno,
    row.vcclid,
    row.PartyName,
    row.itemname,
    row.callsvserialno,
    row.Pincode,
    row.pincode,
  ];
  return fields.some((v) => v != null && String(v).toLowerCase().includes(needle));
}

export function registerRowMatchesViewFilters(
  row: Record<string, unknown>,
  parts: RegisterViewFilterParts
): boolean {
  if (!isAnyFilterActive(parts)) return true;

  if ((parts.search || '').trim() || (parts.pincodeSearch || '').trim()) {
    if (!callMatchesRegisterSearch(row, parts.search || '', parts.pincodeSearch || '')) {
      return false;
    }
  }

  const csrMatches = filterCallsCSR([row as any], {
    state: parts.selectedState,
    city: parts.selectedCity,
    selectedBranch: parts.selectedBranch,
    selectedFranchisee: parts.selectedFranchisee,
    selectedOfficeIds: parts.selectedOfficeIds,
    technician: parts.selectedTechnician,
    pincodeSearch: parts.pincodeSearch || '',
  });
  if (csrMatches.length === 0) return false;

  if (parts.selectedCallTypes.length > 0) {
    if (!matchesCallTypeFilter(row, parts.selectedCallTypes.join(','))) return false;
  }

  if (parts.selectedOfficeIds.length > 0) {
    const officeId = String(row.nofficeid || '');
    if (!parts.selectedOfficeIds.includes(officeId)) return false;
  }

  if (!matchesStatusFilter(row, parts.selectedStatus)) return false;
  if (!matchesPriorityFilter(row, parts.priorityFilter)) return false;
  if (!matchesPortalFilter(row, parts.portalFilter, getPortalAuditCache())) return false;

  return true;
}

/** Filter an in-memory call list using the same rules as the register corpus path. */
export function filterViewCalls(
  calls: Record<string, unknown>[],
  parts: RegisterViewFilterParts
): Record<string, unknown>[] {
  if (!isAnyFilterActive(parts)) return calls;
  return calls.filter((row) => registerRowMatchesViewFilters(row, parts));
}

export type RegisterSummary = {
  total: number;
  cancelled: number;
  open: number;
  openUnallocated: number;
  assigned: number;
  solved: number;
  techSolved: number;
  closed: number;
};

export type RegisterSummaryBucket =
  | 'openUnallocated'
  | 'assigned'
  | 'techSolved'
  | 'closed'
  | 'cancelled'
  | 'transferred';

export function isRegisterRowTransferred(row: Record<string, unknown>): boolean {
  return (
    Boolean(row.vtransfercallno && String(row.vtransfercallno).trim() !== '') ||
    String(row.ncancelreason) === '2'
  );
}

export function classifyRegisterRowStatus(row: Record<string, unknown>): RegisterSummaryBucket {
  if (isRegisterRowTransferred(row)) return 'transferred';

  const isClosed =
    row.Status === 'Closed' ||
    row.callstatus === 'Solved' ||
    String(row.callsolved).toLowerCase() === 'true' ||
    String(row.callsolved) === '1';
  const isCancelled = row.callstatus === 'Cancel' || row.Status === 'Cancel';
  const isTechSolved =
    (row.bfastclose === 'True' ||
      row.bfastclose === '1' ||
      row.bfastclose === 1 ||
      row.bfastclose === true) &&
    !isClosed &&
    !isCancelled;
  const isAssigned =
    Boolean(row.nengineer && String(row.nengineer) !== '0') &&
    !isClosed &&
    !isCancelled &&
    !isTechSolved;

  if (isClosed) return 'closed';
  if (isCancelled) return 'cancelled';
  if (isTechSolved) return 'techSolved';
  if (isAssigned) return 'assigned';
  return 'openUnallocated';
}

const STATUS_LABEL_BY_BUCKET: Record<RegisterSummaryBucket, string | null> = {
  openUnallocated: 'Open Unallocated',
  assigned: 'Assigned',
  techSolved: 'Tech. Solve Call',
  closed: 'Closed',
  cancelled: 'Cancelled',
  transferred: null,
};

function matchesStatusFilter(row: Record<string, unknown>, selectedStatus: string[]): boolean {
  if (selectedStatus.length === 0) return true;
  const bucket = classifyRegisterRowStatus(row);
  if (bucket === 'transferred') return false;
  const label = STATUS_LABEL_BY_BUCKET[bucket];
  return label ? selectedStatus.includes(label) : false;
}

/** True when any linked repair fault is marked major (matches register SQL EXISTS). */
export function isMajorRepairRow(row: Record<string, unknown>): boolean {
  const v = row.is_major_repair;
  if (v == null || v === '') return false;
  const normalized = String(v).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function matchesPriorityFilter(
  row: Record<string, unknown>,
  priorityFilter: string[]
): boolean {
  if (priorityFilter.length === 0) return true;
  const isMajor = isMajorRepairRow(row);
  const wantsMajor = priorityFilter.includes('major');
  const wantsMinor = priorityFilter.includes('minor');
  if (wantsMajor && wantsMinor) return true;
  if (wantsMajor) return isMajor;
  if (wantsMinor) return !isMajor;
  return true;
}

export function emptyRegisterSummary(): RegisterSummary {
  return {
    total: 0,
    cancelled: 0,
    open: 0,
    openUnallocated: 0,
    assigned: 0,
    solved: 0,
    techSolved: 0,
    closed: 0,
  };
}

export function normalizeRegisterSummary(
  summary: Partial<RegisterSummary> | null | undefined
): RegisterSummary | null {
  if (!summary) return null;
  return {
    total: summary.total ?? 0,
    cancelled: summary.cancelled ?? 0,
    open: summary.open ?? 0,
    openUnallocated: summary.openUnallocated ?? 0,
    assigned: summary.assigned ?? 0,
    solved: summary.solved ?? 0,
    techSolved: summary.techSolved ?? 0,
    closed: summary.closed ?? 0,
  };
}

export function summarizeRegisterRows(rows: Record<string, unknown>[]): RegisterSummary {
  const summary = emptyRegisterSummary();

  for (const row of rows) {
    const bucket = classifyRegisterRowStatus(row);
    if (bucket === 'transferred') continue;

    summary.total++;
    if (bucket === 'closed') {
      summary.closed++;
      summary.solved++;
    } else if (bucket === 'techSolved') {
      summary.techSolved++;
      summary.solved++;
    } else if (bucket === 'assigned') {
      summary.assigned++;
      summary.open++;
    } else if (bucket === 'openUnallocated') {
      summary.openUnallocated++;
      summary.open++;
    } else if (bucket === 'cancelled') {
      summary.cancelled++;
    }
  }

  return summary;
}
