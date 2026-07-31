import { distributionDataCache, globalReportCache, callCorpusStore } from '@/modules/mis';
import { getCorpusCallsArray } from '@/modules/mis';
import type { RegisterViewFilterParts } from '@/modules/mis';
import {
  classifyRegisterRowStatus,
  mapCachedRowToRegisterRow,
  registerRowMatchesViewFilters,
} from '@/modules/mis';
import {
  getCallIdentityKey,
  getIndexedRegisterRowsWithSerial,
} from '@/modules/mis';
import {
  EMPTY_SERIAL_AUDIT_REPAIR_COUNTS,
  mapRepairCountsFromApiRow,
  type SerialAuditRepairCounts,
} from '@/sql/repair/options';
import { normalizeSerial } from '@/lib/serial/normalize';
export { normalizeSerial } from '@/lib/serial/normalize';
/** Minimum calls on same serial to count as a repeat offender. */
export const MIN_REPEAT_COMPLAINTS = 2;

/** Non-cancelled call count for list display when cancelled are excluded. */
export function activeComplaintCount(row: SerialAuditRow): number {
  return Math.max(0, row.complaintCount - row.cancelledCount);
}

/** Adjust serial rows for the include-cancelled view toggle (no refetch). */
export function effectiveComplaintCountForView(
  row: SerialAuditRow,
  includeCancelled: boolean
): number {
  return includeCancelled ? row.complaintCount : activeComplaintCount(row);
}

/** Drop serials with no calls left after the active filter + include-cancelled toggle. */
export function excludeSerialAuditRowsWithoutFilteredCalls(
  rows: SerialAuditRow[],
  includeCancelled: boolean,
  minRepeats: number = MIN_REPEAT_COMPLAINTS
): SerialAuditRow[] {
  return rows
    .map((row) =>
      includeCancelled
        ? row
        : {
            ...row,
            complaintCount: activeComplaintCount(row),
          }
    )
    .filter(
      (row) =>
        effectiveComplaintCountForView(row, includeCancelled) > 0 &&
        row.complaintCount >= minRepeats
    );
}

export function deriveSerialAuditRowsForView(
  rows: SerialAuditRow[],
  includeCancelled: boolean,
  minRepeats: number = MIN_REPEAT_COMPLAINTS
): SerialAuditRow[] {
  return excludeSerialAuditRowsWithoutFilteredCalls(rows, includeCancelled, minRepeats);
}

export function filterSerialAuditCallsForView(
  calls: SerialAuditCallDetail[],
  includeCancelled: boolean
): SerialAuditCallDetail[] {
  if (includeCancelled) return calls;
  return calls.filter((c) => c.statusTone !== 'cancelled');
}

/** Status buckets aligned with aggregateComplaintsBySerial / list SQL. */
export function summarizeSerialAuditCalls(calls: SerialAuditCallDetail[]): {
  complaintCount: number;
  openCount: number;
  solvedCount: number;
  cancelledCount: number;
} {
  let openCount = 0;
  let solvedCount = 0;
  let cancelledCount = 0;
  for (const call of calls) {
    if (call.statusTone === 'cancelled') cancelledCount++;
    else if (call.statusTone === 'closed' || call.statusTone === 'techSolved') solvedCount++;
    else openCount++;
  }
  return {
    complaintCount: calls.length,
    openCount,
    solvedCount,
    cancelledCount,
  };
}

export function serialAuditMetaFromCalls(calls: SerialAuditCallDetail[]): {
  uniqueBranches: string[];
  uniqueCustomers: string[];
  lastComplaintDate: string | null;
} {
  const branches = new Set<string>();
  const customers = new Set<string>();
  const dates: string[] = [];
  for (const call of calls) {
    const branch = call.branch.trim();
    if (branch && branch !== '—') branches.add(branch);
    const customer = call.customer.trim();
    if (customer && customer !== '—') customers.add(customer);
    if (call.callDate) dates.push(call.callDate);
  }
  dates.sort((a, b) => b.localeCompare(a));
  return {
    uniqueBranches: [...branches],
    uniqueCustomers: [...customers],
    lastComplaintDate: dates[0] ?? null,
  };
}

