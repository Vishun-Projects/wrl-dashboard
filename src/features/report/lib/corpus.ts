import type { RegisterViewFilterParts } from '@/features/report/lib/filters';
import { formatLocalDate } from '@/features/report/lib/filters';
import {
  getCallIdentityKey,
  indexRegisterRowsWithSerial,
  notifyRegisterDelta,
} from '@/features/report/lib/sync';
import { mapCachedRowToRegisterRow, registerRowMatchesViewFilters } from '@/features/report/lib/search';
import {
  persistCorpusCalls,
  patchCorpusCallsInDB,
  readCorpusCallsLazy,
  readCorpusMeta,
  type CorpusMeta,
} from '@/features/report/lib/corpus-storage';
import type { CallCorpusStore, DistributionDataCache } from '@/features/report/lib/data-store';
import {
  setCallCorpusStore,
  callCorpusStore,
  setDistributionDataCache,
  distributionDataCache,
} from '@/features/report/lib/data-store';
import {
  MAX_CLIENT_CORPUS_DAYS,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls/query';

export const CLIENT_CORPUS_PAGE_THRESHOLD = 5000;

/** Align with /api/report/corpus in-memory cache TTL. */
export const CORPUS_SERVER_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export type CorpusLoadStatus = CallCorpusStore['status'];

export type CorpusViewDateFilter = {
  viewStartDate: string;
  viewEndDate: string;
  dateFilterColumn: RegisterDateFilterColumn;
};

export type CorpusFetchScope = {
  fetchStartDate: string;
  fetchEndDate: string;
  dateFilterColumn: RegisterDateFilterColumn;
};

type CorpusListener = () => void;
const corpusListeners = new Set<CorpusListener>();

export function subscribeCorpus(listener: CorpusListener): () => void {
  corpusListeners.add(listener);
  return () => corpusListeners.delete(listener);
}

function notifyCorpusListeners() {
  corpusListeners.forEach((l) => l());
}

function corpusSpanDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** Expand a view window to full calendar month bounds (start month → end month). */
export function expandToMonthBounds(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  return {
    startDate: formatLocalDate(monthStart),
    endDate: formatLocalDate(monthEnd),
  };
}

/** Split a date range into full calendar months (inclusive). */
export function splitCalendarMonths(
  startDate: string,
  endDate: string
): Array<{ start: string; end: string }> {
  const expanded = expandToMonthBounds(startDate, endDate);
  const months: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${expanded.startDate}T00:00:00`);
  const rangeEnd = new Date(`${expanded.endDate}T00:00:00`);
  while (cursor <= rangeEnd) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    months.push({
      start: formatLocalDate(monthStart),
      end: formatLocalDate(monthEnd),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

/** Network fetch window: full month bucket when view span fits client corpus limits. */
export function resolveCorpusFetchScope(
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn
): CorpusFetchScope {
  const viewSpanDays = corpusSpanDays(viewStartDate, viewEndDate);
  if (viewSpanDays > MAX_CLIENT_CORPUS_DAYS) {
    return {
      fetchStartDate: viewStartDate,
      fetchEndDate: viewEndDate,
      dateFilterColumn,
    };
  }

  const expanded = expandToMonthBounds(viewStartDate, viewEndDate);
  const expandedSpanDays = corpusSpanDays(expanded.startDate, expanded.endDate);
  if (expandedSpanDays > MAX_CLIENT_CORPUS_DAYS) {
    return {
      fetchStartDate: viewStartDate,
      fetchEndDate: viewEndDate,
      dateFilterColumn,
    };
  }

  return {
    fetchStartDate: expanded.startDate,
    fetchEndDate: expanded.endDate,
    dateFilterColumn,
  };
}

/** Corpus cache key = month fetch window + date column (view filters applied client-side). */
export function buildCorpusCacheKey(
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): string {
  const scope = resolveCorpusFetchScope(viewStartDate, viewEndDate, dateFilterColumn);
  return `${scope.fetchStartDate}|${scope.fetchEndDate}|${scope.dateFilterColumn}`;
}

/** YYYY-MM month keys present in corpus rows (by active date column). */
export function monthsPresentInCorpusStore(
  store: CallCorpusStore | null,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): Set<string> {
  const months = new Set<string>();
  if (!store?.calls.size) return months;
  for (const row of store.calls.values()) {
    const raw = registerRowDateValue(row, dateFilterColumn);
    if (!raw) continue;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) continue;
    months.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** True when in-memory corpus already contains every calendar month in the fetch scope. */
export function corpusStoreCoversFetchScope(
  store: CallCorpusStore | null,
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): boolean {
  if (!store?.calls.size) return false;
  const scope = resolveCorpusFetchScope(viewStartDate, viewEndDate, dateFilterColumn);
  const needed = splitCalendarMonths(scope.fetchStartDate, scope.fetchEndDate).map((m) =>
    m.start.slice(0, 7)
  );
  const have = monthsPresentInCorpusStore(store, dateFilterColumn);
  return needed.every((m) => have.has(m));
}

/** Re-tag in-memory corpus for a narrower view scope (no network) when months are already loaded. */
export function adoptCorpusStoreForScope(
  store: CallCorpusStore,
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): CallCorpusStore {
  const cacheKey = buildCorpusCacheKey(viewStartDate, viewEndDate, dateFilterColumn);
  if (store.cacheKey === cacheKey) return store;
  const next: CallCorpusStore = { ...store, cacheKey };
  setCallCorpusStore(next);
  notifyCorpusListeners();
  return next;
}

export function buildCorpusViewDateFilter(
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn
): CorpusViewDateFilter {
  return { viewStartDate, viewEndDate, dateFilterColumn };
}

export function registerRowDateValue(
  row: Record<string, unknown>,
  column: RegisterDateFilterColumn
): string | null {
  if (column === 'bm_approved_at') {
    // Match Call Register "BM Approved Date" column (ARCP pick), not call-level bapproval/editedon.
    const raw = row.bm_approved_at ?? row.bm_approved_date;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw);
  }
  const raw =
    column === 'dsolvedatetime'
      ? row.callsolveddate ?? row.dsolvedatetime
      : row.callsdtrndate ?? row.dtrndate;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw);
}

export function rowMatchesDateRange(
  row: Record<string, unknown>,
  startDate: string,
  endDate: string,
  dateFilterColumn: RegisterDateFilterColumn
): boolean {
  const raw = registerRowDateValue(row, dateFilterColumn);
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T23:59:59.999`).getTime();
  return t >= start && t <= end;
}

