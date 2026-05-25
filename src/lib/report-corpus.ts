import type { RegisterViewFilterParts } from '@/lib/report-filters';
import {
  getCallIdentityKey,
  indexRegisterRowsWithSerial,
  notifyRegisterDelta,
} from '@/lib/report-sync';
import { mapCachedRowToRegisterRow, registerRowMatchesViewFilters } from '@/lib/report-search';
import {
  persistCorpusCalls,
  patchCorpusCallsInDB,
  readCorpusCallsLazy,
  readCorpusMeta,
  type CorpusMeta,
} from '@/lib/report-corpus-storage';
import type { CallCorpusStore, DistributionDataCache } from '@/lib/report-data-store';
import {
  setCallCorpusStore,
  callCorpusStore,
  setDistributionDataCache,
  distributionDataCache,
} from '@/lib/report-data-store';

export const CLIENT_CORPUS_PAGE_THRESHOLD = 5000;

/** Align with /api/report/corpus in-memory cache TTL. */
export const CORPUS_SERVER_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

export type CorpusLoadStatus = CallCorpusStore['status'];

type CorpusListener = () => void;
const corpusListeners = new Set<CorpusListener>();

export function subscribeCorpus(listener: CorpusListener): () => void {
  corpusListeners.add(listener);
  return () => corpusListeners.delete(listener);
}

function notifyCorpusListeners() {
  corpusListeners.forEach((l) => l());
}

/** Corpus is keyed by date window only; call-type and view filters are applied client-side. */
export function buildCorpusCacheKey(startDate: string, endDate: string, _callTypes?: string[]): string {
  return `${startDate}|${endDate}`;
}

export function corpusMatchesDateWindow(
  store: CallCorpusStore | null,
  startDate: string,
  endDate: string
): boolean {
  return !!store && store.cacheKey === buildCorpusCacheKey(startDate, endDate) && store.calls.size > 0;
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
  store: CallCorpusStore | null = callCorpusStore
): Record<string, unknown>[] {
  if (!store?.calls.size) return [];
  return getCorpusCallsArray(store).filter((row) => registerRowMatchesViewFilters(row, filterParts));
}

export function canServeRegisterFromCorpus(
  store: CallCorpusStore | null,
  startDate: string,
  endDate: string
): boolean {
  return corpusMatchesDateWindow(store, startDate, endDate);
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

export function deriveRegisterPageFromCorpus(
  store: CallCorpusStore | null,
  cacheKey: string,
  filterParts: RegisterViewFilterParts,
  page: number,
  pageLimit: number
): { rows: Record<string, unknown>[]; total: number } | null {
  if (!store || store.cacheKey !== cacheKey || store.calls.size === 0) return null;

  const filtered = getCorpusCallsArray(store)
    .filter((row) => registerRowMatchesViewFilters(row, filterParts))
    .sort((a, b) => {
      const dateA = new Date(String(a.callsdtrndate ?? 0)).getTime();
      const dateB = new Date(String(b.callsdtrndate ?? 0)).getTime();
      return dateB - dateA;
    });

  const start = (page - 1) * pageLimit;
  return {
    rows: filtered.slice(start, start + pageLimit),
    total: filtered.length,
  };
}