/** Prefer per-serial detail load, then involvement batch (same repair filter as list). */
export function resolveSerialAuditWindowCalls(
  serialKey: string,
  windowCallsBySerial: Map<string, SerialAuditCallDetail[]>,
  analysisCallsBySerial: Map<string, SerialAuditCallDetail[]>
): SerialAuditCallDetail[] {
  if (windowCallsBySerial.has(serialKey)) {
    return windowCallsBySerial.get(serialKey) ?? [];
  }
  if (analysisCallsBySerial.has(serialKey)) {
    return analysisCallsBySerial.get(serialKey) ?? [];
  }
  return [];
}

export function serialAuditCallsLoadedForKey(
  serialKey: string,
  windowCallsBySerial: Map<string, SerialAuditCallDetail[]>,
  analysisCallsBySerial: Map<string, SerialAuditCallDetail[]>
): boolean {
  return windowCallsBySerial.has(serialKey) || analysisCallsBySerial.has(serialKey);
}

/** Calls shown in the main row counts and expanded table (same rules). */
export function getSerialAuditDisplayCalls(
  rawCalls: SerialAuditCallDetail[],
  includeCancelled: boolean,
  involvementPair: { technician: string; franchisee: string } | null
): SerialAuditCallDetail[] {
  if (!involvementPair) {
    return filterSerialAuditCallsForView(rawCalls, includeCancelled);
  }
  return filterCallsForInvolvementPair(
    rawCalls,
    includeCancelled,
    involvementPair.technician,
    involvementPair.franchisee
  );
}

/** False when calls were loaded for this serial but none remain after display filters. */
export function serialAuditRowHasCallsInWindow(
  row: SerialAuditRow,
  windowCallsBySerial: Map<string, SerialAuditCallDetail[]>,
  includeCancelled: boolean,
  opts?: {
    analysisCallsBySerial?: Map<string, SerialAuditCallDetail[]>;
    involvementPair?: { technician: string; franchisee: string } | null;
  }
): boolean {
  const serialKey = serialRowMatchKey(row);
  const analysis = opts?.analysisCallsBySerial ?? new Map();
  if (!serialAuditCallsLoadedForKey(serialKey, windowCallsBySerial, analysis)) {
    return true;
  }
  const raw = resolveSerialAuditWindowCalls(serialKey, windowCallsBySerial, analysis);
  return (
    getSerialAuditDisplayCalls(raw, includeCancelled, opts?.involvementPair ?? null).length > 0
  );
}

export type SerialAuditCallDetail = {
  callId: string;
  trn: string;
  callCentreId: string;
  callDate: string | null;
  callType: string;
  customer: string;
  branch: string;
  franchisee: string;
  pincode: string;
  product: string;
  complaint: string;
  repairDone: string;
  statusLabel: string;
  statusTone: 'open' | 'assigned' | 'techSolved' | 'closed' | 'cancelled' | 'transferred';
  technician: string;
  solvedDate: string | null;
  remarks: string;
};

export type { SerialAuditRepairCounts };

export type SerialAuditRow = {
  serial: string;
  complaintCount: number;
  openCount: number;
  solvedCount: number;
  cancelledCount: number;
  repairCounts: SerialAuditRepairCounts;
  uniqueTrns: string[];
  uniqueCustomers: string[];
  uniqueBranches: string[];
  lastComplaintDate: string | null;
  sampleTrns: string[];
  riskFlag: boolean;
  isUnknownSerial: boolean;
};


function normalizeRepairName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const REPAIR_NAME_TO_COUNT_KEY: Record<string, keyof SerialAuditRepairCounts> = {
  [normalizeRepairName('Motor Replaced')]: 'motorReplaced',
  [normalizeRepairName('Compressor Replaced')]: 'compressorReplaced',
  [normalizeRepairName('Gas Charging Done')]: 'gasCharging',
};

