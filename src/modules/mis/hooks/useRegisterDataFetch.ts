'use client';

import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  appendRegisterListFilters,
  appliedFilterPartsFromSnapshot,
  isBaseRegisterPersistFilter,
  type RegisterPageSize,
  toDateString,
  type ReportDateRange,
} from '@/modules/mis/services/filters';
import {
  type RegisterTableColumnKey,
  logRegisterBulk,
} from '@/modules/mis/register';
import type { TableSortState } from '@/lib/ui/table-sort';
import { MAX_CLIENT_CORPUS_DAYS, type RegisterDateFilterColumn } from '@/sql/trhcalls/query';
import {
  findCallsInIndexedDb,
  findCallsInMemoryCaches,
  isIdentifierLookupSearch,
  isTrnLikeSearch,
  summarizeRegisterRows,
  normalizeRegisterSummary,
  type RegisterSummary,
} from '@/modules/mis/services/search';
import {
  globalReportCache,
  setGlobalReportCache,
  distributionDataCache,
  setDistributionDataCache,
  callCorpusStore,
} from '@/modules/mis/services/data-store';
import { indexRegisterRowsWithSerial } from '@/modules/mis/services/sync';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  adoptCorpusStoreForScope,
  corpusStoreCoversFetchScope,
  deriveRegisterPageFromCorpus,
  getFilteredCorpusCalls,
} from '@/modules/mis/services/corpus';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { deriveRegisterPageFromCalls, deriveRegisterView } from '@/modules/mis/services/register-view';
import { ensurePortalAuditCache } from '@/modules/mis/services/portal-cache';
import {
  corpusSpanDays,
  getCallsFromDB,
  registerPageCacheGet,
  registerPageCachePut,
  reportPerf,
  saveCallsToDB,
  saveMeta,
} from '@/modules/mis/services/report-page-helpers';
import { buildRegisterListQueryKeyFromViewFilters } from '@/modules/mis/services/register-query-builders';
import { signOutAndGoToLogin } from '@/lib/auth/sign-out-client';
import {
  isSessionExpiredResponse,
  showSessionExpired,
} from '@/lib/auth/session-expired-client';

interface UseRegisterDataFetchProps {
  limit: RegisterPageSize;
  registerSort: TableSortState<RegisterTableColumnKey> | null;
  debouncedSearch: string;
  debouncedPincodeSearch: string;
  viewCallTypesParam: string;
  dateRange: ReportDateRange;
  dateFilterColumn: RegisterDateFilterColumn;
  agingAsOf: string;
  selectedOfficeIds: any[];
  filterRegion: string[];
  filterAccount: string[];
  summaryData: any[];
  accountsData: any[];
  globalHeadcount: number;
  selectedCallTypes: any[];
  selectedState: string[];
  selectedCity: string[];
  selectedRegion: string[];
  selectedAccount: string[];
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedTechnician: string[];
  selectedStatus: string[];
  priorityFilter: string[];
  portalFilter: string[];
  repairFilter: string[];
  distributionCalls: any[];

