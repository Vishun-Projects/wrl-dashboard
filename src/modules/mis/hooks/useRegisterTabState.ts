'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { feedback } from '@/lib/ui/feedback';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import {
  normalizeRegisterPageSize,
  readStoredRegisterPageSize,
  resolveViewCallTypesParam,
  resolveSummaryOfficeIdsParam,
} from '@/modules/mis/services/filters';
import { type RegisterTableColumnKey } from '@/modules/mis/register';
import type { TableSortState } from '@/lib/ui/table-sort';
import {
  normalizeRegisterSummary,
  type RegisterSummary,
  type RegisterViewFilterParts,
} from '@/modules/mis/services/search';
import { globalReportCache } from '@/modules/mis/services/data-store';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { type RegisterPageCacheEntry } from '@/modules/mis/services/report-page-helpers';
import { useRegisterIdbBootstrap } from './useRegisterIdbBootstrap';
import { useRegisterDeltaSync } from './useRegisterDeltaSync';
import { useRegisterDataFetch } from './useRegisterDataFetch';

interface UseRegisterTabStateProps {
  supabase: SupabaseClient;
  activeTab: string;
  misAccess: { register: boolean };
  summaryData: any[];
  setSummaryData: React.Dispatch<React.SetStateAction<any[]>>;
  summaryDataRef: React.MutableRefObject<any[]>;
  accountsData: any[];
  setAccountsData: React.Dispatch<React.SetStateAction<any[]>>;
  accountsDataRef: React.MutableRefObject<any[]>;
  globalHeadcount: number;
  setGlobalHeadcount: React.Dispatch<React.SetStateAction<number>>;
  globalHeadcountRef: React.MutableRefObject<number>;
  resolveSummaryAgingStr: (applied?: any) => string;
  buildSummaryQueryKey: (params: any) => string;
  lastSummaryQueryKeyRef: React.MutableRefObject<string | null>;
  refreshClientImportOverlayRef: React.MutableRefObject<
    (scope: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >;
  filterRegion: string[];
  filterAccount: string[];
}

export function useRegisterTabState({
  supabase: _supabase,
  activeTab,
  misAccess,
  summaryData,
  setSummaryData,
  summaryDataRef,
  accountsData,
  setAccountsData,
  accountsDataRef,
  globalHeadcount,
  setGlobalHeadcount,
  globalHeadcountRef,
  resolveSummaryAgingStr,
  buildSummaryQueryKey,
  lastSummaryQueryKeyRef,
  refreshClientImportOverlayRef: _refreshClientImportOverlayRef,
  filterRegion,
  filterAccount,
}: UseRegisterTabStateProps) {
  const {
    selectedCallTypes,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
    repairFilter,
    debouncedSearch,
    debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedRegion,
    selectedAccount,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    dateRange,
    dateFilterColumn,
    agingAsOf,
    getAppliedFiltersSnapshot,
    setReportError,
    offices,
    ensureCorpusLoaded,
    distributionCalls,
    lastSyncedAt,
    runBackgroundSync,
    setStatesList,
    setCitiesList,
    setBranchesList,
    setFranchiseesList,
    setTechniciansList,
    techniciansList,
  } = useReportFilters();

  const [dbInitialized, setDbInitialized] = useState(!!globalReportCache);
  const [data, setData] = useState<any[]>(globalReportCache?.data || []);
  const [total, setTotal] = useState<number>(globalReportCache?.total || 0);
  const [page, setPage] = useState(globalReportCache?.page || 1);
  const [limit, setLimit] = useState(readStoredRegisterPageSize);
  const [registerSort, setRegisterSort] = useState<TableSortState<RegisterTableColumnKey> | null>(null);
  const [registerSummary, setRegisterSummary] = useState<RegisterSummary | null>(
    normalizeRegisterSummary(globalReportCache?.registerSummary)
  );
  const [loading, setLoading] = useState(!globalReportCache);
  const [, setLoadingPage] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(globalReportCache?.lastRefreshed || null);

  const fetchControllerRef = useRef<AbortController | null>(null);
  const registerAuthFailedRef = useRef(false);
  const registerPagesCacheRef = useRef<Map<string, Map<number, RegisterPageCacheEntry>>>(new Map());
  const lastKnownRegisterTotalRef = useRef<number>(globalReportCache?.total || 0);
  const lastRegisterListQueryKeyRef = useRef<string | null>(null);
  const lastAppliedFilterSnapshotRef = useRef<string | null>(null);

  const dataRef = useRef(data);
  const totalRef = useRef(total);
  const registerSummaryRef = useRef(registerSummary);
  const registerViewFilterRef = useRef<RegisterViewFilterParts>({
    search: debouncedSearch,
    pincodeSearch: debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedRegion,
    selectedAccount,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    technicianRoster: [],
    selectedCallTypes,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
    repairFilter,
  });

  dataRef.current = data;
  totalRef.current = total;
  registerSummaryRef.current = registerSummary;

  const technicianRoster = useMemo(
    () =>
      techniciansList.map((t: { ncode: string; vname: string }) => ({
        value: String(t.ncode),
        label: String(t.vname || t.ncode),
      })),
    [techniciansList]
  );

  registerViewFilterRef.current = {
    search: debouncedSearch,
    pincodeSearch: debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedRegion,
    selectedAccount,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    technicianRoster,
    selectedCallTypes,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
    repairFilter,
  };

  const summaryOfficeIdsParam = useMemo(
    () => resolveSummaryOfficeIdsParam(offices, selectedBranch, selectedFranchisee),
    [offices, selectedBranch, selectedFranchisee]
  );
  const registerOfficeIdsParam = 'All';

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

  // 1. Bootstrap DB/cache on reload
  useRegisterIdbBootstrap({
    dbInitialized,
    setDbInitialized,
    setData,
    setSummaryData,
    setAccountsData,
    setGlobalHeadcount,
    setTotal,
    setRegisterSummary,
    setLastRefreshed,
    setLoading,
    dateRange,
    dateFilterColumn,
    selectedCallTypes,
    selectedOfficeIds,
    filterRegion,
    filterAccount,
    agingAsOf,
    limit,
    registerOfficeIdsParam,
    viewCallTypesParam,
    summaryOfficeIdsParam,
    lastSummaryQueryKeyRef,
    lastRegisterListQueryKeyRef,
    lastKnownRegisterTotalRef,
    lastAppliedFilterSnapshotRef,
    resolveSummaryAgingStr,
    buildSummaryQueryKey,
  });

  // 2. Fetch orchestrator
  const {
    fetchData,
    persistCurrentCache,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    runRegisterFilterLoad,
  } = useRegisterDataFetch({
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
    registerPagesCacheRef: registerPagesCacheRef as any,
    lastKnownRegisterTotalRef,
    lastRegisterListQueryKeyRef,
    registerViewFilterRef,
    registerOfficeIdsParam,
    summaryOfficeIdsParam,
    lastSummaryQueryKeyRef,
    getAppliedFiltersSnapshot,
    ensureCorpusLoaded,
    activeTab,
    misAccess,
    dbInitialized,
  });

  // 3. Real-time Pusher updates
  useRegisterDeltaSync({
    setData,
    setTotal,
    setRegisterSummary,
    setSummaryData,
    setAccountsData,
    setLastRefreshed,
    dataRef,
    totalRef,
    registerSummaryRef,
    summaryDataRef,
    accountsDataRef,
    globalHeadcountRef,
    registerViewFilterRef,
    registerPagesCacheRef: registerPagesCacheRef as any,
    persistCurrentCache,
    lastSyncedAt,
  });

  const handleRegisterPageSizeChange = useCallback(
    (nextRaw: number) => {
      const next = normalizeRegisterPageSize(nextRaw);
      if (next === limit) return;
      setLimit(next);
      try {
        localStorage.setItem('report_register_page_size', String(next));
      } catch {
        /* ignore */
      }
      registerPagesCacheRef.current.clear();
      setPage(1);
      if (applyRegisterFromSharedCalls(1, next)) {
        setLoading(false);
        return;
      }
      if (applyRegisterFromCorpus(1, next)) {
        setLoading(false);
        return;
      }
      void fetchData(1, { pageLimit: next });
    },
    [limit, applyRegisterFromSharedCalls, applyRegisterFromCorpus, fetchData, setLoading]
  );

  const handleRegisterSortChange = useCallback(
    (next: TableSortState<RegisterTableColumnKey>) => {
      setRegisterSort(next);
      registerPagesCacheRef.current.clear();
      setPage(1);
      void fetchData(1, { skipCache: true, sortOverride: next });
    },
    [fetchData]
  );

  const fetchDelta = useCallback(async () => {
    if (readRegisterFromPostgresClient()) {
      registerPagesCacheRef.current.clear();
      const ok = await fetchData(1, { skipCache: true });
      if (ok === false) {
        feedback.actionFailed('Failed to refresh report data');
      } else if (ok !== null) {
        feedback.refreshed();
      }
      return;
    }
    await runBackgroundSync({ showToast: true });
  }, [fetchData, runBackgroundSync]);

  return {
    dbInitialized,
    setDbInitialized,
    loading,
    setLoading,
    data,
    setData,
    total,
    setTotal,
    page,
    setPage,
    limit,
    setLimit,
    registerSort,
    setRegisterSort,
    registerSummary,
    setRegisterSummary,
    lastRefreshed,
    setLastRefreshed,
    technicianRoster,
    fetchData,
    fetchDelta,
    handleRegisterPageSizeChange,
    handleRegisterSortChange,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    registerPagesCacheRef,
    lastRegisterListQueryKeyRef,
    lastKnownRegisterTotalRef,
    registerViewFilterRef,
    runRegisterFilterLoad,
  };
}