/** Parse semicolon-separated repair_done on a single call row. */
export function parseRepairCountsFromRepairDone(repairDone: string): SerialAuditRepairCounts {
  const counts = { ...EMPTY_SERIAL_AUDIT_REPAIR_COUNTS };
  const raw = repairDone.trim();
  if (!raw || raw === '—' || raw === '-') return counts;
  const seen = new Set<string>();
  for (const part of raw.split(';')) {
    const key = normalizeRepairName(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const field = REPAIR_NAME_TO_COUNT_KEY[key];
    if (field) counts[field]++;
  }
  return counts;
}

/** Count visit repair types from semicolon-separated repair_done on call rows. */
export function countRepairsFromCallRows(
  rows: Record<string, unknown>[]
): SerialAuditRepairCounts {
  const counts = { ...EMPTY_SERIAL_AUDIT_REPAIR_COUNTS };
  for (const row of rows) {
    const raw = String(row.repair_done ?? '').trim();
    if (!raw || raw === '—' || raw === '-') continue;
    const seen = new Set<string>();
    for (const part of raw.split(';')) {
      const key = normalizeRepairName(part);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const field = REPAIR_NAME_TO_COUNT_KEY[key];
      if (field) counts[field]++;
    }
  }
  return counts;
}

function rowStatusBucket(row: Record<string, unknown>): 'open' | 'solved' | 'cancelled' {
  const bucket = classifyRegisterRowStatus(row);
  if (bucket === 'transferred') return 'open';
  if (bucket === 'cancelled') return 'cancelled';
  if (bucket === 'closed' || bucket === 'techSolved') return 'solved';
  return 'open';
}

function mergeRegisterRows(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const current = merged[key];
    if (current === null || current === undefined || String(current).trim() === '') {
      merged[key] = value;
    }
  }
  return mapCachedRowToRegisterRow(merged);
}

export function normalizeComplaintKey(complaint: string): string {
  return complaint.trim().toLowerCase().replace(/\s+/g, ' ');
}



export function filterCallsByRepairCallIds(
  calls: Record<string, unknown>[],
  callIdsWithRepair: Set<string> | null
): Record<string, unknown>[] {
  if (!callIdsWithRepair || callIdsWithRepair.size === 0) return calls;
  return calls.filter((row) => {
    const id = String(row.ncode ?? row.id ?? '').trim();
    return id && callIdsWithRepair.has(id);
  });
}

export function getRepeatedComplaintKeys(
  calls: SerialAuditCallDetail[],
  opts?: { excludeCancelled?: boolean }
): Set<string> {
  const pool = opts?.excludeCancelled
    ? calls.filter((c) => c.statusTone !== 'cancelled')
    : calls;
  const counts = new Map<string, number>();
  for (const call of pool) {
    const key = normalizeComplaintKey(call.complaint);
    if (!key || key === '—' || key === '-') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  );
}

/**
 * Flag serials with genuine repeat risk: same complaint recurring on non-cancelled calls.
 * Cancel-and-re-raise churn (mostly cancelled duplicates) is excluded.
 */
export function evaluateSerialRiskFlag(
  calls: SerialAuditCallDetail[],
  riskThreshold = 3
): boolean {
  if (calls.length === 0) return false;

  const nonCancelled = calls.filter((c) => c.statusTone !== 'cancelled');
  if (nonCancelled.length < riskThreshold) return false;

  const repeatedAmongActive = getRepeatedComplaintKeys(nonCancelled);
  if (repeatedAmongActive.size > 0) {
    const flagWorthyCount = nonCancelled.filter((c) => {
      const key = normalizeComplaintKey(c.complaint);
      if (!key || key === '—' || key === '-') return false;
      return repeatedAmongActive.has(key);
    }).length;
    return flagWorthyCount >= riskThreshold;
  }

  return nonCancelled.length >= riskThreshold;
}

function getCustomerLabel(row: Record<string, unknown>): string {
  return String(row.PartyName ?? row.party_name ?? '').trim();
}

function getCallDate(row: Record<string, unknown>): string | null {
  return formatAuditDate(row.callsdtrndate ?? row.dtrndate);
}