  setData: (data: any[]) => void;
  setTotal: (total: number) => void;
  setPage: (page: number) => void;
  setRegisterSummary: (summary: any) => void;
  setSummaryData: React.Dispatch<React.SetStateAction<any[]>>;
  setAccountsData: React.Dispatch<React.SetStateAction<any[]>>;
  setGlobalHeadcount: React.Dispatch<React.SetStateAction<number>>;
  setStatesList: (list: any[]) => void;
  setCitiesList: (list: any[]) => void;
  setBranchesList: (list: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
  setFranchiseesList: (list: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
  setTechniciansList: (list: any[]) => void;
  setReportError: (err: string) => void;
  setLoading: (loading: boolean) => void;
  setLoadingPage: (page: number | null) => void;
  setLastRefreshed: (date: Date) => void;

  fetchControllerRef: React.MutableRefObject<AbortController | null>;
  registerAuthFailedRef: React.MutableRefObject<boolean>;
  registerPagesCacheRef: React.MutableRefObject<Map<string, any>>;
  lastKnownRegisterTotalRef: React.MutableRefObject<number>;
  lastRegisterListQueryKeyRef: React.MutableRefObject<string | null>;
  registerViewFilterRef: React.MutableRefObject<any>;

  registerOfficeIdsParam: string;
  summaryOfficeIdsParam: string;
  lastSummaryQueryKeyRef: React.MutableRefObject<string | null>;
  getAppliedFiltersSnapshot: () => any;
  appliedRevision: number;
  ensureCorpusLoaded: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>;

  activeTab: string;
  misAccess: { register: boolean };
  dbInitialized: boolean;
}

export function useRegisterDataFetch({
  limit,
  registerSort,
  debouncedSearch,
  debouncedPincodeSearch,
  viewCallTypesParam,
  dateRange,
  dateFilterColumn,
  agingAsOf,
  selectedOfficeIds,
  filterRegion,
  filterAccount,
  summaryData,
  accountsData,
  globalHeadcount,
  selectedCallTypes,
  selectedState,
  selectedCity,
  selectedRegion,
  selectedAccount,
  selectedBranch,
  selectedFranchisee,
  selectedTechnician,
  selectedStatus,
  priorityFilter,
  portalFilter,
  repairFilter,
  distributionCalls,

  setData,
  setTotal,
  setPage,
  setRegisterSummary,
  setSummaryData,
  setAccountsData,
  setGlobalHeadcount,
  setStatesList,
  setCitiesList,
  setBranchesList,
  setFranchiseesList,
  setTechniciansList,
  setReportError,
  setLoading,
  setLoadingPage,
  setLastRefreshed,

  fetchControllerRef,
  registerAuthFailedRef,
  registerPagesCacheRef,
  lastKnownRegisterTotalRef,
  lastRegisterListQueryKeyRef,
  registerViewFilterRef,

  registerOfficeIdsParam,
  summaryOfficeIdsParam,
  lastSummaryQueryKeyRef,
  getAppliedFiltersSnapshot,
  appliedRevision,
  ensureCorpusLoaded,

  activeTab,
  misAccess,
  dbInitialized,
}: UseRegisterDataFetchProps) {
  
  const lastAppliedFilterSnapshotRef = useRef<string | null>(null);
  const filterEffectInFlightRef = useRef(false);

  const currentViewFilters = useMemo(
    () => ({
      search: debouncedSearch,
      pincodeSearch: debouncedPincodeSearch,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
    }),
    [
      debouncedSearch,
      debouncedPincodeSearch,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
    ]
  );

  const persistCurrentCache = useCallback(
    async (
      calls: any[],
      sumData: any[],
      accData: any[],
      globHeadcount: number,
      tot: number,
      regSummary: any,
      lastRefreshedDate: Date
    ) => {
      try {
        const isBase = isBaseRegisterPersistFilter({
          search: debouncedSearch,
          pincodeSearch: debouncedPincodeSearch,
          selectedState,
          selectedCity,
          selectedRegion,
          selectedAccount,
          selectedBranch,
          selectedFranchisee,
          selectedTechnician,
          selectedCallTypes,
          selectedOfficeIds,
          selectedStatus,
          priorityFilter,
          portalFilter,
          repairFilter,
          filterAccount: Array.isArray(filterAccount) ? filterAccount : [],
          filterRegion,
        });

        if (isBase) {
          try {
            localStorage.setItem(
              'report_fortnight_cache',
              JSON.stringify({
                data: calls.slice(0, 100),
                total: tot,
                summaryData: sumData,
                accountsData: accData,
                globalHeadcount: globHeadcount,
              })
            );
          } catch {
            /* ignore */
          }

          const officeIdsParam = summaryOfficeIdsParam;
          const startDateStr = toDateString(dateRange.start);
          const endDateStr = toDateString(dateRange.end);

          await saveCallsToDB(calls);
          await saveMeta('cacheParams', {
            startDate: startDateStr,
            endDate: endDateStr,
            dateFilterColumn,
            officeIds: officeIdsParam,
            callTypes: viewCallTypesParam,
            lastRefreshed: lastRefreshedDate.toISOString(),
            total: tot,
            registerSummary: regSummary,
            summaryData: sumData,
            accountsData: accData,
            globalHeadcount: globHeadcount,
            summaryQueryKey: lastSummaryQueryKeyRef.current ?? globalReportCache?.summaryQueryKey,
          });
        }
      } catch {
        /* ignore */
      }
    },
    [
      debouncedSearch,
      debouncedPincodeSearch,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedCallTypes,
      selectedOfficeIds,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
      filterAccount,
      filterRegion,
      summaryOfficeIdsParam,
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      viewCallTypesParam,
      lastSummaryQueryKeyRef,
    ]
  );

  const applyRegisterFromCorpus = useCallback(
    (pageNum = 1, pageLimit: RegisterPageSize = limit): boolean => {
      if (readRegisterFromPostgresClient()) return false;
      if (repairFilter.length > 0) return false;
      const applied = getAppliedFiltersSnapshot();
      const range = applied?.dateRange ?? dateRange;
      const dateCol = applied?.dateFilterColumn ?? dateFilterColumn;
      const startDateStr = toDateString(range.start);
      const endDateStr = toDateString(range.end);
      const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateCol);
      const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateCol);

      let store = callCorpusStore;
      if (store?.calls.size && store.cacheKey !== corpusKey) {
        if (corpusStoreCoversFetchScope(store, startDateStr, endDateStr, dateCol)) {
          store = adoptCorpusStoreForScope(store, startDateStr, endDateStr, dateCol);
        }
      }
      if (!store?.calls.size || store.cacheKey !== corpusKey) {
        return false;
      }

      const viewFilters = applied
        ? appliedFilterPartsFromSnapshot(applied)
        : registerViewFilterRef.current;
      registerViewFilterRef.current = viewFilters;
      const derived = deriveRegisterPageFromCorpus(
        store,
        corpusKey,
        viewFilters,
        pageNum,
        pageLimit,
        viewDateFilter
      );
      if (!derived) return false;

      const allFiltered = getFilteredCorpusCalls(viewFilters, store, viewDateFilter);
      const summary = summarizeRegisterRows(allFiltered);
      const queryKey = buildRegisterListQueryKeyFromViewFilters({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        startDateStr,
        endDateStr,
        dateFilterColumn: dateCol,
        viewFilters,
        agingAsOf: agingAsOf || '',
        pageLimit,
      });

      setData(derived.rows);
      setTotal(derived.total);
      setPage(pageNum);
      setRegisterSummary(summary);
      setLastRefreshed(store.lastSyncedAt ? new Date(store.lastSyncedAt) : new Date());
      lastRegisterListQueryKeyRef.current = queryKey;
      lastKnownRegisterTotalRef.current = derived.total;
      registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
        data: derived.rows,
        total: derived.total,
        registerSummary: summary,
      });

