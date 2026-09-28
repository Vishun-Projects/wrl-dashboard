import 'server-only';

import { postQuery } from '@/lib/db/proxy';
import {
  buildRejectedCallsListSql,
  buildRejectedCallsSummarySql,
  type RejectedBySource,
  type RejectedCallsSqlOpts,
} from '@/sql/rejected-calls/query';
import type {
  RejectedCallRow,
  RejectedCallsByLabel,
  RejectedCallsFilters,
  RejectedCallsRowsResponse,
  RejectedCallsSummary,
} from '@/modules/rejected-calls/types';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const CRM_TIMEOUT_MS = 120_000;

function defaultMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    startDate: `${pick('year')}-${pick('month')}-01`,
    endDate: `${pick('year')}-${pick('month')}-${pick('day')}`,
  };
}

function optionalParam(searchParams: URLSearchParams, key: string): string | null {
  const raw = searchParams.get(key)?.trim() || '';
  if (!raw || raw === 'All') return null;
  return raw;
}

function csvList(searchParams: URLSearchParams, key: string): string[] {
  const raw = optionalParam(searchParams, key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseRejectedCallsFilters(
  searchParams: URLSearchParams
): Omit<RejectedCallsFilters, 'isHod' | 'assignedOffices'> {
  const defaults = defaultMonthRange();
  const startDate = searchParams.get('startDate')?.trim() || defaults.startDate;
  const endDate = searchParams.get('endDate')?.trim() || defaults.endDate;
  if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) {
    throw new Error('startDate and endDate must be YYYY-MM-DD');
  }
  const sourceRaw = searchParams.get('source')?.trim();
  const source: RejectedBySource | null =
    sourceRaw === 'HO' || sourceRaw === 'Branch' ? sourceRaw : null;
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50));
  return {
    startDate,
    endDate,
    source,
    callType: optionalParam(searchParams, 'callType'),
    officeId: optionalParam(searchParams, 'officeId'),
    technician: optionalParam(searchParams, 'technician'),
    search: optionalParam(searchParams, 'search'),
    reasons: csvList(searchParams, 'reasons'),
    repair: optionalParam(searchParams, 'repair'),
    dateFilterColumn: optionalParam(searchParams, 'dateFilterColumn'),
    page,
    pageSize,
  };
}

function toSqlOpts(filters: RejectedCallsFilters): RejectedCallsSqlOpts {
  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    source: filters.source,
    isHod: filters.isHod,
    assignedOffices: filters.assignedOffices,
    callType: filters.callType,
    officeId: filters.officeId,
    technician: filters.technician,
    search: filters.search,
    reasons: filters.reasons,
    repair: filters.repair,
    dateFilterColumn: filters.dateFilterColumn,
    offset: (filters.page - 1) * filters.pageSize,
    limit: filters.pageSize,
  };
}

function cell(row: Record<string, unknown>, key: string): string {
  const want = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === want && v != null) return String(v).trim();
  }
  return '';
}

function num(row: Record<string, unknown>, key: string): number {
  const n = Number(cell(row, key));
  return Number.isFinite(n) ? n : 0;
}

function emptyToNull(value: string): string | null {
  return value && value.toLowerCase() !== 'null' ? value : null;
}

function mapRow(raw: Record<string, unknown>): RejectedCallRow | null {
  const ncode = num(raw, 'ncode');
  const nofficeid = num(raw, 'nofficeid');
  if (!ncode || !nofficeid) return null;
  const source = cell(raw, 'rejected_by_source');
  return {
    ncode,
    nofficeid,
    callNo: cell(raw, 'call_no') || String(ncode),
    callDate: emptyToNull(cell(raw, 'call_date')),
    serialNo: emptyToNull(cell(raw, 'serial_no')),
    callType: emptyToNull(cell(raw, 'call_type')),
    activityDone: emptyToNull(cell(raw, 'activity_done')),
    solveDate: emptyToNull(cell(raw, 'solve_date')),
    rejectedBySource: source === 'HO' ? 'HO' : 'Branch',
    rejectionAt: emptyToNull(cell(raw, 'rejection_at')),
    rejectionReason: emptyToNull(cell(raw, 'rejection_reason')),
    rejectedByName: emptyToNull(cell(raw, 'rejected_by_name')),
    branchName: emptyToNull(cell(raw, 'branch_name')),
    franchiseeName: emptyToNull(cell(raw, 'franchisee_name')),
  };
}

function bucket(rows: Record<string, unknown>[], kind: string): RejectedCallsByLabel[] {
  return rows
    .filter((row) => cell(row, 'kind').toLowerCase() === kind)
    .map((row) => ({
      label: cell(row, 'label') || '(blank)',
      count: Math.max(0, Number(cell(row, 'total') || 0) || 0),
    }))
    .sort((a, b) => b.count - a.count);
}

export async function fetchRejectedCallsRows(
  filters: RejectedCallsFilters
): Promise<RejectedCallsRowsResponse> {
  const listRes = await postQuery({
    rawSql: buildRejectedCallsListSql(toSqlOpts(filters)),
    timeoutMs: CRM_TIMEOUT_MS,
  });
  const raw = (listRes.data ?? []) as Record<string, unknown>[];
  const rows = raw.map(mapRow).filter((r): r is RejectedCallRow => r != null);
  const total = Math.max(
    rows.length,
    Number(raw[0] ? cell(raw[0], 'total') : 0) || 0
  );
  return { rows, total, page: filters.page, pageSize: filters.pageSize };
}

export async function fetchRejectedCallsSummary(
  filters: RejectedCallsFilters
): Promise<RejectedCallsSummary> {
  const res = await postQuery({
    rawSql: buildRejectedCallsSummarySql(toSqlOpts(filters)),
    timeoutMs: CRM_TIMEOUT_MS,
  });
  const raw = (res.data ?? []) as Record<string, unknown>[];
  const byCallType = bucket(raw, 'call_type');
  const byReason = bucket(raw, 'reason');
  const total = byCallType.reduce((sum, row) => sum + row.count, 0);
  return { total, byCallType, byReason };
}

export async function fetchRejectedCallsPage(
  filters: RejectedCallsFilters
): Promise<RejectedCallsRowsResponse> {
  const [rows, summary] = await Promise.all([
    fetchRejectedCallsRows(filters),
    fetchRejectedCallsSummary(filters),
  ]);
  return { ...rows, summary };
}