function getTrn(row: Record<string, unknown>): string {
  const v = row.UniqueCallNo ?? row.vtrnno;
  return v != null ? String(v) : '';
}

function getBranchLabel(row: Record<string, unknown>): string {
  return String(
    row.branch_office_name ?? row.officename ?? row.office_name ?? ''
  ).trim();
}

function formatAuditDate(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw);
  if (s.includes('T')) return s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toISOString().slice(0, 10);
}

function getStatusMeta(row: Record<string, unknown>): {
  label: string;
  tone: SerialAuditCallDetail['statusTone'];
} {
  const bucket = classifyRegisterRowStatus(row);
  switch (bucket) {
    case 'closed':
      return { label: 'Closed', tone: 'closed' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'cancelled' };
    case 'techSolved':
      return { label: 'Tech. Solve', tone: 'techSolved' };
    case 'assigned':
      return { label: 'Assigned', tone: 'assigned' };
    case 'transferred':
      return { label: 'Transferred', tone: 'transferred' };
    default:
      return { label: 'Open', tone: 'open' };
  }
}

export function mapRowToSerialAuditCallDetail(row: Record<string, unknown>): SerialAuditCallDetail {
  const { label, tone } = getStatusMeta(row);
  const remarks =
    String(row.vsolveremarks || row.cancel_reason || row.vremarks || '').trim() ||
    String(row.rejectionreason || '').trim();

  return {
    callId: String(row.id ?? row.ncode ?? ''),
    trn: getTrn(row),
    callCentreId: String(row.vcclid ?? '—'),
    callDate: formatAuditDate(row.callsdtrndate ?? row.dtrndate),
    callType: String(row.calltype ?? row.vcalltype ?? '—'),
    customer: getCustomerLabel(row) || '—',
    branch: getBranchLabel(row) || '—',
    franchisee:
      String(row.franchisee_name ?? '').trim() &&
      row.franchisee_name !== 'Unallocated'
        ? String(row.franchisee_name)
        : '—',
    pincode: String(row.Pincode ?? row.pincode ?? '—'),
    product: String(row.itemname ?? row.vitemname ?? '—'),
    complaint: String(row.vcomplaint ?? row.complaint ?? '—'),
    repairDone: String(row.repair_done ?? '—'),
    statusLabel: label,
    statusTone: tone,
    technician: String(row.serviceman ?? row.technician_name ?? '—'),
    solvedDate: formatAuditDate(row.callsolveddate ?? row.dsolvedatetime),
    remarks: remarks || '—',
  };
}

export function serialRowMatchKey(serialRow: SerialAuditRow): string {
  return serialRow.isUnknownSerial ? '__UNKNOWN__' : serialRow.serial;
}

export function getCallsForSerialRow(
  serialRow: SerialAuditRow,
  calls: Record<string, unknown>[]
): SerialAuditCallDetail[] {
  const targetKey = serialRowMatchKey(serialRow);
  return sortSerialAuditCallDetails(
    calls
      .filter((row) => {
        const normalized = normalizeSerial(row.callsvserialno ?? row.vserialno);
        const key = normalized ?? '__UNKNOWN__';
        return key === targetKey;
      })
      .map(mapRowToSerialAuditCallDetail),
    'asc'
  );
}

export function sortSerialAuditCallDetails(
  calls: SerialAuditCallDetail[],
  order: 'asc' | 'desc' = 'asc'
): SerialAuditCallDetail[] {
  return [...calls].sort((a, b) => {
    const cmp = (a.callDate ?? '').localeCompare(b.callDate ?? '');
    return order === 'asc' ? cmp : -cmp;
  });
}

export function buildCallsBySerialMap(
  calls: Record<string, unknown>[]
): Map<string, SerialAuditCallDetail[]> {
  const map = new Map<string, SerialAuditCallDetail[]>();
  for (const row of calls) {
    const normalized = normalizeSerial(row.callsvserialno ?? row.vserialno);
    const key = normalized ?? '__UNKNOWN__';
    const detail = mapRowToSerialAuditCallDetail(row);
    const list = map.get(key);
    if (list) list.push(detail);
    else map.set(key, [detail]);
  }
  for (const list of map.values()) {
    sortSerialAuditCallDetails(list, 'asc');
  }
  return map;
}