      const refreshedDate = store.lastSyncedAt ? new Date(store.lastSyncedAt) : new Date();
      setGlobalReportCache({
        data: derived.rows,
        summaryData: globalReportCache?.summaryData ?? summaryData,
        accountsData: globalReportCache?.accountsData ?? accountsData,
        globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
        total: derived.total,
        registerSummary: summary,
        page: pageNum,
        search: viewFilters.search || '',
        pincodeSearch: viewFilters.pincodeSearch || '',
        selectedCallTypes,
        selectedState,
        selectedCity,
        selectedRegion,
        selectedAccount,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
        selectedStatus,
        priorityFilter,
        portalFilter,
        repairFilter,
        selectedOfficeIds,
        agingAsOf,
        dateRange,
        dateFilterColumn,
        filterRegion,
        filterAccount,
        lastRefreshed: refreshedDate,
        summaryQueryKey: globalReportCache?.summaryQueryKey,
      });

      return true;
    },
    [
      dateRange,
      dateFilterColumn,
      getAppliedFiltersSnapshot,
      viewCallTypesParam,
      agingAsOf,
      limit,
      selectedCallTypes,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
      selectedOfficeIds,
      filterRegion,
      filterAccount,
      summaryData,
      accountsData,
      globalHeadcount,
      setData,
      setTotal,
      setPage,
      setRegisterSummary,
      setLastRefreshed,
      lastRegisterListQueryKeyRef,
      lastKnownRegisterTotalRef,
      registerPagesCacheRef,
      registerOfficeIdsParam,
    ]
  );

  const getSharedCallsForScope = useCallback(() => {
    if (!readRegisterFromPostgresClient()) return null;
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
    if (distributionDataCache?.cacheKey !== corpusKey) return null;
    const calls =
      (distributionDataCache.allCalls?.length ?? 0) > 0
        ? distributionDataCache.allCalls
        : distributionCalls.length > 0
        ? distributionCalls
        : null;
    if (!calls?.length) return null;
    return { calls, corpusKey, startDateStr, endDateStr };
  }, [dateRange.start, dateRange.end, dateFilterColumn, distributionCalls]);

  const applyRegisterFromSharedCalls = useCallback(
    (pageNum = 1, pageLimit: RegisterPageSize = limit): boolean => {
      if (!readRegisterFromPostgresClient()) return false;
      if (repairFilter.length > 0) return false;
      const applyStart = performance.now();
      const scope = getSharedCallsForScope();
      if (!scope) {
        logRegisterBulk('register view MISS (no shared bulk cache)', {
          page: pageNum,
          cacheKey: buildCorpusCacheKey(
            toDateString(dateRange.start),
            toDateString(dateRange.end),
            dateFilterColumn
          ),
        });
        return false;
      }

      const { calls, startDateStr, endDateStr, corpusKey } = scope;
      const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
      const viewFilters = registerViewFilterRef.current;
      const derived = deriveRegisterPageFromCalls(
        calls,
        viewFilters,
        pageNum,
        pageLimit,
        viewDateFilter
      );
      const { summary } = deriveRegisterView(calls, viewFilters, viewDateFilter);
      const queryKey = buildRegisterListQueryKeyFromViewFilters({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        startDateStr,
        endDateStr,
        dateFilterColumn,
        viewFilters,
        agingAsOf: agingAsOf || '',
        pageLimit,
      });

      setData(derived.rows);
      setTotal(derived.total);
      setPage(pageNum);
      setRegisterSummary(summary);
      setLastRefreshed(
        distributionDataCache?.lastSyncedAt
          ? new Date(distributionDataCache.lastSyncedAt)
          : new Date()
      );
      lastRegisterListQueryKeyRef.current = queryKey;
      lastKnownRegisterTotalRef.current = derived.total;
      registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
        data: derived.rows,
        total: derived.total,
        registerSummary: summary,
      });

      const refreshedDate = distributionDataCache?.lastSyncedAt
        ? new Date(distributionDataCache.lastSyncedAt)
        : new Date();
      setGlobalReportCache({
        data: derived.rows,
        summaryData: globalReportCache?.summaryData ?? summaryData,
        accountsData: globalReportCache?.accountsData ?? accountsData,
        globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
        total: derived.total,
        registerSummary: summary,
        page: pageNum,
        search: viewFilters.search || '',
        pincodeSearch: viewFilters.pincodeSearch || '',
        selectedCallTypes,
        selectedState,
        selectedCity,
        selectedRegion,
        selectedAccount,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
        selectedStatus,
        priorityFilter,
        portalFilter,
        repairFilter,
        selectedOfficeIds,
        agingAsOf,
        dateRange,
        dateFilterColumn,
        filterRegion,
        filterAccount,
        lastRefreshed: refreshedDate,
        summaryQueryKey: globalReportCache?.summaryQueryKey,
      });

      logRegisterBulk('register view CACHE HIT (client filter)', {
        page: pageNum,
        rows: derived.rows.length,
        total: derived.total,
        bulkRows: calls.length,
        cacheKey: corpusKey,
        applyMs: Number((performance.now() - applyStart).toFixed(1)),
      });

      if (
        ((viewFilters.search || '').trim() || (viewFilters.pincodeSearch || '').trim()) &&
        derived.total === 0
      ) {
        return false;
      }

      return true;
    },
    [
      getSharedCallsForScope,
      dateFilterColumn,
      viewCallTypesParam,
      agingAsOf,
      limit,
      selectedCallTypes,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
      selectedOfficeIds,
      dateRange,
      filterRegion,
      filterAccount,
      summaryData,
      accountsData,
      globalHeadcount,
      setData,
      setTotal,
      setPage,
      setRegisterSummary,
      setLastRefreshed,
      lastRegisterListQueryKeyRef,
      lastKnownRegisterTotalRef,
      registerPagesCacheRef,
      registerOfficeIdsParam,
    ]
  );

  const fetchData = useCallback(
    async (
      p = 1,
      opts?: {
        silent?: boolean;
        skipCache?: boolean;
        forceCorpus?: boolean;
        searchOverride?: string;
        pincodeOverride?: string;
        pageLimit?: RegisterPageSize;
        sortOverride?: TableSortState<RegisterTableColumnKey> | null;
      }
    ) => {
      const pageSize: RegisterPageSize = opts?.pageLimit ?? limit;
      const activeSort = opts?.sortOverride ?? registerSort;
      let succeeded = false;
      const opStart = performance.now();
      const opId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const hadPriorRequest = !!fetchControllerRef.current;
      reportPerf('fetchData', 'start', opStart, {
        opId,
        page: p,
        opts: opts || {},
        hadPriorRequest,
        why: hadPriorRequest
          ? 'Aborts any in-flight report request (pagination/filter race).'
          : 'Cold start for this invocation.',
      });

      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort();
      }

      const officeIdsParam = registerOfficeIdsParam;
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);

      const searchForUrl = opts?.searchOverride !== undefined ? opts.searchOverride : debouncedSearch;
      const pincodeForUrl =
        opts?.pincodeOverride !== undefined ? opts.pincodeOverride : debouncedPincodeSearch;
      let skipCache = !!opts?.skipCache;
      const searchActive = !!(searchForUrl?.trim() || pincodeForUrl?.trim());
      if (searchActive) {
        skipCache = true;
      }

      const queryKey = buildRegisterListQueryKeyFromViewFilters({
        officeIdsParam,
        callTypesParam: viewCallTypesParam,
        startDateStr,
        endDateStr,
        dateFilterColumn,
        viewFilters: {
          ...currentViewFilters,
          search: searchForUrl || '',
          pincodeSearch: pincodeForUrl || '',
        },
        agingAsOf: agingAsOf || '',
        pageLimit: pageSize,
        sortBy: activeSort?.key,
        sortDir: activeSort?.dir,
      });

      const localCorpusMatchesAppliedRange =
        !globalReportCache ||
        (toDateString(globalReportCache.dateRange.start) === startDateStr &&
          toDateString(globalReportCache.dateRange.end) === endDateStr);

      if (
        p === 1 &&
        searchForUrl?.trim() &&
        isIdentifierLookupSearch(searchForUrl) &&
        !isTrnLikeSearch(searchForUrl) &&
        !pincodeForUrl &&
        !skipCache &&
        localCorpusMatchesAppliedRange
      ) {
        let cachedHits = findCallsInMemoryCaches(searchForUrl);
        if (cachedHits.length === 0) {
          cachedHits = await findCallsInIndexedDb(searchForUrl, getCallsFromDB);
        }

        const appliedSnap = getAppliedFiltersSnapshot();
        if (cachedHits.length > 0 && appliedSnap) {
          const viewDate = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
          const { filteredCalls } = deriveRegisterView(
            cachedHits,
            appliedFilterPartsFromSnapshot(appliedSnap),
            viewDate
          );
          cachedHits = filteredCalls;
        }

        if (cachedHits.length > 0) {
          const summary = summarizeRegisterRows(cachedHits);
          setData(cachedHits);
          setTotal(cachedHits.length);
          setPage(1);
          setRegisterSummary(summary);
          setLastRefreshed(new Date());
          lastRegisterListQueryKeyRef.current = queryKey;
          if (globalReportCache) {
            globalReportCache.search = searchForUrl || '';
            globalReportCache.pincodeSearch = pincodeForUrl || '';
            globalReportCache.data = cachedHits;
            globalReportCache.total = cachedHits.length;
            globalReportCache.registerSummary = summary;
          }
          if (!opts?.silent) {
            setLoading(false);
            setLoadingPage(null);
          }
          reportPerf('fetchData', 'identifier search cache HIT (no network)', opStart, {
            opId,
            rows: cachedHits.length,
            why: 'Matched ID/TRN/call ID/serial in shared/distribution/IndexedDB before API.',
          });
          return true;
        }

        skipCache = true;
        reportPerf('fetchData', 'identifier search cache MISS → database', opStart, {
          opId,
          search: searchForUrl,
          why: 'Identifier not in local caches; force API lookup.',
        });
      }

      if (!skipCache) {
        const cached = registerPageCacheGet(registerPagesCacheRef.current, queryKey, p);
        if (cached) {
          setData(cached.data);
          setTotal(cached.total);
          setPage(p);
          if (cached.registerSummary !== undefined) {
            setRegisterSummary(cached.registerSummary ?? null);
          }
          if (cached.summaryData) setSummaryData(cached.summaryData);
          if (cached.accountsData) setAccountsData(cached.accountsData);
          if (cached.globalHeadcount !== undefined) setGlobalHeadcount(cached.globalHeadcount);
          if (!opts?.silent) {
            setLoading(false);
            setLoadingPage(null);
          }
          setLastRefreshed(new Date());
          lastRegisterListQueryKeyRef.current = queryKey;
          reportPerf('fetchData', 'session page cache HIT (no network)', opStart, {
            opId,
            page: p,
            rows: cached.data.length,
            why: 'In-memory Map for this queryKey+page; avoids waiting on SQL/API again.',
          });
          return true;
        }
      }

      if (!searchActive && !readRegisterFromPostgresClient() && repairFilter.length === 0) {
        const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
        const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
        const hasCorpus =
          (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) ||
          corpusStoreCoversFetchScope(callCorpusStore, startDateStr, endDateStr, dateFilterColumn);
        if (!hasCorpus || opts?.forceCorpus) {
          await ensureCorpusLoaded({
            silent: !!opts?.silent,
            force: !!opts?.forceCorpus,
          });
        }
        await ensurePortalAuditCache();
        const viewFilters = registerViewFilterRef.current;
        let corpusStore = callCorpusStore;
        if (corpusStore?.calls.size && corpusStore.cacheKey !== corpusKey) {
          if (corpusStoreCoversFetchScope(corpusStore, startDateStr, endDateStr, dateFilterColumn)) {
            corpusStore = adoptCorpusStoreForScope(
              corpusStore,
              startDateStr,
              endDateStr,
              dateFilterColumn
            );
          }
        }
        const corpusDerived = deriveRegisterPageFromCorpus(
          corpusStore,
          corpusKey,
          viewFilters,
          p,
          pageSize,
          viewDateFilter
        );
        if (corpusDerived) {
          const allFiltered = getFilteredCorpusCalls(viewFilters, corpusStore, viewDateFilter);
          const summary = p === 1 ? summarizeRegisterRows(allFiltered) : undefined;
          setData(corpusDerived.rows);
          setTotal(corpusDerived.total);
          setPage(p);
          if (p === 1 && summary) {
            setRegisterSummary(summary);
          }
          if (!opts?.silent) {
            setLoading(false);
            setLoadingPage(null);
          }
          setLastRefreshed(
            corpusStore?.lastSyncedAt ? new Date(corpusStore.lastSyncedAt) : new Date()
          );
          lastRegisterListQueryKeyRef.current = queryKey;
          lastKnownRegisterTotalRef.current = corpusDerived.total;
          registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
            data: corpusDerived.rows,
            total: corpusDerived.total,
            registerSummary: summary ?? undefined,
          });
          if (p === 1) {
            const page2 = deriveRegisterPageFromCorpus(
              callCorpusStore,
              corpusKey,
              viewFilters,
              2,
              pageSize,
              viewDateFilter
            );
            if (page2) {
              registerPageCachePut(registerPagesCacheRef.current, queryKey, 2, {
                data: page2.rows,
                total: page2.total,
                registerSummary: summary ?? undefined,
              });
            }
          }
          reportPerf('fetchData', 'corpus client slice HIT (no network)', opStart, {
            opId,
            page: p,
            rows: corpusDerived.rows.length,
            total: corpusDerived.total,
          });
          return true;
        }

        const spanDays = corpusSpanDays(startDateStr, endDateStr);
        if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
          reportPerf('fetchData', 'corpus-only window — skip /api/report fallback', opStart, {
            opId,
            corpusCalls: callCorpusStore?.calls.size ?? 0,
            why: 'Date range is served from in-memory corpus; paginated SQL register is not used.',
          });
          if (!opts?.silent) {
            setLoading(false);
            setLoadingPage(null);
          }
          return true;
        }
      }

      const controller = new AbortController();
      fetchControllerRef.current = controller;

      if (!opts?.silent) {
        setLoading(true);
        setLoadingPage(p);
      } else {
        setLoadingPage(null);
      }

      const appendRegisterFilters = (basePath: string) => {
        const appliedRepair = getAppliedFiltersSnapshot()?.repairFilter;
        return appendRegisterListFilters(basePath, {
          searchForUrl,
          pincodeForUrl,
          startDateStr,
          endDateStr,
          dateFilterColumn,
          sortBy: activeSort?.key,
          sortDir: activeSort?.dir,
          selectedState,
          selectedCity,
          selectedRegion,
          selectedAccount,
          selectedBranch,
          selectedFranchisee,
          selectedTechnician,
          selectedStatus,
          priorityFilter,
          portalFilter,
          repairFilter: appliedRepair?.length ? appliedRepair : repairFilter,
        });
      };

      try {
        const requestConfig = { withCredentials: true as const, signal: controller.signal };

        const prefetchAdjacentPages = (currentPage: number) => {
          const prefetchSessionStart = performance.now();
          reportPerf('prefetch', 'adjacent pages scheduled', prefetchSessionStart, {
            opId,
            centerPage: currentPage,
            why: 'Background GET for page±1 with fetchTotals=false to warm session cache.',
          });
          const totalSnap = lastKnownRegisterTotalRef.current;
          const storePrefetched = (
            pageNum: number,
            payload: { data?: any[]; total?: number },
            summary?: RegisterSummary | null
          ) => {
            const rows = payload.data || [];
            const tot =
              payload.total !== undefined && payload.total !== null ? payload.total : totalSnap;
            registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
              data: rows,
              total: tot,
              registerSummary: summary,
            });
          };

          const maxPage = totalSnap > 0 ? Math.ceil(totalSnap / pageSize) : 1;
          const nextPage = currentPage + 1;
          if (nextPage <= maxPage) {
            const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
            const viewDateFilter = buildCorpusViewDateFilter(
              startDateStr,
              endDateStr,
              dateFilterColumn
            );
            const fromCorpus = deriveRegisterPageFromCorpus(
              callCorpusStore,
              corpusKey,
              registerViewFilterRef.current,
              nextPage,
              pageSize,
              viewDateFilter
            );
            if (fromCorpus) {
              storePrefetched(nextPage, { data: fromCorpus.rows, total: fromCorpus.total });
              return;
            }
            const nextUrl = appendRegisterFilters(
              `/api/report?page=${nextPage}&limit=${pageSize}&fetchTotals=false&officeId=${officeIdsParam}&callType=${viewCallTypesParam}`
            );
            axios
              .get(nextUrl, requestConfig)
              .then((res) => {
                storePrefetched(nextPage, res.data);
                reportPerf('prefetch', `page ${nextPage} response stored`, prefetchSessionStart, {
                  opId,
                  rows: (res.data?.data || []).length,
                  sincePrefetchScheduleMs: Number(
                    (performance.now() - prefetchSessionStart).toFixed(1)
                  ),
                });
              })
              .catch(() => {});
          }
        };

        let url = appendRegisterFilters(
          `/api/report?page=${p}&limit=${pageSize}&fetchTotals=false&officeId=${officeIdsParam}&callType=${viewCallTypesParam}`
        );

        const newDate = new Date();

        if (p === 1) {
          const tBeforeRegister = performance.now();
          const regRes = await axios.get(url, requestConfig);
          const tAfterRegister = performance.now();
          reportPerf('fetchData', 'network: /api/report (page 1) complete', opStart, {
            opId,
            registerRows: (regRes.data.data || []).length,
            axiosMs: Number((tAfterRegister - tBeforeRegister).toFixed(1)),
            why: 'Register-only fetch; summary tab data loaded lazily on tab switch.',
          });

          const regTotal = regRes.data.total ?? lastKnownRegisterTotalRef.current;

          const pageRows = regRes.data.data || [];
          indexRegisterRowsWithSerial(pageRows as Record<string, unknown>[]);

          setData(pageRows);
          setTotal(regTotal);
          setPage(p);
          if (regRes.data.summary) {
            setRegisterSummary(normalizeRegisterSummary(regRes.data.summary));
          }

          if (regRes.data.statesList) setStatesList(regRes.data.statesList);
          if (regRes.data.citiesList) setCitiesList(regRes.data.citiesList);
          if (regRes.data.branchesList) setBranchesList(regRes.data.branchesList);
          if (regRes.data.franchiseesList) setFranchiseesList(regRes.data.franchiseesList);
          if (regRes.data.techniciansList) setTechniciansList(regRes.data.techniciansList);

          const loadTotalsLazy = async () => {
            try {
              const totalsPath = readRegisterFromPostgresClient()
                ? `/api/report/totals?officeId=${officeIdsParam}&callType=${viewCallTypesParam}`
                : `/api/report?page=1&limit=1&fetchTotals=true&officeId=${officeIdsParam}&callType=${viewCallTypesParam}`;
              const totalsUrl = appendRegisterFilters(totalsPath);
              const totalsRes = await axios.get(totalsUrl, { withCredentials: true });
              const lazyTotal = totalsRes.data.total ?? 0;
              lastKnownRegisterTotalRef.current = lazyTotal;
              setTotal(lazyTotal);
              if (totalsRes.data.summary) {
                setRegisterSummary(normalizeRegisterSummary(totalsRes.data.summary));
              }
              registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
                data: pageRows,
                total: lazyTotal,
                registerSummary: totalsRes.data.summary ?? null,
                summaryData: globalReportCache?.summaryData,
                accountsData: globalReportCache?.accountsData,
                globalHeadcount: globalReportCache?.globalHeadcount,
              });
              if (globalReportCache) {
                globalReportCache.total = lazyTotal;
                globalReportCache.registerSummary = totalsRes.data.summary ?? null;
              }
            } catch {
              /* totals are non-blocking */
            }
          };
          void loadTotalsLazy();

          registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
            data: regRes.data.data,
            total: regTotal,
            registerSummary: regRes.data.summary || null,
            summaryData: globalReportCache?.summaryData,
            accountsData: globalReportCache?.accountsData,
            globalHeadcount: globalReportCache?.globalHeadcount,
          });

          setGlobalReportCache({
            data: regRes.data.data,
            summaryData: globalReportCache?.summaryData || summaryData,
            accountsData: globalReportCache?.accountsData || accountsData,
            globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
            total: regTotal,
            page: p,
            search: searchForUrl || '',
            pincodeSearch: pincodeForUrl || '',
            selectedOfficeIds,
            dateRange,
            dateFilterColumn,
            filterRegion,
            filterAccount,
            selectedCallTypes,
            registerSummary: regRes.data.summary || null,
            lastRefreshed: newDate,
            agingAsOf,
            selectedStatus,
            priorityFilter,
            portalFilter,
            repairFilter,
            selectedState,
            selectedCity,
            selectedRegion,
            selectedAccount,
            selectedBranch,
            selectedFranchisee,
            selectedTechnician,
          });

          persistCurrentCache(
            regRes.data.data,
            globalReportCache?.summaryData || summaryData,
            globalReportCache?.accountsData || accountsData,
            globalReportCache?.globalHeadcount ?? globalHeadcount,
            regTotal,
            regRes.data.summary || null,
            newDate
          );

          lastRegisterListQueryKeyRef.current = queryKey;
        } else {
          url += `&fetchTotals=false`;
          const tBeforePage = performance.now();
          const regRes = await axios.get(url, requestConfig);
          const tAfterPage = performance.now();
          reportPerf(
            'fetchData',
            'network: /api/report (page>1, fetchTotals=false) complete',
            opStart,
            {
              opId,
              parallelAxiosMs: Number((tAfterPage - tBeforePage).toFixed(1)),
              registerRows: (regRes.data.data || []).length,
              why: 'Lighter query without full totals block; totals reused from lastKnownRegisterTotalRef when API omits total.',
            }
          );
          const newChunk = regRes.data.data || [];
          indexRegisterRowsWithSerial(newChunk as Record<string, unknown>[]);
          const apiTotal = regRes.data.total;
          const effectiveTotal =
            apiTotal !== undefined && apiTotal !== null
              ? apiTotal
              : lastKnownRegisterTotalRef.current;

          if (apiTotal !== undefined && apiTotal !== null) {
            lastKnownRegisterTotalRef.current = apiTotal;
          }

          setData(newChunk);
          if (apiTotal !== undefined && apiTotal !== null) {
            setTotal(apiTotal);
          }
          setPage(p);
          if (regRes.data.summary !== undefined) {
            setRegisterSummary(normalizeRegisterSummary(regRes.data.summary));
          }

          registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
            data: newChunk,
            total: effectiveTotal,
            registerSummary: regRes.data.summary ?? null,
          });

          if (globalReportCache) {
            globalReportCache.data = newChunk;
            globalReportCache.total = effectiveTotal;
            globalReportCache.page = p;
            globalReportCache.registerSummary = regRes.data.summary ?? null;
            globalReportCache.lastRefreshed = newDate;
            globalReportCache.search = searchForUrl || '';
            globalReportCache.pincodeSearch = pincodeForUrl || '';

            if (distributionDataCache) {
              setDistributionDataCache({
                ...distributionDataCache,
                lastSyncedAt: newDate.getTime(),
              });
            }

            persistCurrentCache(
              globalReportCache.data,
              globalReportCache.summaryData,
              globalReportCache.accountsData,
              globalReportCache.globalHeadcount,
              globalReportCache.total,
              globalReportCache.registerSummary,
              newDate
            );
          }
        }

        prefetchAdjacentPages(p);
        succeeded = true;
      } catch (err: any) {
        const aborted =
          axios.isCancel(err) ||
          err?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          err?.name === 'AbortError';
        if (aborted) {
          reportPerf('fetchData', 'aborted (axios cancel)', opStart, {
            opId,
            why: 'AbortController: newer fetchData or navigation cancelled this request.',
          });
          return null;
        }
        const unauthorized = axios.isAxiosError(err) && err.response?.status === 401;
        if (unauthorized) {
          registerAuthFailedRef.current = true;
          fetchControllerRef.current?.abort();
          if (
            axios.isAxiosError(err) &&
            isSessionExpiredResponse(err.response?.status ?? 0, err.response?.data)
          ) {
            showSessionExpired();
          } else {
            void signOutAndGoToLogin();
          }
          return false;
        }
        reportPerf('fetchData', 'request failed (error toast)', opStart, {
          opId,
          message: err?.message || String(err),
        });
        setReportError('Failed to fetch report data');
        return false;
      } finally {
        const isActiveController = fetchControllerRef.current === controller;
        if (isActiveController) {
          if (!opts?.silent) {
            setLoading(false);
          }
          setLoadingPage(null);
          if (succeeded) {
            setLastRefreshed(new Date());
          }
        }
        reportPerf(
          'fetchData',
          isActiveController ? 'done (this request owned controller)' : 'done (superseded)',
          opStart,
          {
            opId,
            isActiveController,
            silent: !!opts?.silent,
            why: isActiveController
              ? 'Spinner cleared; last successful or failed path for this opId.'
              : 'Another fetchData replaced fetchControllerRef before finally ran.',
          }
        );
      }
      return succeeded;
    },
    [
      limit,
      registerSort,
      debouncedSearch,
      debouncedPincodeSearch,
      viewCallTypesParam,
      dateRange,
      dateFilterColumn,
      currentViewFilters,
      agingAsOf,
      getAppliedFiltersSnapshot,
      selectedState,
      selectedCity,
      selectedRegion,
      selectedAccount,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      repairFilter,
      registerOfficeIdsParam,
      filterRegion,
      filterAccount,
      summaryData,
      accountsData,
      globalHeadcount,
      setData,
      setTotal,
      setPage,
      setRegisterSummary,
      setStatesList,
      setCitiesList,
      setBranchesList,
      setFranchiseesList,
      setTechniciansList,
      setReportError,
      persistCurrentCache,
      fetchControllerRef,
      registerAuthFailedRef,
      lastKnownRegisterTotalRef,
      registerPagesCacheRef,
      lastRegisterListQueryKeyRef,
      registerViewFilterRef,
      setLoading,
      setLoadingPage,
      setLastRefreshed,
      ensureCorpusLoaded,
    ]
  );

  const runRegisterFilterLoad = useCallback(async (opts?: { force?: boolean }) => {
    if (!dbInitialized || activeTab !== 'register' || !misAccess.register) return;

    const applied = getAppliedFiltersSnapshot();
    if (!applied) return;
    registerViewFilterRef.current = appliedFilterPartsFromSnapshot(applied);
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const appliedDateColumn = applied.dateFilterColumn;
    const searchOrPinActive = !!(applied.search?.trim() || applied.pincodeSearch?.trim());
    const filterSnapshot = JSON.stringify({
      startDateStr,
      endDateStr,
      dateFilterColumn: appliedDateColumn,
      selectedCallTypes: applied.selectedCallTypes,
      selectedOfficeIds: applied.selectedOfficeIds,
      selectedState: applied.selectedState,
      selectedCity: applied.selectedCity,
      selectedRegion: applied.selectedRegion,
      selectedAccount: applied.selectedAccount,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedTechnician: applied.selectedTechnician,
      selectedStatus: applied.selectedStatus,
      priorityFilter: applied.priorityFilter,
      portalFilter: applied.portalFilter,
      repairFilter: applied.repairFilter,
      agingAsOf,
      debouncedSearch: applied.search || '',
      debouncedPincodeSearch: applied.pincodeSearch || '',
    });

    if (!opts?.force && filterSnapshot === lastAppliedFilterSnapshotRef.current) {
      return;
    }
    if (filterEffectInFlightRef.current) {
      return;
    }

    const prevScopeKey = globalReportCache
      ? buildCorpusCacheKey(
          toDateString(globalReportCache.dateRange.start),
          toDateString(globalReportCache.dateRange.end),
          globalReportCache.dateFilterColumn || 'dtrndate'
        )
      : null;
    const currentScopeKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);

    filterEffectInFlightRef.current = true;
    const f0 = performance.now();
    reportPerf('filterEffect', 'trigger register load', f0, {
      p: 1,
      searchOrPinActive,
      isRegisterPostgresClient: readRegisterFromPostgresClient(),
    });

    try {
      if (!searchOrPinActive && prevScopeKey !== currentScopeKey) {
        registerPagesCacheRef.current.clear();
      }

      if (applyRegisterFromSharedCalls(1, limit)) {
        setLoading(false);
        lastAppliedFilterSnapshotRef.current = filterSnapshot;
        return;
      }

      if (applyRegisterFromCorpus(1, limit)) {
        setLoading(false);
        lastAppliedFilterSnapshotRef.current = filterSnapshot;
        return;
      }

      await fetchData(1, { skipCache: searchOrPinActive });
      lastAppliedFilterSnapshotRef.current = filterSnapshot;
    } finally {
      filterEffectInFlightRef.current = false;
      reportPerf('filterEffect', 'register load done', f0);
    }
  }, [
    dbInitialized,
    activeTab,
    misAccess.register,
    getAppliedFiltersSnapshot,
    agingAsOf,
    limit,
    applyRegisterFromSharedCalls,
    applyRegisterFromCorpus,
    fetchData,
    setLoading,
    registerViewFilterRef,
    registerPagesCacheRef,
  ]);

  useEffect(() => {
    void runRegisterFilterLoad();
  }, [runRegisterFilterLoad, appliedRevision]);

  return {
    fetchData,
    persistCurrentCache,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    runRegisterFilterLoad,
  };
}
