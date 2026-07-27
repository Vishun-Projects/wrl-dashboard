import type { RegisterSummary, RegisterSummaryBucket } from '@/features/report/lib/search';
import type { BranchSummaryRow } from '@/lib/summary/derive';
import { openReportsDb } from '@/features/report/lib/corpus-storage';
import {
  accountRowScore,
  filterTopAccountsByZone,
  rollupAccountsByAccount,
  type ClientMergeWithCrmPrefs,
} from '@/features/report/ui/SummaryMergedMetricCell';
import { formatUiDate } from '@/lib/dates/ui-date';

export type AccountMisGrouping = 'zone' | 'overview' | 'zone-top';

const BRANCH_SUM_KEYS = [
  'total_calls',
  'solved_calls',
  'cancelled_calls',
  'open_calls',
  'age_2',
  'age_3',
  'age_7',
  'age_15',
  'part_pending',
  'all_total',
  'all_solved',
  'all_cancelled',
  'all_open',
  'all_age_2',
  'all_age_3',
  'all_age_7',
  'all_age_15',
  'all_part_pending',
  'all_tech_solved',
  'tech_solved_calls',
  'deployment_total',
  'deployment_done',
  'installation_total',
  'installation_done',
  'active_eng',
  'population',
] as const satisfies ReadonlyArray<keyof BranchSummaryRow>;

function branchDisplayKey(region: unknown, branch: unknown): string {
  return `${String(region ?? '').trim().toUpperCase()}::${String(branch ?? '').trim().toLowerCase()}`;
}

/**
 * Collapse rows that share the same region + branch label (e.g. franchisee offices
 * that resolve to the same display name, or client import splits). Sums call metrics;
 * keeps officeId/parentId from the row with the largest total_calls; headcount = max.
 */
export function mergeBranchSummaryRowsByName(rows: BranchSummaryRow[]): BranchSummaryRow[] {
  const map = new Map<string, BranchSummaryRow>();
  for (const row of rows) {
    const key = branchDisplayKey(row.region, row.branch);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    const preferRow = Number(row.total_calls) > Number(prev.total_calls) ? row : prev;
    const merged: BranchSummaryRow = {
      ...preferRow,
      branch: preferRow.branch || prev.branch || row.branch,
      region: preferRow.region || prev.region || row.region,
      headcount: Math.max(Number(prev.headcount) || 0, Number(row.headcount) || 0),
    };
    for (const k of BRANCH_SUM_KEYS) {
      (merged as Record<(typeof BRANCH_SUM_KEYS)[number], number>)[k] =
        (Number(prev[k]) || 0) + (Number(row[k]) || 0);
    }
    map.set(key, merged);
  }
  return [...map.values()].sort((a, b) => Number(b.total_calls) - Number(a.total_calls));
}

/** Same collapse for loosely typed client branch rows used in Summary Dashboard. */
export function mergeBranchRowsByName(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = branchDisplayKey(row.region, row.branch ?? row.region);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    const prevTotal = Number(prev.total_calls ?? 0);
    const rowTotal = Number(row.total_calls ?? 0);
    const preferRow = rowTotal > prevTotal ? row : prev;
    const merged: Record<string, unknown> = {
      ...preferRow,
      branch: preferRow.branch ?? prev.branch ?? row.branch,
      region: preferRow.region ?? prev.region ?? row.region,
      headcount: Math.max(Number(prev.headcount) || 0, Number(row.headcount) || 0),
    };
    for (const k of [
      'total_calls',
      'solved_calls',
      'total_solved',
      'cancelled_calls',
      'open_calls',
      'age_2',
      'age_3',
      'age_7',
      'age_15',
      'part_pending',
      'active_eng',
      'population',
    ] as const) {
      merged[k] = (Number(prev[k]) || 0) + (Number(row[k]) || 0);
    }
    map.set(key, merged);
  }
  return [...map.values()].sort(
    (a, b) => Number(b.total_calls ?? 0) - Number(a.total_calls ?? 0)
  );
}

export function regionPerfRowClass(region: string): string {
  const r = String(region ?? '').toUpperCase();
  if (r.includes('NORTH')) return 'perf-region-row perf-region-row--north';
  if (r.includes('EAST')) return 'perf-region-row perf-region-row--east';
  if (r.includes('WEST')) return 'perf-region-row perf-region-row--west';
  if (r.includes('SOUTH')) return 'perf-region-row perf-region-row--south';
  return 'perf-region-row perf-region-row--default';
}

export function regionPerfAccountCellClass(region: string): string {
  const r = String(region ?? '').toUpperCase();
  if (r === 'NORTH' || r === 'NORTH ZONE') return 'perf-region-cell perf-region-cell--north';
  if (r === 'EAST' || r === 'EAST ZONE') return 'perf-region-cell perf-region-cell--east';
  if (r === 'WEST' || r === 'WEST ZONE') return 'perf-region-cell perf-region-cell--west';
  if (r === 'SOUTH' || r === 'SOUTH ZONE') return 'perf-region-cell perf-region-cell--south';
  return 'perf-region-cell perf-region-cell--default';
}