export type SerialAuditListItem = {
  serial: string;
  complaint_count: number | string;
  last_complaint_date: string | null;
};

export type SerialAuditListApiItem = {
  serial: string;
  complaint_count: number | string;
  open_count?: number | string;
  solved_count?: number | string;
  cancelled_count?: number | string;
  last_complaint_date?: string | null;
};

export function mapApiListItemToSerialAuditRow(
  item: SerialAuditListApiItem,
  riskThreshold = 3
): SerialAuditRow {
  const count = Number(item.complaint_count) || 0;
  const open = Number(item.open_count) || 0;
  const solved = Number(item.solved_count) || 0;
  const cancelled = Number(item.cancelled_count) || 0;
  const lastDate = item.last_complaint_date
    ? String(item.last_complaint_date).slice(0, 10)
    : null;
  const serialNorm = normalizeSerial(item.serial);

  return {
    serial: serialNorm ?? String(item.serial).trim().toUpperCase(),
    isUnknownSerial: false,
    complaintCount: count,
    openCount: open,
    solvedCount: solved,
    cancelledCount: cancelled,
    repairCounts: mapRepairCountsFromApiRow(item as Record<string, unknown>),
    uniqueTrns: [],
    uniqueCustomers: [],
    uniqueBranches: [],
    lastComplaintDate: lastDate,
    sampleTrns: [],
    riskFlag: count >= riskThreshold,
  };
}

export function mapListItemToSerialAuditRow(item: SerialAuditListItem): SerialAuditRow {
  const count = Number(item.complaint_count) || 0;
  const lastDate = item.last_complaint_date
    ? String(item.last_complaint_date).slice(0, 10)
    : null;
  return {
    serial: String(item.serial),
    isUnknownSerial: false,
    complaintCount: count,
    openCount: 0,
    solvedCount: 0,
    cancelledCount: 0,
    repairCounts: { ...EMPTY_SERIAL_AUDIT_REPAIR_COUNTS },
    uniqueTrns: [],
    uniqueCustomers: [],
    uniqueBranches: [],
    lastComplaintDate: lastDate,
    sampleTrns: [],
    riskFlag: false,
  };
}

export function enrichSerialAuditRowFromCalls(
  row: SerialAuditRow,
  calls: Record<string, unknown>[],
  riskThreshold = 3
): SerialAuditRow {
  if (calls.length === 0) return row;
  const enriched = aggregateComplaintsBySerial(calls, riskThreshold, MIN_REPEAT_COMPLAINTS)[0];
  if (!enriched) return row;
  return {
    ...row,
    riskFlag: enriched.riskFlag,
  };
}

export function filterSerialAuditCalls(
  calls: Record<string, unknown>[],
  filterParts: RegisterViewFilterParts
): Record<string, unknown>[] {
  return calls.filter((row) => registerRowMatchesViewFilters(row, filterParts));
}

export function getWindowCallsForSerialAudit(
  filterParts: RegisterViewFilterParts,
  corpusWindowKey: string,
  callIdsWithRepair: Set<string> | null = null
): Record<string, unknown>[] {
  if (!callCorpusStore || callCorpusStore.cacheKey !== corpusWindowKey) {
    return [];
  }
  const filtered = getCorpusCallsArray(callCorpusStore).filter((row) =>
    registerRowMatchesViewFilters(row, filterParts)
  );
  return filterCallsByRepairCallIds(filtered, callIdsWithRepair);
}