export function filterCorpusCallsByViewDate(
  calls: Record<string, unknown>[],
  view: CorpusViewDateFilter
): Record<string, unknown>[] {
  return calls.filter((row) =>
    rowMatchesDateRange(row, view.viewStartDate, view.viewEndDate, view.dateFilterColumn)
  );
}

export function corpusMatchesDateWindow(
  store: CallCorpusStore | null,
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): boolean {
  return (
    !!store &&
    store.cacheKey === buildCorpusCacheKey(viewStartDate, viewEndDate, dateFilterColumn) &&
    store.calls.size > 0
  );
}

export function buildEffectiveViewFilterParts(
  base: RegisterViewFilterParts,
  callTypesParam: string
): RegisterViewFilterParts {
  if (base.selectedCallTypes.length > 0) return base;
  if (!callTypesParam || callTypesParam === 'All') return base;
  return {
    ...base,
    selectedCallTypes: callTypesParam.split(',').map((t) => t.trim()).filter(Boolean),
  };
}

export function getFilteredCorpusCalls(
  filterParts: RegisterViewFilterParts,
  store: CallCorpusStore | null = callCorpusStore,
  viewDate?: CorpusViewDateFilter
): Record<string, unknown>[] {
  if (!store?.calls.size) return [];
  let calls = getCorpusCallsArray(store);
  if (viewDate) {
    calls = filterCorpusCallsByViewDate(calls, viewDate);
  }
  return calls.filter((row) => registerRowMatchesViewFilters(row, filterParts));
}

export function canServeRegisterFromCorpus(
  store: CallCorpusStore | null,
  viewStartDate: string,
  viewEndDate: string,
  dateFilterColumn: RegisterDateFilterColumn = 'dtrndate'
): boolean {
  return corpusMatchesDateWindow(store, viewStartDate, viewEndDate, dateFilterColumn);
}

export function getCorpusCallsArray(store: CallCorpusStore | null = callCorpusStore): Record<string, unknown>[] {
  if (!store) return [];
  return Array.from(store.calls.values());
}

function rowsToMap(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    const mapped = mapCachedRowToRegisterRow(raw);
    const key = getCallIdentityKey(mapped);
    if (key) map.set(key, mapped);
  }
  return map;
}

export function applyCorpusSnapshot(
  cacheKey: string,
  rows: Record<string, unknown>[],
  opts?: { source?: CallCorpusStore['source']; truncated?: boolean; lastSyncedAt?: number }
): CallCorpusStore {
  const calls = rowsToMap(rows);
  const now = Date.now();
  const next: CallCorpusStore = {
    calls,
    cacheKey,
    fetchedAt: now,
    lastSyncedAt: opts?.lastSyncedAt ?? now,
    status: 'hydrated',
    source: opts?.source ?? 'network',
    truncated: opts?.truncated ?? false,
  };
  setCallCorpusStore(next);
  indexRegisterRowsWithSerial(Array.from(calls.values()));
  notifyCorpusListeners();
  return next;
}

