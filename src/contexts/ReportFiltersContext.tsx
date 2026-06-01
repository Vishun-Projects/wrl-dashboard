'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  buildDraftFilterSnapshot,
  buildFranchiseeOptions,
  type DraftFilterOverrides,
  defaultDateRange,
  filterCallsCSR,
  filterSnapshotsEqual,
  findBreakdownCallType,
  isAnyFilterActive,
  migrateStringFilter,
  joinFilterParam,
  reportFilterSnapshotFromCache,
  snapshotAfterRemovingActiveFilterChip,
  REPORT_FILTER_SEARCH_DEBOUNCE_MS,
  toDateString,
  type ActiveFilterChipDescriptor,
  type ReportDateRange,
  type ReportFilterSnapshot,
} from '@/lib/report-filters';
import {
  REGISTER_DATE_FILTER_OPTIONS,
  resolveRegisterDateSqlColumn,
  MAX_CLIENT_CORPUS_DAYS,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls-query';
import {
  distributionDataCache,
  globalReportCache,
  callCorpusStore,
  setDistributionDataCache,
  setCallCorpusStore,
  type DistributionDataCache,
  type CallCorpusStore,
} from '@/lib/report-data-store';
import {
  applyCorpusSnapshot,
  adoptCorpusStoreForScope,
  buildCorpusCacheKey,
  corpusStoreCoversFetchScope,
  resolveCorpusFetchScope,
  splitCalendarMonths,
  getCorpusCallsArray,
  mergeCorpusDelta,
  persistCorpusDeltaToIndexedDB,
  persistCorpusToIndexedDB,
  restoreCorpusFromIndexedDB,
  setCorpusRefreshing,
  subscribeCorpus,
  syncDistributionCacheFromCorpus,
  notifyCorpusRegisterDelta,
} from '@/lib/report-corpus';
import { ensurePortalAuditCache } from '@/lib/report-portal-cache';
import {
  readCallsFromPostgresClient,
  readRegisterFromPostgresClient,
} from '@/lib/read-model/client-flags';
import { fetchAllRegisterRowsForExport, logRegisterBulk } from '@/lib/register-export-fetch';
import { sanitizeUserFacingMessage } from '@/lib/user-facing-errors';
import { createChunkedFetchAuth } from '@/lib/supabase-chunked-fetch';
import { persistSharedRegisterCache, readSharedRegisterCache, SHARED_REGISTER_CACHE_VERSION } from '@/lib/report-corpus-storage';

let cachedReportResources: { offices: unknown[]; callTypes: string[] } | null = null;
let reportResourcesInflight: Promise<{ offices: unknown[]; callTypes: string[] }> | null = null;

function formatCorpusLastSync(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
import {
  formatSyncTimestamp,
  REPORT_SYNC_BUFFER_MS,
} from '@/lib/report-sync';

type ReportFiltersContextValue = {
  search: string;
  setSearch: (v: string) => void;
  /** Applied after {@link REPORT_FILTER_SEARCH_DEBOUNCE_MS} idle; drives fetches and heavy filters. */
  debouncedSearch: string;
  pincodeSearch: string;
  setPincodeSearch: (v: string) => void;
  debouncedPincodeSearch: string;
  /** True while typed search/pincode has not yet been debounced. */
  isSearchDebouncing: boolean;
  /** Apply current search / pincode immediately (e.g. Enter key). */
  flushSearchDebounce: () => void;
  dateRange: ReportDateRange;
  setDateRange: (v: ReportDateRange) => void;
  dateFilterColumn: RegisterDateFilterColumn;
  setDateFilterColumn: (v: RegisterDateFilterColumn) => void;
  dateFilterColumnOptions: typeof REGISTER_DATE_FILTER_OPTIONS;
  selectedOfficeIds: string[];
  setSelectedOfficeIds: (v: string[]) => void;
  selectedCallTypes: string[];
  setSelectedCallTypes: (v: string[]) => void;
  selectedStatus: string[];
  setSelectedStatus: (v: string[]) => void;
  priorityFilter: string[];
  setPriorityFilter: (v: string[]) => void;
  portalFilter: string[];
  setPortalFilter: (v: string[]) => void;
  selectedState: string[];
  setSelectedState: (v: string[]) => void;
  selectedCity: string[];
  setSelectedCity: (v: string[]) => void;
  selectedBranch: string[];
  setSelectedBranch: (v: string[]) => void;
  selectedFranchisee: string[];
  setSelectedFranchisee: (v: string[]) => void;
  selectedTechnician: string[];
  setSelectedTechnician: (v: string[]) => void;
  offices: any[];
  callTypes: string[];
  statesList: any[];
  setStatesList: (v: any[]) => void;
  citiesList: any[];
  setCitiesList: (v: any[]) => void;
  techniciansList: any[];
  setTechniciansList: (v: any[]) => void;
  showOfficeDropdown: boolean;
  setShowOfficeDropdown: (v: boolean) => void;
  tempSelectedOfficeIds: string[];
  setTempSelectedOfficeIds: (v: string[]) => void;
  officeSearch: string;
  setOfficeSearch: (v: string) => void;
  handleStatesChange: (values: string[]) => void;
  handleBranchesChange: (values: string[]) => void;
  handleCitiesChange: (values: string[]) => void;
  clearAllFilters: () => void;
  isAnyFilterActive: boolean;
  callTypeOptions: { value: string; label: string }[];
  stateOptions: { value: string; label: string }[];
  cityOptions: { value: string; label: string }[];
  technicianOptions: { value: string; label: string }[];
  branchesList: Array<{ ncode: string; vcompanyname: string; call_count?: number }>;
  franchiseesList: Array<{ ncode: string; vcompanyname: string; call_count?: number }>;
  setBranchesList: (v: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
  setFranchiseesList: (v: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
  distributionCalls: any[];
  distributionBranches: any[];
  distributionLoading: boolean;
  fetchDistributionData: (force?: boolean) => Promise<void>;
  ensureSharedCallsLoaded: (force?: boolean) => Promise<void>;
  ensureCorpusLoaded: (opts?: { force?: boolean; silent?: boolean }) => Promise<void>;
  rehydrateDistributionFromCache: () => void;
  runBackgroundSync: (opts?: { showToast?: boolean }) => Promise<void>;
  lastSyncedAt: Date | null;
  syncInProgress: boolean;
  corpusStatus: CallCorpusStore['status'];
  corpusLoading: boolean;
  corpusTick: number;
  corpusTruncated: boolean;
  corpusCallCount: number;
  syncCascadeOptionsFromCalls: (calls: any[]) => void;
  resourcesLoaded: boolean;
  /** Committed filters used for queries and bulk loads; null until first Apply (or cache restore). */
  appliedFilters: ReportFilterSnapshot | null;
  /** Bumps when {@link applyFilters} runs — use as a fetch effect dependency. */
  appliedRevision: number;
  /** Commits draft → applied synchronously (ref) and React state; returns the new snapshot. */
  applyFilters: (overrides?: DraftFilterOverrides) => ReportFilterSnapshot;
  /** Commits a full snapshot to draft + applied (e.g. active filter chip ×). */
  applyFilterSnapshot: (snapshot: ReportFilterSnapshot) => void;
  /** Remove one applied chip and commit immediately. */
  removeActiveFilterChip: (chip: ActiveFilterChipDescriptor) => void;
  /** Latest applied snapshot (sync — safe to use immediately after {@link applyFilters}). */
  getAppliedFiltersSnapshot: () => ReportFilterSnapshot | null;
  hasPendingFilterChanges: boolean;
  getAppliedDateStrings: () => { startDateStr: string; endDateStr: string } | null;
  getAppliedDateFilterColumn: () => RegisterDateFilterColumn | null;
};

const ReportFiltersContext = createContext<ReportFiltersContextValue | null>(null);

function routeNeedsCorpusPreload(pathname: string | null): boolean {
  if (!pathname) return false;
  if (readCallsFromPostgresClient()) return false;
  return pathname.startsWith('/report');
}

function routeNeedsDistributionPreload(pathname: string | null): boolean {
  return routeNeedsCorpusPreload(pathname);
}

export function ReportFiltersProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const pathname = usePathname();
  const needsCorpusPreload = routeNeedsCorpusPreload(pathname);
  const needsDistributionPreload = needsCorpusPreload;

  const [search, setSearch] = useState(globalReportCache?.search || '');
  const [pincodeSearch, setPincodeSearch] = useState(globalReportCache?.pincodeSearch || '');
  const [debouncedSearch, setDebouncedSearch] = useState(globalReportCache?.search || '');
  const [debouncedPincodeSearch, setDebouncedPincodeSearch] = useState(
    globalReportCache?.pincodeSearch || ''
  );

  useEffect(() => {
    if (!search.trim()) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, REPORT_FILTER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!pincodeSearch.trim()) {
      setDebouncedPincodeSearch('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedPincodeSearch(pincodeSearch);
    }, REPORT_FILTER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pincodeSearch]);

  const flushSearchDebounce = useCallback(() => {
    setDebouncedSearch(search);
    setDebouncedPincodeSearch(pincodeSearch);
  }, [search, pincodeSearch]);

  const isSearchDebouncing =
    search !== debouncedSearch || pincodeSearch !== debouncedPincodeSearch;
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => {
    if (globalReportCache) {
      return {
        start: new Date(globalReportCache.dateRange.start),
        end: new Date(globalReportCache.dateRange.end),
        label: globalReportCache.dateRange.label || 'This Month',
      };
    }
    return defaultDateRange();
  });
  const [dateFilterColumn, setDateFilterColumn] = useState<RegisterDateFilterColumn>(() =>
    resolveRegisterDateSqlColumn(globalReportCache?.dateFilterColumn)
  );
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>(globalReportCache?.selectedOfficeIds || []);
  const [selectedCallTypes, setSelectedCallTypes] = useState<string[]>(globalReportCache?.selectedCallTypes || []);
  const [selectedStatus, setSelectedStatus] = useState<string[]>(migrateStringFilter(globalReportCache?.selectedStatus));
  const [priorityFilter, setPriorityFilter] = useState<string[]>(migrateStringFilter(globalReportCache?.priorityFilter));
  const [portalFilter, setPortalFilter] = useState<string[]>(migrateStringFilter(globalReportCache?.portalFilter));
  const [selectedState, setSelectedState] = useState<string[]>(migrateStringFilter(globalReportCache?.selectedState));
  const [selectedCity, setSelectedCity] = useState<string[]>(migrateStringFilter(globalReportCache?.selectedCity));
  const [selectedBranch, setSelectedBranch] = useState<string[]>(
    migrateStringFilter(globalReportCache?.selectedBranch)
  );
  const [selectedFranchisee, setSelectedFranchisee] = useState<string[]>(
    migrateStringFilter(globalReportCache?.selectedFranchisee)
  );
  const [selectedTechnician, setSelectedTechnician] = useState<string[]>(migrateStringFilter(globalReportCache?.selectedTechnician));

  const [offices, setOffices] = useState<any[]>([]);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [statesList, setStatesList] = useState<any[]>([]);
  const [citiesList, setCitiesList] = useState<any[]>([]);
  const [techniciansList, setTechniciansList] = useState<any[]>([]);
  const [branchesList, setBranchesList] = useState<Array<{ ncode: string; vcompanyname: string; call_count?: number }>>([]);
  const [franchiseesList, setFranchiseesList] = useState<Array<{ ncode: string; vcompanyname: string; call_count?: number }>>([]);
  const [showOfficeDropdown, setShowOfficeDropdown] = useState(false);
  const [tempSelectedOfficeIds, setTempSelectedOfficeIds] = useState<string[]>([]);
  const [officeSearch, setOfficeSearch] = useState('');
  const [resourcesLoaded, setResourcesLoaded] = useState(false);

  const [distributionCalls, setDistributionCalls] = useState<any[]>(distributionDataCache?.allCalls || []);
  const [distributionBranches, setDistributionBranches] = useState<any[]>(distributionDataCache?.dbBranches || []);
  const [distributionLoading, setDistributionLoading] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(() => {
    if (distributionDataCache?.lastSyncedAt) return new Date(distributionDataCache.lastSyncedAt);
    if (globalReportCache?.lastRefreshed) return globalReportCache.lastRefreshed;
    return null;
  });
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [corpusTick, setCorpusTick] = useState(0);
  const syncInFlightRef = useRef(false);
  const corpusLoadInFlightRef = useRef<Promise<void> | null>(null);
  const sharedRegisterLoadInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  /** Date windows bulk-loaded for Postgres register/distribution this session. */
  const sharedRegisterSatisfiedKeysRef = useRef<Set<string>>(new Set());
  const corpusAbortRef = useRef<AbortController | null>(null);
  const corpusGenerationRef = useRef(0);
  const corpusHydratedAtRef = useRef<number | null>(null);
  const corpusIdbRestoreInflightRef = useRef<Map<string, Promise<CallCorpusStore | null>>>(new Map());
  /** Date windows hydrated this session — never re-fetch from network unless force. */
  const corpusSatisfiedKeysRef = useRef<Set<string>>(new Set());
  const defaultCallTypesAppliedRef = useRef(
    (globalReportCache?.selectedCallTypes?.length ?? 0) > 0
  );

  const [appliedFilters, setAppliedFilters] = useState<ReportFilterSnapshot | null>(() =>
    globalReportCache ? reportFilterSnapshotFromCache(globalReportCache) : null
  );
  const [appliedRevision, setAppliedRevision] = useState(() =>
    globalReportCache ? 1 : 0
  );
  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;

  const draftStateRef = useRef({
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    selectedStatus,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
  });
  draftStateRef.current = {
    search,
    pincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    selectedStatus,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
  };

  const applyFilterSnapshot = useCallback((snapshot: ReportFilterSnapshot) => {
    setSearch(snapshot.search);
    setPincodeSearch(snapshot.pincodeSearch);
    setDebouncedSearch(snapshot.search);
    setDebouncedPincodeSearch(snapshot.pincodeSearch);
    setDateRange(snapshot.dateRange);
    setDateFilterColumn(snapshot.dateFilterColumn);
    setSelectedOfficeIds([...snapshot.selectedOfficeIds]);
    setSelectedCallTypes([...snapshot.selectedCallTypes]);
    setSelectedStatus([...snapshot.selectedStatus]);
    setPriorityFilter([...snapshot.priorityFilter]);
    setPortalFilter([...snapshot.portalFilter]);
    setSelectedState([...snapshot.selectedState]);
    setSelectedCity([...snapshot.selectedCity]);
    setSelectedBranch([...snapshot.selectedBranch]);
    setSelectedFranchisee([...snapshot.selectedFranchisee]);
    setSelectedTechnician([...snapshot.selectedTechnician]);
    appliedFiltersRef.current = snapshot;
    setAppliedFilters(snapshot);
    setAppliedRevision((r) => r + 1);
  }, []);

  const applyFilters = useCallback((overrides?: DraftFilterOverrides): ReportFilterSnapshot => {
    const input = { ...draftStateRef.current, ...overrides };
    const snapshot = buildDraftFilterSnapshot(input);
    applyFilterSnapshot(snapshot);
    return snapshot;
  }, [applyFilterSnapshot]);

  const removeActiveFilterChip = useCallback(
    (chip: ActiveFilterChipDescriptor) => {
      const applied = appliedFiltersRef.current;
      if (!applied) return;
      const next = snapshotAfterRemovingActiveFilterChip(applied, chip);
      applyFilterSnapshot(next);
    },
    [applyFilterSnapshot]
  );

  const draftSnapshot = useMemo(
    () =>
      buildDraftFilterSnapshot({
        search,
        pincodeSearch,
        dateRange,
        dateFilterColumn,
        selectedOfficeIds,
        selectedCallTypes,
        selectedStatus,
        priorityFilter,
        portalFilter,
        selectedState,
        selectedCity,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
      }),
    [
      search,
      pincodeSearch,
      dateRange,
      dateFilterColumn,
      selectedOfficeIds,
      selectedCallTypes,
      selectedStatus,
      priorityFilter,
      portalFilter,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
    ]
  );

  const hasPendingFilterChanges =
    isSearchDebouncing || !filterSnapshotsEqual(draftSnapshot, appliedFilters);

  const getAppliedFiltersSnapshot = useCallback(
    (): ReportFilterSnapshot | null => appliedFiltersRef.current,
    []
  );

  const getAppliedDateStrings = useCallback((): { startDateStr: string; endDateStr: string } | null => {
    const applied = appliedFiltersRef.current;
    if (!applied) return null;
    return {
      startDateStr: toDateString(applied.dateRange.start),
      endDateStr: toDateString(applied.dateRange.end),
    };
  }, []);

  const getAppliedDateFilterColumn = useCallback((): RegisterDateFilterColumn | null => {
    return appliedFiltersRef.current?.dateFilterColumn ?? null;
  }, []);

  useEffect(() => subscribeCorpus(() => setCorpusTick((n) => n + 1)), []);

  const corpusSnapshot = callCorpusStore;
  const corpusStatus = corpusSnapshot?.status ?? 'idle';
  const corpusTruncated = corpusSnapshot?.truncated ?? false;
  const corpusCallCount = corpusSnapshot?.calls.size ?? 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (cachedReportResources) {
          if (!cancelled) {
            setOffices(cachedReportResources.offices);
            setCallTypes(cachedReportResources.callTypes);
            if (!defaultCallTypesAppliedRef.current && cachedReportResources.callTypes.length > 0) {
              const breakdown = findBreakdownCallType(cachedReportResources.callTypes);
              if (breakdown) {
                setSelectedCallTypes((prev) => (prev.length > 0 ? prev : [breakdown]));
              }
              defaultCallTypesAppliedRef.current = true;
            }
            setResourcesLoaded(true);
          }
          return;
        }

        if (!reportResourcesInflight) {
          reportResourcesInflight = (async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const headers = session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {};
            const [officeRes, typesRes] = await Promise.all([
              axios.get('/api/offices', { headers }),
              axios.get('/api/report/call-types', { headers }),
            ]);
            const payload = {
              offices: officeRes.data || [],
              callTypes: typesRes.data || [],
            };
            cachedReportResources = payload;
            return payload;
          })();
        }

        const payload = await reportResourcesInflight;
        if (cancelled) return;
        setOffices(payload.offices);
        setCallTypes(payload.callTypes);
        if (!defaultCallTypesAppliedRef.current && payload.callTypes.length > 0) {
          const breakdown = findBreakdownCallType(payload.callTypes);
          if (breakdown) {
            setSelectedCallTypes((prev) => (prev.length > 0 ? prev : [breakdown]));
          }
          defaultCallTypesAppliedRef.current = true;
        }
      } catch {
        // offices/call types are optional for some views
      } finally {
        if (!cancelled) setResourcesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const handleStatesChange = useCallback((values: string[]) => {
    setSelectedState(values);
    if (values.length === 0) {
      setSelectedCity([]);
    } else {
      setSelectedCity((prev) =>
        prev.filter((cityName) => {
          const city = citiesList.find((c) => c.ncode === cityName || c.vname === cityName);
          return city && values.includes(city.nstate);
        })
      );
    }
    setSelectedBranch([]);
    setSelectedFranchisee([]);
    setSelectedTechnician([]);
  }, [citiesList]);

  const handleCitiesChange = useCallback((values: string[]) => {
    setSelectedCity(values);
    setSelectedBranch([]);
    setSelectedFranchisee([]);
    setSelectedTechnician([]);
  }, []);

  const handleBranchesChange = useCallback((values: string[]) => {
    setSelectedBranch(values);
    setSelectedOfficeIds([]);
    setSelectedFranchisee((prev) => {
      if (values.length === 0) return prev;
      const valid = new Set(
        buildFranchiseeOptions(offices, values, franchiseesList).map((option) => option.value)
      );
      return prev.filter((franchiseeId) => valid.has(franchiseeId));
    });
  }, [franchiseesList, offices]);

  const clearAllFilters = useCallback(() => {
    setSelectedState([]);
    setSelectedCity([]);
    setSelectedBranch([]);
    setSelectedFranchisee([]);
    setSelectedTechnician([]);
    setSearch('');
    setPincodeSearch('');
    setDebouncedSearch('');
    setDebouncedPincodeSearch('');
    setSelectedCallTypes([]);
    setSelectedOfficeIds([]);
    setSelectedStatus([]);
    setPriorityFilter([]);
    setPortalFilter([]);
  }, []);

  const syncCascadeOptionsFromCalls = useCallback((calls: any[]) => {
    if (!calls.length) {
      setStatesList([]);
      setCitiesList([]);
      setTechniciansList([]);
      return;
    }

    const baseCriteria = {
      state: selectedState,
      city: selectedCity,
      selectedBranch,
      selectedFranchisee,
      technician: selectedTechnician,
      pincodeSearch,
    };

    const statesFiltered = filterCallsCSR(calls, baseCriteria, 'state');
    const stateCounts: Record<string, { vname: string; call_count: number }> = {};
    statesFiltered.forEach((c) => {
      if (!c.state) return;
      stateCounts[c.state] = stateCounts[c.state] || { vname: c.state, call_count: 0 };
      stateCounts[c.state].call_count++;
    });
    setStatesList(Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname)));

    const citiesFiltered = filterCallsCSR(calls, baseCriteria, 'city');
    const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
    citiesFiltered.forEach((c) => {
      if (!c.city) return;
      cityCounts[c.city] = cityCounts[c.city] || { ncode: c.city, vname: c.city, nstate: c.state || '', call_count: 0 };
      cityCounts[c.city].call_count++;
    });
    setCitiesList(Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname)));

    const techFiltered = filterCallsCSR(calls, baseCriteria, 'technician');
    const techCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
    techFiltered.forEach((c) => {
      if (!c.nengineer || c.nengineer === '0' || c.nengineer === 0) return;
      const tCode = String(c.nengineer);
      techCounts[tCode] = techCounts[tCode] || { ncode: tCode, vname: c.technician_name || 'UNKNOWN', call_count: 0 };
      techCounts[tCode].call_count++;
    });
    setTechniciansList(Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname)));

    const branchesFiltered = filterCallsCSR(calls, baseCriteria, 'branch');
    const branchCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
    branchesFiltered.forEach((c) => {
      const bCode = String(c.resolved_branch_code || c.nofficeid || '');
      if (!bCode || bCode === 'UNKNOWN') return;
      branchCounts[bCode] = branchCounts[bCode] || {
        ncode: bCode,
        vcompanyname: c.officename || c.office_name || bCode,
        call_count: 0,
      };
      branchCounts[bCode].call_count++;
    });
    setBranchesList(Object.values(branchCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname)));

    const franchiseesFiltered = filterCallsCSR(calls, baseCriteria, 'franchisee');
    const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
    franchiseesFiltered.forEach((c) => {
      const fCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
      franchiseeCounts[fCode] = franchiseeCounts[fCode] || {
        ncode: fCode,
        vcompanyname: c.franchisee_name || fCode,
        call_count: 0,
      };
      franchiseeCounts[fCode].call_count++;
    });
    setFranchiseesList(Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname)));
  }, [pincodeSearch, selectedBranch, selectedCity, selectedFranchisee, selectedState, selectedTechnician]);

  const getDateStrings = useCallback(() => {
    const applied = appliedFiltersRef.current;
    if (applied) {
      return {
        startDateStr: toDateString(applied.dateRange.start),
        endDateStr: toDateString(applied.dateRange.end),
      };
    }
    return {
      startDateStr: toDateString(dateRange.start),
      endDateStr: toDateString(dateRange.end),
    };
  }, [dateRange.end, dateRange.start]);

  const getSharedCacheKey = useCallback(() => {
    const applied = appliedFiltersRef.current;
    if (!applied) return null;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    return buildCorpusCacheKey(startDateStr, endDateStr, applied.dateFilterColumn);
  }, []);

  const restoreCorpusDeduped = useCallback(async (cacheKey: string): Promise<CallCorpusStore | null> => {
    const inflight = corpusIdbRestoreInflightRef.current.get(cacheKey);
    if (inflight) return inflight;

    const promise = restoreCorpusFromIndexedDB(cacheKey);
    corpusIdbRestoreInflightRef.current.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      if (corpusIdbRestoreInflightRef.current.get(cacheKey) === promise) {
        corpusIdbRestoreInflightRef.current.delete(cacheKey);
      }
    }
  }, []);

  const markCorpusSatisfied = useCallback((cacheKey: string) => {
    corpusSatisfiedKeysRef.current.add(cacheKey);
  }, []);

  const tryResolveLocalCorpus = useCallback(
    async (cacheKey: string): Promise<CallCorpusStore | null> => {
      if (callCorpusStore?.cacheKey === cacheKey && callCorpusStore.calls.size > 0) {
        return callCorpusStore;
      }
      return restoreCorpusDeduped(cacheKey);
    },
    [restoreCorpusDeduped]
  );

  const applyCorpusToUi = useCallback(
    (store: CallCorpusStore) => {
      const calls = getCorpusCallsArray(store);
      syncDistributionCacheFromCorpus(store);
      setDistributionCalls(calls);
      if (distributionDataCache?.dbBranches) {
        setDistributionBranches(distributionDataCache.dbBranches);
      }
      setLastSyncedAt(new Date(store.lastSyncedAt));
      syncCascadeOptionsFromCalls(calls);
      void ensurePortalAuditCache(supabase);
      if (store.calls.size > 0) {
        corpusHydratedAtRef.current = Date.now();
        markCorpusSatisfied(store.cacheKey);
      }
    },
    [markCorpusSatisfied, syncCascadeOptionsFromCalls, supabase]
  );

  const ensureCorpusLoaded = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      if (readCallsFromPostgresClient()) return;
      const applied = appliedFiltersRef.current;
      if (!applied) return;
      const force = !!opts?.force;
      const startDateStr = toDateString(applied.dateRange.start);
      const endDateStr = toDateString(applied.dateRange.end);
      const appliedDateColumn = applied.dateFilterColumn;
      const fetchScope = resolveCorpusFetchScope(startDateStr, endDateStr, appliedDateColumn);
      const cacheKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
      const generation = corpusGenerationRef.current;

      if (force) {
        corpusSatisfiedKeysRef.current.delete(cacheKey);
      }

      const applyLocalAndReturn = (store: CallCorpusStore) => {
        applyCorpusToUi(store);
        setCorpusRefreshing(false);
        if (!opts?.silent) {
          setDistributionLoading(false);
        }
      };

      if (!force && corpusSatisfiedKeysRef.current.has(cacheKey)) {
        const local = await tryResolveLocalCorpus(cacheKey);
        if (local) {
          applyLocalAndReturn(local);
          return;
        }
      }

      if (
        !force &&
        callCorpusStore?.calls.size &&
        callCorpusStore.status !== 'error' &&
        corpusStoreCoversFetchScope(callCorpusStore, startDateStr, endDateStr, appliedDateColumn)
      ) {
        applyLocalAndReturn(
          adoptCorpusStoreForScope(callCorpusStore, startDateStr, endDateStr, appliedDateColumn)
        );
        markCorpusSatisfied(cacheKey);
        return;
      }

      if (
        !force &&
        callCorpusStore?.cacheKey === cacheKey &&
        callCorpusStore.calls.size > 0 &&
        callCorpusStore.status !== 'error'
      ) {
        applyLocalAndReturn(callCorpusStore);
        return;
      }

      if (corpusLoadInFlightRef.current && !force) {
        await corpusLoadInFlightRef.current;
        const local = await tryResolveLocalCorpus(cacheKey);
        if (local) {
          applyLocalAndReturn(local);
        }
        return;
      }

      const applyNetworkCorpusResponse = (
        res: {
          data?: {
            calls?: Record<string, unknown>[];
            deltaCalls?: Record<string, unknown>[];
            isDelta?: boolean;
            truncated?: boolean;
            cached?: boolean;
            stale?: boolean;
            warning?: string;
          };
        },
        source: CallCorpusStore['source'],
        responseOpts?: { markSatisfied?: boolean }
      ) => {
        if (generation !== corpusGenerationRef.current) return;

        if (res.data?.warning) {
          toast.warning(sanitizeUserFacingMessage(String(res.data.warning)));
        }

        if (res.data?.isDelta) {
          const deltas = (res.data.deltaCalls || []) as Record<string, unknown>[];
          if (deltas.length > 0) {
            mergeCorpusDelta(deltas, cacheKey);
            const store = callCorpusStore;
            if (store) {
              syncDistributionCacheFromCorpus(store);
              applyCorpusToUi(store);
              void persistCorpusDeltaToIndexedDB(deltas, store);
            }
          }
          if (responseOpts?.markSatisfied !== false) {
            markCorpusSatisfied(cacheKey);
          }
          return;
        }

        const fetchedCalls = (res.data?.calls || []) as Record<string, unknown>[];
        const truncated = !!res.data?.truncated;
        const store = applyCorpusSnapshot(cacheKey, fetchedCalls, {
          source: res.data?.cached || res.data?.stale ? 'memory' : source,
          truncated,
        });
        syncDistributionCacheFromCorpus(store);
        applyCorpusToUi(store);
        void persistCorpusToIndexedDB(store);
        if (responseOpts?.markSatisfied !== false) {
          markCorpusSatisfied(cacheKey);
        }
      };

      const fetchCorpusRange = async (
        controller: AbortController,
        rangeStart: string,
        rangeEnd: string,
        networkOpts: { full?: boolean; lastSync?: number },
        responseOpts?: { markSatisfied?: boolean }
      ) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        const params: Record<string, string> = {
          startDate: rangeStart,
          endDate: rangeEnd,
          callType: 'All',
          dateFilterColumn: fetchScope.dateFilterColumn,
          refresh: force ? 'true' : 'false',
        };

        if (!networkOpts.full && networkOpts.lastSync) {
          params.lastSync = formatCorpusLastSync(networkOpts.lastSync);
        }

        const res = await axios.get('/api/report/corpus', {
          headers,
          signal: controller.signal,
          params,
        });

        const hasLocalCorpus =
          callCorpusStore?.cacheKey === cacheKey && (callCorpusStore?.calls.size ?? 0) > 0;
        if (res.data?.isDelta && !hasLocalCorpus) {
          const fullRes = await axios.get('/api/report/corpus', {
            headers,
            signal: controller.signal,
            params: {
              startDate: rangeStart,
              endDate: rangeEnd,
              callType: 'All',
              dateFilterColumn: fetchScope.dateFilterColumn,
              refresh: force ? 'true' : 'false',
            },
          });
          applyNetworkCorpusResponse(fullRes, 'network', responseOpts);
          return;
        }

        applyNetworkCorpusResponse(res, 'network', responseOpts);
      };

      const loadRemainingCorpusMonths = async (
        remaining: Array<{ start: string; end: string }>,
        loadGeneration: number,
        bgCacheKey: string,
        bypassServerCache: boolean
      ) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        if (loadGeneration === corpusGenerationRef.current) {
          setCorpusRefreshing(true);
        }

        try {
          for (const month of remaining) {
            if (loadGeneration !== corpusGenerationRef.current) return;
            try {
              const res = await axios.get('/api/report/corpus', {
                headers,
                params: {
                  startDate: month.start,
                  endDate: month.end,
                  callType: 'All',
                  dateFilterColumn: fetchScope.dateFilterColumn,
                  refresh: bypassServerCache ? 'true' : 'false',
                },
              });
              if (loadGeneration !== corpusGenerationRef.current) return;

              if (res.data?.warning) {
                toast.warning(sanitizeUserFacingMessage(String(res.data.warning)));
              }

              const rows = (res.data?.calls || []) as Record<string, unknown>[];
              if (res.data?.cached) {
                /* server cache hit */
              }

              if (rows.length > 0) {
                mergeCorpusDelta(rows, bgCacheKey);
                const store = callCorpusStore;
                if (store?.cacheKey === bgCacheKey) {
                  syncDistributionCacheFromCorpus(store);
                  applyCorpusToUi(store);
                  void persistCorpusDeltaToIndexedDB(rows, store);
                }
              }
              await new Promise((r) => setTimeout(r, 600));
            } catch (monthErr: unknown) {
              if (axios.isCancel(monthErr)) return;
              const msg = sanitizeUserFacingMessage(
                axios.isAxiosError(monthErr) && monthErr.response?.data?.error
                  ? String(monthErr.response.data.error)
                  : monthErr instanceof Error
                    ? monthErr.message
                    : 'Month load failed'
              );
              toast.warning(`Could not load calls for ${month.start.slice(0, 7)}`, {
                description: msg,
              });
            }
          }

          if (loadGeneration === corpusGenerationRef.current) {
            markCorpusSatisfied(bgCacheKey);
            const store = callCorpusStore;
            if (store?.cacheKey === bgCacheKey) {
              void persistCorpusToIndexedDB(store);
            }
          }
        } finally {
          if (loadGeneration === corpusGenerationRef.current) {
            setCorpusRefreshing(false);
          }
        }
      };

      const run = (async () => {
        if (!force) {
          const restored = await restoreCorpusDeduped(cacheKey);
          if (restored && generation === corpusGenerationRef.current) {
            applyLocalAndReturn(restored);
            return;
          }
        }

        if (!force && corpusSatisfiedKeysRef.current.has(cacheKey)) {
          const local = await tryResolveLocalCorpus(cacheKey);
          if (local) {
            applyLocalAndReturn(local);
            return;
          }
        }

        if (corpusAbortRef.current) {
          corpusAbortRef.current.abort();
        }
        const controller = new AbortController();
        corpusAbortRef.current = controller;

        const spanStart = new Date(`${fetchScope.fetchStartDate}T00:00:00`);
        const spanEnd = new Date(`${fetchScope.fetchEndDate}T23:59:59`);
        const spanDays =
          !Number.isNaN(spanStart.getTime()) && !Number.isNaN(spanEnd.getTime())
            ? Math.floor((spanEnd.getTime() - spanStart.getTime()) / 86400000) + 1
            : 0;
        const hasWarmCorpus =
          callCorpusStore?.cacheKey === cacheKey && (callCorpusStore?.calls.size ?? 0) > 0;

        if (spanDays > MAX_CLIENT_CORPUS_DAYS && !hasWarmCorpus && !force) {
          setCorpusRefreshing(false);
          if (!opts?.silent) {
            setDistributionLoading(false);
          }
          return;
        }

        if (!opts?.silent) {
          setDistributionLoading(true);
        }
        setCorpusRefreshing(true);

        try {
          const months = splitCalendarMonths(fetchScope.fetchStartDate, fetchScope.fetchEndDate);
          if (months.length <= 1) {
            await fetchCorpusRange(
              controller,
              fetchScope.fetchStartDate,
              fetchScope.fetchEndDate,
              { full: true }
            );
          } else {
            const ordered = [...months].reverse();
            await fetchCorpusRange(
              controller,
              ordered[0].start,
              ordered[0].end,
              { full: true },
              { markSatisfied: false }
            );
            const remaining = ordered.slice(1);
            if (remaining.length > 0 && generation === corpusGenerationRef.current) {
              // Background months reuse server disk cache unless user explicitly refreshed.
              void loadRemainingCorpusMonths(remaining, generation, cacheKey, force);
            } else {
              markCorpusSatisfied(cacheKey);
            }
          }
        } catch (err: unknown) {
          if (axios.isCancel(err)) return;
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Failed to load report data';
          const userMessage = sanitizeUserFacingMessage(message);
          setCallCorpusStore({
            calls: callCorpusStore?.cacheKey === cacheKey ? callCorpusStore.calls : new Map(),
            cacheKey,
            fetchedAt: callCorpusStore?.fetchedAt ?? Date.now(),
            lastSyncedAt: callCorpusStore?.lastSyncedAt ?? Date.now(),
            status: 'error',
            source: callCorpusStore?.source ?? 'network',
            errorMessage: userMessage,
            truncated: callCorpusStore?.truncated,
          });
          if (needsCorpusPreload && !callCorpusStore?.calls.size) {
            toast.error('Could not load report data', { description: userMessage });
          }
        } finally {
          if (generation === corpusGenerationRef.current) {
            setCorpusRefreshing(false);
            if (!opts?.silent) {
              setDistributionLoading(false);
            }
          }
        }
      })();

      corpusLoadInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (corpusLoadInFlightRef.current === run) {
          corpusLoadInFlightRef.current = null;
        }
      }
    },
    [applyCorpusToUi, markCorpusSatisfied, needsCorpusPreload, restoreCorpusDeduped, supabase, tryResolveLocalCorpus]
  );

  const fetchDistributionFromRegister = useCallback(
    async (force = false, silent = false) => {
      const cacheKey = getSharedCacheKey();
      if (!cacheKey) return;

      const applySharedCalls = (calls: Record<string, unknown>[], fetchedAt: number) => {
        const branches = distributionDataCache?.dbBranches || [];
        setDistributionCalls(calls);
        setDistributionBranches(branches);
        setLastSyncedAt(new Date(fetchedAt));
        setDistributionDataCache({
          allCalls: calls,
          dbBranches: branches,
          lastSyncedAt: fetchedAt,
          fetchedAt,
          cacheKey,
        });
        syncCascadeOptionsFromCalls(calls);
        sharedRegisterSatisfiedKeysRef.current.add(cacheKey);
      };

      if (!force) {
        if (
          sharedRegisterSatisfiedKeysRef.current.has(cacheKey) &&
          distributionDataCache?.cacheKey === cacheKey &&
          (distributionDataCache.allCalls?.length ?? 0) > 0
        ) {
          logRegisterBulk('bulk CACHE HIT (memory)', {
            cacheKey,
            rows: distributionDataCache.allCalls.length,
            ageMs: Date.now() - (distributionDataCache.fetchedAt ?? 0),
          });
          if (distributionCalls.length === 0) {
            setDistributionCalls(distributionDataCache.allCalls);
          }
          return;
        }

        const inflight = sharedRegisterLoadInFlightRef.current.get(cacheKey);
        if (inflight) {
          logRegisterBulk('bulk WAIT (in-flight dedupe)', { cacheKey });
          await inflight;
          return;
        }
      } else {
        sharedRegisterSatisfiedKeysRef.current.delete(cacheKey);
      }

      let resolveInflight!: () => void;
      let rejectInflight!: (reason?: unknown) => void;
      const inflightGate = new Promise<void>((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      sharedRegisterLoadInFlightRef.current.set(cacheKey, inflightGate);

      const run = (async () => {
        if (!force) {
          const idbStart = performance.now();
          const idbCache = await readSharedRegisterCache(cacheKey);
          if (
            idbCache?.calls?.length &&
            idbCache.schemaVersion === SHARED_REGISTER_CACHE_VERSION
          ) {
            logRegisterBulk('bulk CACHE HIT (IndexedDB)', {
              cacheKey,
              rows: idbCache.callCount,
              restoreMs: Number((performance.now() - idbStart).toFixed(1)),
              ageMs: Date.now() - idbCache.fetchedAt,
            });
            applySharedCalls(idbCache.calls, idbCache.lastSyncedAt);
            await ensurePortalAuditCache(supabase);
            return;
          }
        }

        if (!silent) setDistributionLoading(true);
        const networkStart = performance.now();
        logRegisterBulk('bulk LOAD (network)', { cacheKey, force });

        try {
          const applied = appliedFiltersRef.current;
          if (!applied) return;
          const startDateStr = toDateString(applied.dateRange.start);
          const endDateStr = toDateString(applied.dateRange.end);
          const auth = createChunkedFetchAuth(supabase);
          await auth.refreshAuth();
          const calls = await fetchAllRegisterRowsForExport({
            getAuthHeaders: auth.getAuthHeaders,
            refreshAuth: auth.refreshAuth,
            query: {
              officeId: 'All',
              callType: 'All',
              startDate: startDateStr,
              endDate: endDateStr,
              dateFilterColumn: applied.dateFilterColumn,
            },
            onProgress: (fetched, total) => {
              if (fetched === total || fetched % 5000 === 0) {
                logRegisterBulk('bulk LOAD progress', { fetched, total });
              }
            },
          });
          const now = Date.now();
          applySharedCalls(calls, now);
          void persistSharedRegisterCache({
            cacheKey,
            calls,
            fetchedAt: now,
            lastSyncedAt: now,
            callCount: calls.length,
            schemaVersion: SHARED_REGISTER_CACHE_VERSION,
          });
          logRegisterBulk('bulk LOAD stored', {
            cacheKey,
            rows: calls.length,
            networkMs: Number((performance.now() - networkStart).toFixed(1)),
          });
          await ensurePortalAuditCache(supabase);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Distribution load failed';
          logRegisterBulk('bulk LOAD failed', {
            cacheKey,
            networkMs: Number((performance.now() - networkStart).toFixed(1)),
            error: message,
          });
          if (!silent) {
            toast.error('Could not load distribution data', {
              description: sanitizeUserFacingMessage(message),
            });
          }
        } finally {
          if (!silent) setDistributionLoading(false);
        }
      })();

      try {
        await run;
        resolveInflight();
      } catch (err) {
        rejectInflight(err);
        throw err;
      } finally {
        if (sharedRegisterLoadInFlightRef.current.get(cacheKey) === inflightGate) {
          sharedRegisterLoadInFlightRef.current.delete(cacheKey);
        }
      }
    },
    [getSharedCacheKey, distributionCalls.length, supabase, syncCascadeOptionsFromCalls]
  );

  const ensureSharedCallsLoaded = useCallback(
    async (force = false) => {
      if (readRegisterFromPostgresClient()) {
        await fetchDistributionFromRegister(force, !needsDistributionPreload);
        return;
      }
      await ensureCorpusLoaded({ force, silent: !needsDistributionPreload });
    },
    [ensureCorpusLoaded, fetchDistributionFromRegister, needsDistributionPreload]
  );

  const fetchDistributionData = ensureSharedCallsLoaded;

  const rehydrateDistributionFromCache = useCallback(() => {
    if (!distributionDataCache?.allCalls?.length) return;
    setDistributionCalls(distributionDataCache.allCalls);
    setDistributionBranches(distributionDataCache.dbBranches);
    if (distributionDataCache.lastSyncedAt) {
      setLastSyncedAt(new Date(distributionDataCache.lastSyncedAt));
    }
  }, []);

  const runBackgroundSync = useCallback(async (opts?: { showToast?: boolean }) => {
    if (syncInFlightRef.current) return;

    if (readCallsFromPostgresClient()) {
      if (!opts?.showToast) return;

      syncInFlightRef.current = true;
      setSyncInProgress(true);
      let toastId: string | number | undefined;
      if (opts?.showToast) {
        toastId = toast.loading('Refreshing report…');
      }
      try {
        logRegisterBulk('UI refresh from read model (no live ingest)');
        if (opts?.showToast && toastId != null) {
          toast.loading('Loading latest calls…', { id: toastId });
        }
        await ensureSharedCallsLoaded(true);
        const syncTime = new Date();
        setLastSyncedAt(syncTime);
        notifyCorpusRegisterDelta([], syncTime);

        if (opts?.showToast) {
          if (toastId != null) toast.dismiss(toastId);
          toast.success('Report refreshed');
        } else if (toastId != null) {
          toast.dismiss(toastId);
        }
      } catch (err: unknown) {
        if (toastId != null) toast.dismiss(toastId);
        if (opts?.showToast) {
          const rawMessage =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Refresh failed';
          toast.error('Failed to refresh report: ' + sanitizeUserFacingMessage(rawMessage));
        }
      } finally {
        syncInFlightRef.current = false;
        setSyncInProgress(false);
      }
      return;
    }

    if (!opts?.showToast) return;

    const applied = appliedFiltersRef.current;
    if (!applied) return;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const appliedDateColumn = applied.dateFilterColumn;
    const fetchScope = resolveCorpusFetchScope(startDateStr, endDateStr, appliedDateColumn);
    const cacheKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);

    const syncAnchor = callCorpusStore?.lastSyncedAt
      ? new Date(callCorpusStore.lastSyncedAt)
      : distributionDataCache?.lastSyncedAt
        ? new Date(distributionDataCache.lastSyncedAt)
        : lastSyncedAt ?? globalReportCache?.lastRefreshed ?? null;

    const hasWarmCorpus =
      callCorpusStore?.cacheKey === cacheKey && (callCorpusStore?.calls.size ?? 0) > 0;

    if (!hasWarmCorpus) {
      await ensureCorpusLoaded({ silent: true, force: false });
      if (!callCorpusStore || callCorpusStore.cacheKey !== cacheKey || callCorpusStore.calls.size === 0) {
        if (opts?.showToast) {
          toast.error('Could not refresh — report data is not loaded yet');
        }
        return;
      }
    }

    if (!syncAnchor) {
      return;
    }

    syncInFlightRef.current = true;
    setSyncInProgress(true);

    const lastSyncStr = formatSyncTimestamp(new Date(syncAnchor.getTime() - REPORT_SYNC_BUFFER_MS));

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const corpusRes = await axios.get('/api/report/corpus', {
        headers,
        params: {
          startDate: fetchScope.fetchStartDate,
          endDate: fetchScope.fetchEndDate,
          callType: 'All',
          dateFilterColumn: fetchScope.dateFilterColumn,
          lastSync: lastSyncStr,
        },
      });

      const deltaCalls = (corpusRes.data?.deltaCalls || []) as Record<string, unknown>[];
      const syncTime = new Date();

      let addedCount = 0;
      let updatedCount = 0;

      if (deltaCalls.length > 0) {
        if (!callCorpusStore || callCorpusStore.cacheKey !== cacheKey) {
          await ensureCorpusLoaded({ silent: true });
        }
        const merge = mergeCorpusDelta(deltaCalls, cacheKey);
        addedCount = merge.addedCount;
        updatedCount = merge.updatedCount;
        if (callCorpusStore) {
          syncDistributionCacheFromCorpus(callCorpusStore);
          applyCorpusToUi(callCorpusStore);
          void persistCorpusDeltaToIndexedDB(deltaCalls, callCorpusStore);
        }
        notifyCorpusRegisterDelta(deltaCalls, syncTime);
      } else {
        notifyCorpusRegisterDelta([], syncTime);
      }

      if (callCorpusStore?.cacheKey === cacheKey) {
        setLastSyncedAt(syncTime);
      } else if (distributionDataCache?.cacheKey === cacheKey) {
        const nextCache: DistributionDataCache = {
          ...distributionDataCache,
          lastSyncedAt: syncTime.getTime(),
        };
        setDistributionDataCache(nextCache);
        setLastSyncedAt(syncTime);
      } else {
        setLastSyncedAt(syncTime);
      }

      if (opts?.showToast) {
        const toastParts: string[] = [];
        if (addedCount > 0) toastParts.push(`${addedCount} added`);
        if (updatedCount > 0) toastParts.push(`${updatedCount} updated`);
        if (toastParts.length === 0) {
          toast.info('No calls added or updated in the last minute');
        } else {
          toast.success(`${toastParts.join(', ')} in the last minute`);
        }
      }
    } catch (err: unknown) {
      if (opts?.showToast) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Sync failed';
        toast.error('Failed to refresh calls: ' + sanitizeUserFacingMessage(message));
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncInProgress(false);
    }
  }, [
    applyCorpusToUi,
    ensureCorpusLoaded,
    ensureSharedCallsLoaded,
    getSharedCacheKey,
    lastSyncedAt,
    pathname,
    supabase,
  ]);

  const corpusFetchScopeKey = useMemo(() => {
    if (!appliedFilters) return null;
    const startDateStr = toDateString(appliedFilters.dateRange.start);
    const endDateStr = toDateString(appliedFilters.dateRange.end);
    return buildCorpusCacheKey(startDateStr, endDateStr, appliedFilters.dateFilterColumn);
  }, [appliedFilters]);

  useEffect(() => {
    if (!corpusFetchScopeKey) return;
    corpusGenerationRef.current += 1;
  }, [corpusFetchScopeKey]);

  useEffect(() => {
    if (!readRegisterFromPostgresClient()) return;
    if (!corpusFetchScopeKey) return;
    const cacheKey = corpusFetchScopeKey;
    if (distributionDataCache?.cacheKey === cacheKey) return;
    logRegisterBulk('bulk scope changed — clearing stale in-memory cache', {
      previousKey: distributionDataCache?.cacheKey ?? null,
      nextKey: cacheKey,
    });
    setDistributionCalls([]);
    setDistributionDataCache(null);
    for (const key of [...sharedRegisterSatisfiedKeysRef.current]) {
      if (key !== cacheKey) {
        sharedRegisterSatisfiedKeysRef.current.delete(key);
      }
    }
  }, [corpusFetchScopeKey]);

  useEffect(() => {
    if (readCallsFromPostgresClient()) return;
    if (!corpusFetchScopeKey) return;
    void (async () => {
      const local = await tryResolveLocalCorpus(corpusFetchScopeKey);
      if (local) {
        applyCorpusToUi(local);
      }
    })();
  }, [corpusFetchScopeKey, applyCorpusToUi, tryResolveLocalCorpus]);

  useEffect(() => {
    const calls =
      distributionCalls.length > 0
        ? distributionCalls
        : getCorpusCallsArray(callCorpusStore);
    if (!calls.length) return;
    syncCascadeOptionsFromCalls(calls);
  }, [
    distributionCalls,
    corpusTick,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    pincodeSearch,
    syncCascadeOptionsFromCalls,
  ]);

  const callTypeOptions = useMemo(
    () => callTypes.map((type) => ({ value: type, label: type })),
    [callTypes]
  );
  const stateOptions = useMemo(
    () => statesList.map((s) => ({ value: s.vname, label: s.vname })),
    [statesList]
  );
  const cityOptions = useMemo(
    () => citiesList.map((c) => ({ value: c.ncode, label: c.vname })),
    [citiesList]
  );
  const technicianOptions = useMemo(
    () => techniciansList.map((t) => ({ value: t.ncode, label: t.vname })),
    [techniciansList]
  );

  const value = useMemo<ReportFiltersContextValue>(() => ({
    search,
    setSearch,
    debouncedSearch,
    pincodeSearch,
    setPincodeSearch,
    debouncedPincodeSearch,
    isSearchDebouncing,
    flushSearchDebounce,
    dateRange,
    setDateRange,
    dateFilterColumn,
    setDateFilterColumn,
    dateFilterColumnOptions: REGISTER_DATE_FILTER_OPTIONS,
    selectedOfficeIds,
    setSelectedOfficeIds,
    selectedCallTypes,
    setSelectedCallTypes,
    selectedStatus,
    setSelectedStatus,
    priorityFilter,
    setPriorityFilter,
    portalFilter,
    setPortalFilter,
    selectedState,
    setSelectedState,
    selectedCity,
    setSelectedCity,
    selectedBranch,
    setSelectedBranch,
    selectedFranchisee,
    setSelectedFranchisee,
    selectedTechnician,
    setSelectedTechnician,
    offices,
    callTypes,
    statesList,
    setStatesList,
    citiesList,
    setCitiesList,
    techniciansList,
    setTechniciansList,
    showOfficeDropdown,
    setShowOfficeDropdown,
    tempSelectedOfficeIds,
    setTempSelectedOfficeIds,
    officeSearch,
    setOfficeSearch,
    handleStatesChange,
    handleBranchesChange,
    handleCitiesChange,
    clearAllFilters,
    isAnyFilterActive: isAnyFilterActive({
      search,
      pincodeSearch,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedCallTypes,
      selectedOfficeIds,
      selectedStatus,
      priorityFilter,
      portalFilter,
    }),
    callTypeOptions,
    stateOptions,
    cityOptions,
    technicianOptions,
    branchesList,
    franchiseesList,
    setBranchesList,
    setFranchiseesList,
    distributionCalls,
    distributionBranches,
    distributionLoading,
    fetchDistributionData,
    ensureSharedCallsLoaded,
    ensureCorpusLoaded,
    rehydrateDistributionFromCache,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    corpusStatus,
    corpusLoading: distributionLoading || corpusStatus === 'refreshing',
    corpusTick,
    corpusTruncated,
    corpusCallCount,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
    appliedFilters,
    appliedRevision,
    applyFilters,
    applyFilterSnapshot,
    removeActiveFilterChip,
    getAppliedFiltersSnapshot,
    hasPendingFilterChanges,
    getAppliedDateStrings,
    getAppliedDateFilterColumn,
  }), [
    search,
    debouncedSearch,
    pincodeSearch,
    debouncedPincodeSearch,
    isSearchDebouncing,
    flushSearchDebounce,
    dateRange,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    selectedStatus,
    priorityFilter,
    portalFilter,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    offices,
    callTypes,
    statesList,
    citiesList,
    techniciansList,
    showOfficeDropdown,
    tempSelectedOfficeIds,
    officeSearch,
    handleStatesChange,
    handleBranchesChange,
    handleCitiesChange,
    clearAllFilters,
    callTypeOptions,
    stateOptions,
    cityOptions,
    technicianOptions,
    branchesList,
    franchiseesList,
    distributionCalls,
    distributionBranches,
    distributionLoading,
    fetchDistributionData,
    ensureSharedCallsLoaded,
    ensureCorpusLoaded,
    rehydrateDistributionFromCache,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    corpusStatus,
    corpusTruncated,
    corpusCallCount,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
    corpusTick,
    appliedFilters,
    appliedRevision,
    applyFilters,
    applyFilterSnapshot,
    removeActiveFilterChip,
    getAppliedFiltersSnapshot,
    hasPendingFilterChanges,
    getAppliedDateStrings,
    getAppliedDateFilterColumn,
  ]);

  return (
    <ReportFiltersContext.Provider value={value}>
      {children}
    </ReportFiltersContext.Provider>
  );
}

export function useReportFilters() {
  const ctx = useContext(ReportFiltersContext);
  if (!ctx) {
    throw new Error('useReportFilters must be used within ReportFiltersProvider');
  }
  return ctx;
}