export function getAllCallsForAudit(
  filterParts: RegisterViewFilterParts,
  distributionCalls?: Record<string, unknown>[]
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();

  const ingest = (rows: Record<string, unknown>[] | undefined) => {
    if (!rows?.length) return;
    for (const raw of rows) {
      const mapped = mapCachedRowToRegisterRow(raw);
      const key = getCallIdentityKey(mapped);
      if (!key) continue;
      const prev = merged.get(key);
      merged.set(key, prev ? mergeRegisterRows(prev, mapped) : mapped);
    }
  };

  ingest(getCorpusCallsFromStore());
  ingest(distributionCalls as Record<string, unknown>[] | undefined);
  ingest(distributionDataCache?.allCalls as Record<string, unknown>[] | undefined);
  ingest(getIndexedRegisterRowsWithSerial());
  ingest(globalReportCache?.data as Record<string, unknown>[] | undefined);

  const all = Array.from(merged.values());
  return all.filter((row) => registerRowMatchesViewFilters(row, filterParts));
}

function getCorpusCallsFromStore(): Record<string, unknown>[] {
  if (!callCorpusStore?.calls.size) return [];
  return Array.from(callCorpusStore.calls.values());
}

export function aggregateComplaintsBySerial(
  calls: Record<string, unknown>[],
  riskThreshold = 3,
  minRepeats: number = MIN_REPEAT_COMPLAINTS
): SerialAuditRow[] {
  type Acc = {
    serial: string;
    isUnknownSerial: boolean;
    complaintCount: number;
    openCount: number;
    solvedCount: number;
    cancelledCount: number;
    trns: Set<string>;
    customers: Set<string>;
    branches: Set<string>;
    dates: string[];
    rows: Record<string, unknown>[];
  };

  const bySerial = new Map<string, Acc>();

  for (const row of calls) {
    const normalized = normalizeSerial(row.callsvserialno ?? row.vserialno);
    const serialKey = normalized ?? '__UNKNOWN__';
    const isUnknown = normalized === null;

    let acc = bySerial.get(serialKey);
    if (!acc) {
      acc = {
        serial: isUnknown ? 'Unknown serial' : normalized!,
        isUnknownSerial: isUnknown,
        complaintCount: 0,
        openCount: 0,
        solvedCount: 0,
        cancelledCount: 0,
        trns: new Set(),
        customers: new Set(),
        branches: new Set(),
        dates: [],
        rows: [],
      };
      bySerial.set(serialKey, acc);
    }

    acc.rows.push(row);
    acc.complaintCount++;
    const bucket = rowStatusBucket(row);
    if (bucket === 'cancelled') acc.cancelledCount++;
    else if (bucket === 'open') acc.openCount++;
    else acc.solvedCount++;

    const trn = getTrn(row);
    if (trn) acc.trns.add(trn);
    const customer = getCustomerLabel(row);
    if (customer) acc.customers.add(customer);
    const branch = getBranchLabel(row);
    if (branch) acc.branches.add(branch);
    const date = getCallDate(row);
    if (date) acc.dates.push(date);
  }

  const rows: SerialAuditRow[] = [];
  for (const acc of bySerial.values()) {
    if (acc.complaintCount < minRepeats) continue;
    const sortedDates = [...acc.dates].sort((a, b) => b.localeCompare(a));
    const uniqueTrns = Array.from(acc.trns);
    const details = acc.rows.map(mapRowToSerialAuditCallDetail);
    rows.push({
      serial: acc.serial,
      isUnknownSerial: acc.isUnknownSerial,
      complaintCount: acc.complaintCount,
      openCount: acc.openCount,
      solvedCount: acc.solvedCount,
      cancelledCount: acc.cancelledCount,
      repairCounts: countRepairsFromCallRows(acc.rows),
      uniqueTrns,
      uniqueCustomers: Array.from(acc.customers),
      uniqueBranches: Array.from(acc.branches),
      lastComplaintDate: sortedDates[0] ?? null,
      sampleTrns: uniqueTrns.slice(0, 5),
      riskFlag: !acc.isUnknownSerial && evaluateSerialRiskFlag(details, riskThreshold),
    });
  }

  return rows.sort((a, b) => {
    const dateCmp = (b.lastComplaintDate ?? '').localeCompare(a.lastComplaintDate ?? '');
    if (dateCmp !== 0) return dateCmp;
    return b.complaintCount - a.complaintCount;
  });
}