export function resolveAccountMisTableRows(
  filteredAccounts: Array<Record<string, unknown>>,
  grouping: AccountMisGrouping,
  topN: number,
  clientAccountSummaryData: Array<Record<string, unknown>> | undefined,
  mergeFlags: { crm: boolean; client: boolean },
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  zoneTopExcludeAccounts: string[] = []
): Array<Record<string, unknown>> {
  if (grouping === 'overview') {
    return rollupAccountsByAccount(filteredAccounts);
  }
  if (grouping === 'zone-top') {
    const scoreFn = (row: Record<string, unknown>) =>
      accountRowScore(row, clientAccountSummaryData, mergeFlags, clientMergeWithCrm);
    return filterTopAccountsByZone(filteredAccounts, topN, scoreFn, zoneTopExcludeAccounts);
  }
  return filteredAccounts;
}

/** IndexedDB helpers (same DB version as report-corpus-storage). */
export const saveCallsToDB = async (calls: Array<Record<string, unknown>>) => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('calls', 'readwrite');
    const store = tx.objectStore('calls');
    calls.forEach((c) => {
      if (c.UniqueCallNo) {
        store.put(c);
      }
    });
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB save error:', err);
  }
};

export const getCallsFromDB = async (): Promise<Array<Record<string, unknown>>> => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('calls', 'readonly');
    const store = tx.objectStore('calls');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB read error:', err);
    return [];
  }
};

export const saveMeta = async (key: string, val: unknown) => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
  } catch (err) {
    console.error('IndexedDB meta save error:', err);
  }
};

/** IndexedDB meta bag — shape varies by key; callers pass T. */
export const getMeta = async <T = unknown>(key: string): Promise<T | null> => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
};

export const clearCallsDB = async () => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction(['calls', 'meta'], 'readwrite');
    tx.objectStore('calls').clear();
    tx.objectStore('meta').clear();
  } catch (err) {
    console.error('IndexedDB clear error:', err);
  }
};

export type RegisterPageCacheEntry = {
  data: Array<Record<string, unknown>>;
  total: number;
  registerSummary?: RegisterSummary | null;
  summaryData?: Array<Record<string, unknown>>;
  accountsData?: Array<Record<string, unknown>>;
  globalHeadcount?: number;
};

/** Shape stored under IndexedDB meta key `cacheParams`. */
export type ReportIdbCacheParams = {
  startDate?: string;
  endDate?: string;
  dateFilterColumn?: string;
  officeIds?: string;
  callTypes?: string;
  lastRefreshed?: string;
  total?: number;
  registerSummary?: RegisterSummary | null;
  summaryData?: Array<Record<string, unknown>>;
  accountsData?: Array<Record<string, unknown>>;
  globalHeadcount?: number;
  summaryQueryKey?: string | null;
};

export function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatUiDate(date);
}

export function adjustRegisterSummaryBucket(
  summary: RegisterSummary,
  bucket: RegisterSummaryBucket,
  delta: 1 | -1
) {
  if (bucket === 'transferred') return;

  const step = delta === 1 ? 1 : -1;
  const bump = (value: number) => Math.max(0, value + step);

  if (bucket === 'closed') {
    summary.closed = bump(summary.closed);
    summary.solved = bump(summary.solved);
  } else if (bucket === 'techSolved') {
    summary.techSolved = bump(summary.techSolved);
    summary.solved = bump(summary.solved);
  } else if (bucket === 'assigned') {
    summary.assigned = bump(summary.assigned);
    summary.open = bump(summary.open);
  } else if (bucket === 'openUnallocated') {
    summary.openUnallocated = bump(summary.openUnallocated);
    summary.open = bump(summary.open);
  } else if (bucket === 'cancelled') {
    summary.cancelled = bump(summary.cancelled);
  }
}

export function registerPageCachePut(
  root: Map<string, Map<number, RegisterPageCacheEntry>>,
  queryKey: string,
  page: number,
  entry: RegisterPageCacheEntry
) {
  let inner = root.get(queryKey);
  if (!inner) {
    inner = new Map();
    root.set(queryKey, inner);
  }
  inner.set(page, entry);
}

export function registerPageCacheGet(
  root: Map<string, Map<number, RegisterPageCacheEntry>>,
  queryKey: string,
  page: number
): RegisterPageCacheEntry | undefined {
  return root.get(queryKey)?.get(page);
}

/** No-op — perf hooks kept so call sites stay stable without console noise. */
export function logSummaryDebug(_label: string, _payload?: Record<string, unknown>) {
  void _label;
  void _payload;
}

export function corpusSpanDays(startDateStr: string, endDateStr: string): number {
  const spanStart = new Date(`${startDateStr}T00:00:00`);
  const spanEnd = new Date(`${endDateStr}T23:59:59`);
  if (Number.isNaN(spanStart.getTime()) || Number.isNaN(spanEnd.getTime())) return 0;
  return Math.floor((spanEnd.getTime() - spanStart.getTime()) / 86400000) + 1;
}

export function reportPerfLogDocumentNavigationOnce() {
  /* no-op */
}

export function reportPerf(
  _phase: string,
  _action: string,
  _opStart: number,
  _extra?: Record<string, unknown>
) {
  void _phase;
  void _action;
  void _opStart;
  void _extra;
}
