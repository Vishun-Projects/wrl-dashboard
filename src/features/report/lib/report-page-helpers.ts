import type { RegisterSummary, RegisterSummaryBucket } from '@/features/report/lib/search';
import { openReportsDb } from '@/features/report/lib/corpus-storage';
import {
  accountRowScore,
  filterTopAccountsByZone,
  rollupAccountsByAccount,
  type ClientMergeWithCrmPrefs,
} from '@/features/report/ui/SummaryMergedMetricCell';

export type AccountMisGrouping = 'zone' | 'overview' | 'zone-top';

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
export const saveCallsToDB = async (calls: any[]) => {
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

export const getCallsFromDB = async (): Promise<any[]> => {
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

export const saveMeta = async (key: string, val: any) => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
  } catch (err) {
    console.error('IndexedDB meta save error:', err);
  }
};

export const getMeta = async (key: string): Promise<any> => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
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
  data: any[];
  total: number;
  registerSummary?: RegisterSummary | null;
  summaryData?: any[];
  accountsData?: any[];
  globalHeadcount?: number;
};

export function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
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
export function logSummaryDebug(_label: string, _payload: Record<string, unknown>) {}

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
  /* no-op */
}