export type SerialAuditFilterOptions = {
  minCount?: number;
  search?: string;
  onlyFlagged?: boolean;
  hideUnknown?: boolean;
};

export function filterSerialAuditRows(
  rows: SerialAuditRow[],
  opts: SerialAuditFilterOptions
): SerialAuditRow[] {
  const minCount = Math.max(opts.minCount ?? MIN_REPEAT_COMPLAINTS, MIN_REPEAT_COMPLAINTS);
  const search = (opts.search ?? '').trim().toLowerCase();

  return rows.filter((row) => {
    if (opts.hideUnknown !== false && row.isUnknownSerial) return false;
    if (row.complaintCount <= 0) return false;
    if (opts.onlyFlagged && !row.riskFlag) return false;
    if (row.complaintCount < minCount) return false;
    if (search) {
      const hay = [
        row.serial,
        ...row.uniqueTrns,
        ...row.uniqueCustomers,
        ...row.uniqueBranches,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function summarizeSerialAudit(rows: SerialAuditRow[]) {
  const known = rows.filter((r) => !r.isUnknownSerial && r.complaintCount >= MIN_REPEAT_COMPLAINTS);
  const flagged = known.filter((r) => r.riskFlag);
  const withCancelled = known.filter((r) => r.cancelledCount > 0);
  const maxComplaints = known.reduce((m, r) => Math.max(m, r.complaintCount), 0);
  return {
    totalSerials: known.length,
    flaggedCount: flagged.length,
    withCancelledCount: withCancelled.length,
    maxComplaints,
  };
}

export type RepeatInvolvementEntry = {
  technician: string;
  franchisee: string;
  repeatCalls: number;
  serialCount: number;
  /** Serial keys (normalized) with repeat-involvement calls for this pair. */
  serialKeys: string[];
  motor: number;
  compressor: number;
  gasCharging: number;
};

export function buildInvolvementPairKey(technician: string, franchisee: string): string {
  return `${technician}\u001f${franchisee}`;
}

export const SERIAL_AUDIT_INVOLVEMENT_PAGE_SIZES = [5, 10, 25, 50] as const;
export type SerialAuditInvolvementPageSize = (typeof SERIAL_AUDIT_INVOLVEMENT_PAGE_SIZES)[number];

export type SerialAuditRepeatInvolvement = {
  entries: RepeatInvolvementEntry[];
  repeatCallCount: number;
  serialsInScope: number;
  serialsWithDetails: number;
  detailsPending: boolean;
};

const EMPTY_PARTY = new Set(['', '—', '-', 'UNALLOCATED', 'N/A', 'NA']);

function normalizeInvolvementParty(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (EMPTY_PARTY.has(trimmed.toUpperCase())) return null;
  return trimmed;
}

type PairInvolvementStats = {
  technician: string;
  franchisee: string;
  repeatCalls: number;
  serials: Set<string>;
  serialsWithMotor: Set<string>;
  serialsWithCompressor: Set<string>;
  serialsWithGas: Set<string>;
};

function bumpPairInvolvement(
  map: Map<string, PairInvolvementStats>,
  technician: string,
  franchisee: string,
  serialKey: string,
  call: SerialAuditCallDetail
) {
  const key = `${technician}\u001f${franchisee}`;
  const repairs = parseRepairCountsFromRepairDone(call.repairDone);
  const existing = map.get(key);
  if (existing) {
    existing.repeatCalls += 1;
    existing.serials.add(serialKey);
    if (repairs.motorReplaced > 0) existing.serialsWithMotor.add(serialKey);
    if (repairs.compressorReplaced > 0) existing.serialsWithCompressor.add(serialKey);
    if (repairs.gasCharging > 0) existing.serialsWithGas.add(serialKey);
    return;
  }
  map.set(key, {
    technician,
    franchisee,
    repeatCalls: 1,
    serials: new Set([serialKey]),
    serialsWithMotor: repairs.motorReplaced > 0 ? new Set([serialKey]) : new Set(),
    serialsWithCompressor:
      repairs.compressorReplaced > 0 ? new Set([serialKey]) : new Set(),
    serialsWithGas: repairs.gasCharging > 0 ? new Set([serialKey]) : new Set(),
  });
}

function pairInvolvementEntriesFromMap(map: Map<string, PairInvolvementStats>): RepeatInvolvementEntry[] {
  return [...map.values()]
    .map((stats) => ({
      technician: stats.technician,
      franchisee: stats.franchisee,
      repeatCalls: stats.repeatCalls,
      serialCount: stats.serials.size,
      serialKeys: [...stats.serials],
      motor: stats.serialsWithMotor.size,
      compressor: stats.serialsWithCompressor.size,
      gasCharging: stats.serialsWithGas.size,
    }))
    .sort(
      (a, b) =>
        b.serialCount - a.serialCount ||
        b.repeatCalls - a.repeatCalls ||
        b.compressor - a.compressor
    );
}

function callCountsForRepeatInvolvement(
  calls: SerialAuditCallDetail[],
  includeCancelled: boolean
): SerialAuditCallDetail[] {
  const viewCalls = filterSerialAuditCallsForView(calls, includeCancelled);
  if (viewCalls.length < MIN_REPEAT_COMPLAINTS) return [];

  const repeatedKeys = getRepeatedComplaintKeys(viewCalls, {
    excludeCancelled: !includeCancelled,
  });

  if (repeatedKeys.size > 0) {
    return viewCalls.filter((call) => {
      const key = normalizeComplaintKey(call.complaint);
      if (!key || key === '—' || key === '-') return false;
      return repeatedKeys.has(key);
    });
  }

  return viewCalls;
}

/** Repeat-complaint calls on this serial attributed to the given ASP + technician. */
export function filterCallsForInvolvementPair(
  calls: SerialAuditCallDetail[],
  includeCancelled: boolean,
  technician: string,
  franchisee: string
): SerialAuditCallDetail[] {
  const repeatCalls = callCountsForRepeatInvolvement(calls, includeCancelled);
  return repeatCalls.filter((call) => {
    const t = normalizeInvolvementParty(call.technician) ?? '—';
    const f = normalizeInvolvementParty(call.franchisee) ?? '—';
    return t === technician && f === franchisee;
  });
}

/** Rank technician + franchisee pairs by involvement in repeat-complaint calls. */
export function computeRepeatInvolvementAnalysis(
  serials: SerialAuditRow[],
  windowCallsBySerial: Map<string, SerialAuditCallDetail[]>,
  includeCancelled: boolean,
  resolveCalls?: (serialKey: string) => SerialAuditCallDetail[]
): SerialAuditRepeatInvolvement {
  const pairs = new Map<string, PairInvolvementStats>();
  let repeatCallCount = 0;
  let serialsWithDetails = 0;

  const getCalls =
    resolveCalls ?? ((serialKey: string) => windowCallsBySerial.get(serialKey) ?? []);

  const inScope = serials.filter((row) => !row.isUnknownSerial);

  for (const row of inScope) {
    const serialKey = serialRowMatchKey(row);
    const rawCalls = getCalls(serialKey);
    if (!rawCalls.length) continue;
    serialsWithDetails += 1;

    const involvedCalls = callCountsForRepeatInvolvement(rawCalls, includeCancelled);
    repeatCallCount += involvedCalls.length;

    for (const call of involvedCalls) {
      const technician = normalizeInvolvementParty(call.technician) ?? '—';
      const franchisee = normalizeInvolvementParty(call.franchisee) ?? '—';
      if (technician === '—' && franchisee === '—') continue;
      bumpPairInvolvement(pairs, technician, franchisee, serialKey, call);
    }
  }

  return {
    entries: pairInvolvementEntriesFromMap(pairs),
    repeatCallCount,
    serialsInScope: inScope.length,
    serialsWithDetails,
    detailsPending: serialsWithDetails < inScope.length,
  };
}
