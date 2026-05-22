import { distributionDataCache, globalReportCache } from '@/lib/report-data-store';
import type { RegisterViewFilterParts } from '@/lib/report-filters';
import {
  mapCachedRowToRegisterRow,
  registerRowMatchesViewFilters,
} from '@/lib/report-search';
import {
  getCallIdentityKey,
  getIndexedRegisterRowsWithSerial,
} from '@/lib/report-sync';
import { classifyTrhcallRow } from '@/lib/trhcalls-query';

export type SerialAuditRow = {
  serial: string;
  complaintCount: number;
  openCount: number;
  solvedCount: number;
  cancelledCount: number;
  uniqueTrns: string[];
  uniqueCustomers: string[];
  uniqueBranches: string[];
  lastComplaintDate: string | null;
  sampleTrns: string[];
  riskFlag: boolean;
  isUnknownSerial: boolean;
};

const INVALID_SERIALS = new Set(['', '0', 'N/A', 'NA', 'NONE', 'NULL', '-', '—']);

export function normalizeSerial(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (INVALID_SERIALS.has(upper)) return null;
  return upper;
}

function rowStatusBucket(row: Record<string, unknown>): 'open' | 'solved' | 'cancelled' {
  return classifyTrhcallRow({
    bsolved: row.callsolved ?? row.bsolved,
    bfastclose: row.bfastclose,
    ncancelreason: row.ncancelreason,
  });
}

function getCallDate(row: Record<string, unknown>): string | null {
  const d = row.callsdtrndate ?? row.dtrndate;
  if (d == null || String(d).trim() === '') return null;
  return String(d);
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

function getCustomerLabel(row: Record<string, unknown>): string {
  return String(row.PartyName ?? row.party_name ?? '').trim();
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
      merged.set(key, mapped);
    }
  };

  ingest(distributionCalls as Record<string, unknown>[] | undefined);
  ingest(distributionDataCache?.allCalls as Record<string, unknown>[] | undefined);
  ingest(getIndexedRegisterRowsWithSerial());
  ingest(globalReportCache?.data as Record<string, unknown>[] | undefined);

  const all = Array.from(merged.values());
  return all.filter((row) => registerRowMatchesViewFilters(row, filterParts));
}

export function aggregateComplaintsBySerial(
  calls: Record<string, unknown>[],
  riskThreshold = 3
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
      };
      bySerial.set(serialKey, acc);
    }

    acc.complaintCount++;
    const bucket = rowStatusBucket(row);
    if (bucket === 'open') acc.openCount++;
    else if (bucket === 'solved') acc.solvedCount++;
    else acc.cancelledCount++;

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
    const sortedDates = [...acc.dates].sort((a, b) => b.localeCompare(a));
    const uniqueTrns = Array.from(acc.trns);
    rows.push({
      serial: acc.serial,
      isUnknownSerial: acc.isUnknownSerial,
      complaintCount: acc.complaintCount,
      openCount: acc.openCount,
      solvedCount: acc.solvedCount,
      cancelledCount: acc.cancelledCount,
      uniqueTrns,
      uniqueCustomers: Array.from(acc.customers),
      uniqueBranches: Array.from(acc.branches),
      lastComplaintDate: sortedDates[0] ?? null,
      sampleTrns: uniqueTrns.slice(0, 5),
      riskFlag: !acc.isUnknownSerial && acc.complaintCount >= riskThreshold,
    });
  }

  return rows.sort((a, b) => b.complaintCount - a.complaintCount);
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
  const minCount = opts.minCount ?? 1;
  const search = (opts.search ?? '').trim().toLowerCase();

  return rows.filter((row) => {
    if (opts.hideUnknown !== false && row.isUnknownSerial) return false;
    if (opts.onlyFlagged && !row.riskFlag) return false;
    if (row.complaintCount < minCount) return false;
    if (search) {
      const hay = [
        row.serial,
        ...row.sampleTrns,
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

export function summarizeSerialAudit(rows: SerialAuditRow[], riskThreshold = 3) {
  const known = rows.filter((r) => !r.isUnknownSerial);
  const flagged = known.filter((r) => r.complaintCount >= riskThreshold);
  const maxComplaints = known.reduce((m, r) => Math.max(m, r.complaintCount), 0);
  return {
    totalSerials: known.length,
    flaggedCount: flagged.length,
    maxComplaints,
  };
}