export function mergeCorpusDelta(
  deltas: Record<string, unknown>[],
  cacheKey?: string
): { addedCount: number; updatedCount: number } {
  const store = callCorpusStore;
  if (!store || (cacheKey && store.cacheKey !== cacheKey)) {
    return { addedCount: 0, updatedCount: 0 };
  }

  let addedCount = 0;
  let updatedCount = 0;
  for (const raw of deltas) {
    const mapped = mapCachedRowToRegisterRow(raw);
    const key = getCallIdentityKey(mapped);
    if (!key) continue;
    if (store.calls.has(key)) updatedCount++;
    else addedCount++;
    store.calls.set(key, mapped);
  }

  store.lastSyncedAt = Date.now();
  store.status = 'hydrated';
  indexRegisterRowsWithSerial(deltas);
  notifyCorpusListeners();
  setCallCorpusStore({ ...store });
  return { addedCount, updatedCount };
}

export async function restoreCorpusFromIndexedDB(
  expectedCacheKey: string
): Promise<CallCorpusStore | null> {
  const meta = await readCorpusMeta();
  if (!meta || meta.cacheKey !== expectedCacheKey || meta.callCount === 0) {
    return null;
  }
  const rows = await readCorpusCallsLazy();
  if (rows.length === 0) return null;
  return applyCorpusSnapshot(expectedCacheKey, rows, {
    source: 'indexeddb',
    truncated: meta.truncated,
    lastSyncedAt: meta.lastSyncedAt,
  });
}

export async function persistCorpusToIndexedDB(store: CallCorpusStore): Promise<void> {
  const calls = getCorpusCallsArray(store);
  const meta: CorpusMeta = {
    cacheKey: store.cacheKey,
    fetchedAt: store.fetchedAt,
    lastSyncedAt: store.lastSyncedAt,
    callCount: calls.length,
    truncated: store.truncated,
  };
  await persistCorpusCalls(calls, meta);
}

export async function persistCorpusDeltaToIndexedDB(
  deltas: Record<string, unknown>[],
  store: CallCorpusStore
): Promise<void> {
  await patchCorpusCallsInDB(deltas, {
    cacheKey: store.cacheKey,
    lastSyncedAt: store.lastSyncedAt,
    callCount: store.calls.size,
    truncated: store.truncated,
  });
}

export function setCorpusRefreshing(refreshing: boolean) {
  const store = callCorpusStore;
  if (!store) return;
  setCallCorpusStore({
    ...store,
    status: refreshing ? 'refreshing' : store.calls.size > 0 ? 'hydrated' : 'idle',
  });
  notifyCorpusListeners();
}

export function notifyCorpusRegisterDelta(records: unknown[], syncTime: Date) {
  notifyRegisterDelta(records, syncTime);
}

export function syncDistributionCacheFromCorpus(store: CallCorpusStore | null = callCorpusStore): void {
  if (!store || store.calls.size === 0) return;
  const allCalls = getCorpusCallsArray(store);
  const nextCache: DistributionDataCache = {
    allCalls,
    dbBranches: distributionDataCache?.dbBranches ?? [],
    cacheKey: store.cacheKey,
    fetchedAt: store.fetchedAt,
    lastSyncedAt: store.lastSyncedAt,
  };
  setDistributionDataCache(nextCache);
}

function sortCorpusRows(
  rows: Record<string, unknown>[],
  dateFilterColumn: RegisterDateFilterColumn
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const dateA = new Date(String(registerRowDateValue(a, dateFilterColumn) ?? 0)).getTime();
    const dateB = new Date(String(registerRowDateValue(b, dateFilterColumn) ?? 0)).getTime();
    return dateB - dateA;
  });
}

export function deriveRegisterPageFromCorpus(
  store: CallCorpusStore | null,
  cacheKey: string,
  filterParts: RegisterViewFilterParts,
  page: number,
  pageLimit: number,
  viewDate?: CorpusViewDateFilter
): { rows: Record<string, unknown>[]; total: number } | null {
  if (!store || store.cacheKey !== cacheKey || store.calls.size === 0) return null;

  let filtered = getCorpusCallsArray(store).filter((row) =>
    registerRowMatchesViewFilters(row, filterParts)
  );
  if (viewDate) {
    filtered = filterCorpusCallsByViewDate(filtered, viewDate);
  }
  filtered = sortCorpusRows(filtered, viewDate?.dateFilterColumn ?? 'dtrndate');

  const start = (page - 1) * pageLimit;
  return {
    rows: filtered.slice(start, start + pageLimit),
    total: filtered.length,
  };
}
