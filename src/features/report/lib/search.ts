import { distributionDataCache, globalReportCache } from '@/features/report/lib/data-store';
import {
  filterCallsCSR,
  isAnyFilterActive,
  matchesCallTypeFilter,
  type RegisterViewFilterParts,
} from '@/features/report/lib/filters';
import { getPortalAuditCache, matchesPortalFilter } from '@/features/report/lib/portal-cache';
import { getCallIdentityKey } from '@/features/report/lib/sync';

import { mapCachedRowToRegisterRow } from '@/lib/register-sql/map-cached-row';
import {
  classifyRegisterRowStatus,
  isMajorRepairRow,
  type RegisterSummaryBucket,
} from '@/lib/call-status/register-row';

export type { RegisterViewFilterParts };
export { mapCachedRowToRegisterRow } from '@/lib/register-sql/map-cached-row';
export { isRealCancelReasonCode } from '@/lib/call-status/cancel';
export {
  classifyRegisterRowStatus,
  isMajorRepairRow,
  isRegisterRowCancelled,
  isRegisterRowTransferred,
  truthyCrmFlag,
  type RegisterSummaryBucket,
} from '@/lib/call-status/register-row';


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
    row.region,
    row.account,
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

  const csrMatches = filterCallsCSR([row], {
    state: parts.selectedState,
    city: parts.selectedCity,
    region: parts.selectedRegion,
    account: parts.selectedAccount,
    selectedBranch: parts.selectedBranch,
    selectedFranchisee: parts.selectedFranchisee,
    selectedOfficeIds: parts.selectedOfficeIds,
    technician: parts.selectedTechnician,
    technicianRoster: parts.technicianRoster,
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
  // repairFilter is server-only (rows lack repair ncodes). Register skips corpus when set.

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

/** Closed + tech-solve rows count toward MIS "total solved" from CRM. */
export function isRegisterRowSolvedForMis(row: Record<string, unknown>): boolean {
  const bucket = classifyRegisterRowStatus(row);
  return bucket === 'closed' || bucket === 'techSolved';
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
