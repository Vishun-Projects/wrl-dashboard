'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { feedback } from '@/lib/ui/feedback';
import { useUser } from '@/components/layout/DashboardLayout';
import { seesAllOfficesForUser } from '@/lib/auth/rbac-catalog';
import type { PageAlertState } from '@/hooks/usePageAlert';
import { createClient } from '@/lib/supabase/client';
import {
  buildDraftFilterSnapshot,
  buildFranchiseeOptions,
  buildRegisterFilterBootstrap,
  buildReportFilterSnapshot,
  type DraftFilterOverrides,
  dateRangeFromDeepLinkParams,
  defaultAgingAsOfForRange,
  defaultDateRange,
  filterSnapshotsEqual,
  findBreakdownCallType,
  isAnyFilterActive,
  migrateStringFilter,
  normalizeAgingAsOfDate,
  parseRegisterDeepLinkSearchParams,
  reportFilterSnapshotFromCache,
  snapshotAfterRemovingActiveFilterChip,
  REPORT_FILTER_SEARCH_DEBOUNCE_MS,
  toDateString,
  type ActiveFilterChipDescriptor,
  type ReportDateRange,
  type ReportFilterSnapshot,
} from '@/features/report/services/filters';
import {
  buildClearedDraftSnapshotFromState,
  buildDraftSnapshotFromState,
} from '@/features/report/services/draft-snapshot-state';
import {
  REGISTER_DATE_FILTER_OPTIONS,
  resolveRegisterDateSqlColumn,
  MAX_CLIENT_CORPUS_DAYS,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls/query';
import {
  distributionDataCache,
  globalReportCache,
  callCorpusStore,
  setDistributionDataCache,
  setCallCorpusStore,
  type DistributionDataCache,
  type CallCorpusStore,
} from '@/features/report/services/data-store';
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
} from '@/features/report/services/corpus';
import { ensurePortalAuditCache } from '@/features/report/services/portal-cache';
import {
  readCallsFromPostgresClient,
  readRegisterFromPostgresClient,
} from '@/lib/read-model/client-flags';
import {
  routeNeedsCorpusPreload,
  routeNeedsSharedResources,
} from '@/features/report/services/route-scope';
import { logRegisterBulk } from '@/features/register';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import {
  buildDefaultFilterSnapshot,
  type RestoreFilterContext,
} from '@/features/report/services/preferences';
import {
  formatSyncTimestamp,
  REPORT_SYNC_BUFFER_MS,
} from '@/features/report/services/sync';
import { formatCorpusLastSync } from '@/features/report/lib/corpus-sync-time';
import { buildReportFilterOptions, deriveCascadeFilterLists } from '@/features/report/services/report-filter-options';
import type { ReportFiltersContextValue } from '@/features/report/components/report-filters-context.types';

let cachedReportResources: { offices: unknown[]; callTypes: string[] } | null = null;
let reportResourcesInflight: Promise<{ offices: unknown[]; callTypes: string[] }> | null = null;

const ReportFiltersContext = createContext<ReportFiltersContextValue | null>(null);

export function ReportFiltersProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userProfile, loadingProfile } = useUser();
  const needsCorpusPreload = routeNeedsCorpusPreload(pathname);
  const needsSharedResources = routeNeedsSharedResources(pathname);
  const needsDistributionPreload = needsCorpusPreload;

  const [registerBootstrap] = useState(() =>
    buildRegisterFilterBootstrap(
      globalReportCache ? reportFilterSnapshotFromCache(globalReportCache) : null,
      null
    )
  );
  const bootstrapSnapshot = registerBootstrap.snapshot;

  const [search, setSearch] = useState(
    () => bootstrapSnapshot?.search ?? globalReportCache?.search ?? ''
  );
  const [pincodeSearch, setPincodeSearch] = useState(
    () => bootstrapSnapshot?.pincodeSearch ?? globalReportCache?.pincodeSearch ?? ''
  );
  const [debouncedSearch, setDebouncedSearch] = useState(
    () => bootstrapSnapshot?.search ?? globalReportCache?.search ?? ''
  );
  const [debouncedPincodeSearch, setDebouncedPincodeSearch] = useState(
    () => bootstrapSnapshot?.pincodeSearch ?? globalReportCache?.pincodeSearch ?? ''
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
  const [dateRange, setDateRangeState] = useState<ReportDateRange>(() => {
    if (bootstrapSnapshot?.dateRange) return bootstrapSnapshot.dateRange;
    if (globalReportCache) {
      return {
        start: new Date(globalReportCache.dateRange.start),
        end: new Date(globalReportCache.dateRange.end),
        label: globalReportCache.dateRange.label || 'This Month',
      };
    }
    return defaultDateRange();
  });
  const [agingAsOf, setAgingAsOfState] = useState<string>(() =>
    normalizeAgingAsOfDate(
      bootstrapSnapshot?.agingAsOf ??
        globalReportCache?.agingAsOf ??
        defaultAgingAsOfForRange(
          bootstrapSnapshot?.dateRange ??
            (globalReportCache
              ? {
                  start: new Date(globalReportCache.dateRange.start),
                  end: new Date(globalReportCache.dateRange.end),
                  label: globalReportCache.dateRange.label || 'This Month',
                }
              : defaultDateRange())
        )
    )
  );
  const setDateRange = useCallback((range: ReportDateRange) => {
    setDateRangeState(range);
    setAgingAsOfState(defaultAgingAsOfForRange(range));
  }, []);
  const setAgingAsOf = useCallback((value: string) => {
    setAgingAsOfState(normalizeAgingAsOfDate(value));
  }, []);
  const [dateFilterColumn, setDateFilterColumn] = useState<RegisterDateFilterColumn>(() =>
    resolveRegisterDateSqlColumn(
      bootstrapSnapshot?.dateFilterColumn ?? globalReportCache?.dateFilterColumn
    )
  );
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>(
    () => bootstrapSnapshot?.selectedOfficeIds ?? globalReportCache?.selectedOfficeIds ?? []
  );
  const [selectedCallTypes, setSelectedCallTypes] = useState<string[]>(
    () => bootstrapSnapshot?.selectedCallTypes ?? globalReportCache?.selectedCallTypes ?? []
  );
  const [selectedStatus, setSelectedStatus] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedStatus ?? globalReportCache?.selectedStatus)
  );
  const [priorityFilter, setPriorityFilter] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.priorityFilter ?? globalReportCache?.priorityFilter)
  );
  const [portalFilter, setPortalFilter] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.portalFilter ?? globalReportCache?.portalFilter)
  );
  const [repairFilter, setRepairFilter] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.repairFilter ?? globalReportCache?.repairFilter)
  );
  const [selectedState, setSelectedState] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedState ?? globalReportCache?.selectedState)
  );
  const [selectedCity, setSelectedCity] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedCity ?? globalReportCache?.selectedCity)
  );
  const [selectedRegion, setSelectedRegion] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedRegion ?? globalReportCache?.selectedRegion)
  );
  const [selectedAccount, setSelectedAccount] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedAccount ?? globalReportCache?.selectedAccount)
  );
  const [selectedBranch, setSelectedBranch] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedBranch ?? globalReportCache?.selectedBranch)
  );
  const [selectedFranchisee, setSelectedFranchisee] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedFranchisee ?? globalReportCache?.selectedFranchisee)
  );
  const [selectedTechnician, setSelectedTechnician] = useState<string[]>(() =>
    migrateStringFilter(bootstrapSnapshot?.selectedTechnician ?? globalReportCache?.selectedTechnician)
  );

  const [offices, setOffices] = useState<any[]>([]);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [statesList, setStatesList] = useState<any[]>([]);
  const [citiesList, setCitiesList] = useState<any[]>([]);
  const [regionsList, setRegionsList] = useState<Array<{ vname: string; call_count?: number }>>([]);
  const [accountsList, setAccountsList] = useState<Array<{ vname: string; call_count?: number }>>([]);
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
  const [reportBanner, setReportBanner] = useState<PageAlertState>(null);
  const setReportError = useCallback((message: string) => {
    setReportBanner({ variant: 'error', message });
  }, []);
  const setReportWarning = useCallback((message: string) => {
    setReportBanner({ variant: 'warning', message });
  }, []);
  const clearReportBanner = useCallback(() => {
    setReportBanner(null);
  }, []);
  const [refreshDelta, setRefreshDelta] = useState<{ added: number; updated: number } | null>(
    null
  );
  const clearRefreshDelta = useCallback(() => {
    setRefreshDelta(null);
  }, []);
  const [corpusTick, setCorpusTick] = useState(0);
  const syncInFlightRef = useRef(false);
  const corpusLoadInFlightRef = useRef<Promise<void> | null>(null);
  /** Date windows bulk-loaded for Postgres register/distribution this session. */
  const sharedRegisterSatisfiedKeysRef = useRef<Set<string>>(new Set());
  const corpusAbortRef = useRef<AbortController | null>(null);
  const corpusGenerationRef = useRef(0);
  const corpusHydratedAtRef = useRef<number | null>(null);
  const corpusIdbRestoreInflightRef = useRef<Map<string, Promise<CallCorpusStore | null>>>(new Map());
  /** Date windows hydrated this session — never re-fetch from network unless force. */
  const corpusSatisfiedKeysRef = useRef<Set<string>>(new Set());
  const defaultCallTypesAppliedRef = useRef(
    (bootstrapSnapshot?.selectedCallTypes?.length ?? globalReportCache?.selectedCallTypes?.length ?? 0) >
      0
  );

  const [appliedFilters, setAppliedFilters] = useState<ReportFilterSnapshot | null>(
    () =>
      bootstrapSnapshot ??
      (globalReportCache ? reportFilterSnapshotFromCache(globalReportCache) : null)
  );
  const [appliedRevision, setAppliedRevision] = useState(() =>
    bootstrapSnapshot || globalReportCache ? 1 : 0
  );
  const [prefsReady, setPrefsReady] = useState(
    () => registerBootstrap.fromDeepLink || !!globalReportCache?.data || !!bootstrapSnapshot
  );
  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;
  const prefsRestoreAttemptedRef = useRef(false);
  const consumedRegisterDeepLinkKeyRef = useRef(registerBootstrap.deepLinkKey);
  const userRoleRef = useRef<{ role: string; officeIds: string[]; permissions: string[] }>({
    role: 'branch_manager',
    officeIds: [],
    permissions: [],
  });

  const draftStateRef = useRef({
    search,
    pincodeSearch,
    dateRange,
    agingAsOf,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
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
  draftStateRef.current = {
    search,
    pincodeSearch,
    dateRange,
    agingAsOf,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
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
  };

  const applyFilterSnapshot = useCallback((snapshot: ReportFilterSnapshot) => {
    setSearch(snapshot.search);
    setPincodeSearch(snapshot.pincodeSearch);
    setDebouncedSearch(snapshot.search);
    setDebouncedPincodeSearch(snapshot.pincodeSearch);
    setDateRangeState(snapshot.dateRange);
    setAgingAsOfState(normalizeAgingAsOfDate(snapshot.agingAsOf));
    setDateFilterColumn(snapshot.dateFilterColumn);
    setSelectedOfficeIds([...snapshot.selectedOfficeIds]);
    setSelectedCallTypes([...snapshot.selectedCallTypes]);
    setSelectedStatus([...snapshot.selectedStatus]);
    setPriorityFilter([...snapshot.priorityFilter]);
    setPortalFilter([...snapshot.portalFilter]);
    setRepairFilter([...snapshot.repairFilter]);
    setSelectedState([...snapshot.selectedState]);
    setSelectedCity([...snapshot.selectedCity]);
    setSelectedRegion([...snapshot.selectedRegion]);
    setSelectedAccount([...snapshot.selectedAccount]);
    setSelectedBranch([...snapshot.selectedBranch]);
    setSelectedFranchisee([...snapshot.selectedFranchisee]);
    setSelectedTechnician([...snapshot.selectedTechnician]);
    appliedFiltersRef.current = snapshot;
    setAppliedFilters(snapshot);
    setAppliedRevision((r) => r + 1);
  }, []);

  useLayoutEffect(() => {
    if (!pathname?.startsWith('/report')) {
      consumedRegisterDeepLinkKeyRef.current = '';
      return;
    }

    const deepLink = parseRegisterDeepLinkSearchParams(searchParams);
    if (!deepLink) {
      consumedRegisterDeepLinkKeyRef.current = '';
      return;
    }

    const deepLinkKey = searchParams.toString();
    if (!deepLinkKey || consumedRegisterDeepLinkKeyRef.current === deepLinkKey) return;
    consumedRegisterDeepLinkKeyRef.current = deepLinkKey;

    const base =
      appliedFiltersRef.current ?? buildDraftFilterSnapshot(draftStateRef.current);
    const snapshot = buildReportFilterSnapshot({
      ...base,
      search: deepLink.search ?? base.search,
      pincodeSearch: deepLink.pincode ?? base.pincodeSearch,
      dateRange: dateRangeFromDeepLinkParams(deepLink, base.dateRange),
      dateFilterColumn: deepLink.dateFilterColumn ?? base.dateFilterColumn,
      selectedCallTypes: deepLink.search ? [] : base.selectedCallTypes,
    });

    applyFilterSnapshot(snapshot);
    setPrefsReady(true);
  }, [pathname, searchParams, applyFilterSnapshot]);

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
      buildDraftSnapshotFromState({
        search,
        pincodeSearch,
        dateRange,
        agingAsOf,
        dateFilterColumn,
        selectedOfficeIds,
        selectedCallTypes,
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
      }),
    [
      search,
      pincodeSearch,
      dateRange,
      agingAsOf,
      dateFilterColumn,
      selectedOfficeIds,
      selectedCallTypes,
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
    if (!needsSharedResources) {
      setResourcesLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        if (cachedReportResources) {
          const resources = cachedReportResources;
          if (!cancelled) {
            setOffices(resources.offices);
            setCallTypes(resources.callTypes);
            if (!defaultCallTypesAppliedRef.current && resources.callTypes.length > 0) {
              const breakdown = findBreakdownCallType(resources.callTypes);
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
            const [officeRes, typesRes] = await Promise.all([
              axios.get('/api/offices', { withCredentials: true }),
              axios.get('/api/report/call-types', { withCredentials: true }),
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
  }, [supabase, needsSharedResources]);

  const syncUserRoleFromProfile = useCallback(() => {
    if (!userProfile) return false;
    userRoleRef.current = {
      role: userProfile.role ?? 'branch_manager',
      officeIds: (userProfile.office_ids ?? []).map(String),
      permissions: userProfile.permissions ?? [],
    };
    return true;
  }, [userProfile]);

  useEffect(() => {
    if (!resourcesLoaded || prefsRestoreAttemptedRef.current || loadingProfile) return;
    if (!syncUserRoleFromProfile()) return;

    const deepLinkOnLoad = parseRegisterDeepLinkSearchParams(searchParams);
    if (deepLinkOnLoad || registerBootstrap.fromDeepLink || appliedFiltersRef.current) {
      prefsRestoreAttemptedRef.current = true;
      setPrefsReady(true);
      return;
    }

    prefsRestoreAttemptedRef.current = true;

    const ctx: RestoreFilterContext = {
      role: userRoleRef.current.role,
      officeIds: userRoleRef.current.officeIds,
      callTypes,
      visibleOfficeIds: seesAllOfficesForUser(
        userRoleRef.current.permissions,
        userRoleRef.current.role,
        userRoleRef.current.officeIds
      )
        ? offices
            .map((o: { ncode?: string | number }) => String(o.ncode ?? ''))
            .filter(Boolean)
        : userRoleRef.current.officeIds,
    };

    const snapshot = buildDefaultFilterSnapshot(ctx);
    applyFilterSnapshot(snapshot);
    setPrefsReady(true);
  }, [
    resourcesLoaded,
    loadingProfile,
    callTypes,
    offices,
    applyFilterSnapshot,
    searchParams,
    syncUserRoleFromProfile,
  ]);

  useEffect(() => {
    if (!pathname?.startsWith('/report') || !searchParams.toString()) return;
    if (!consumedRegisterDeepLinkKeyRef.current) return;
    router.replace(pathname, { scroll: false });
  }, [pathname, router, searchParams]);

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
    const resetRange = defaultDateRange();
    const snapshot = buildClearedDraftSnapshotFromState(
      draftStateRef.current,
      resetRange,
      resolveRegisterDateSqlColumn(undefined)
    );
    flushSync(() => {
      applyFilterSnapshot(snapshot);
    });
  }, [applyFilterSnapshot]);

  const syncCascadeOptionsFromCalls = useCallback((calls: any[]) => {
    if (!calls.length) {
      setStatesList([]);
      setCitiesList([]);
      setRegionsList([]);
      setAccountsList([]);
      setTechniciansList([]);
      return;
    }

    const baseCriteria = {
      state: selectedState,
      city: selectedCity,
      region: selectedRegion,
      account: selectedAccount,
      selectedBranch,
      selectedFranchisee,
      technician: selectedTechnician,
      pincodeSearch,
    };
    const next = deriveCascadeFilterLists(calls, baseCriteria);
    setStatesList(next.statesList);
    setCitiesList(next.citiesList);
    setRegionsList(next.regionsList);
    setAccountsList(next.accountsList);
    setTechniciansList(next.techniciansList);
    setBranchesList(next.branchesList);
    setFranchiseesList(next.franchiseesList);
  }, [pincodeSearch, selectedAccount, selectedBranch, selectedCity, selectedFranchisee, selectedRegion, selectedState, selectedTechnician]);

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
      void ensurePortalAuditCache();
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
          setReportWarning(sanitizeUserFacingMessage(String(res.data.warning)));
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
                setReportWarning(sanitizeUserFacingMessage(String(res.data.warning)));
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
              await new Promise((r) => setTimeout(r, 200));
            } catch (monthErr: unknown) {
              if (axios.isCancel(monthErr)) return;
              const msg = sanitizeUserFacingMessage(
                axios.isAxiosError(monthErr) && monthErr.response?.data?.error
                  ? String(monthErr.response.data.error)
                  : monthErr instanceof Error
                    ? monthErr.message
                    : 'Month load failed'
              );
              setReportWarning(
                `Could not load calls for ${month.start.slice(0, 7)}: ${msg}`
              );
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
            setReportError(
              userMessage ? `Could not load report data: ${userMessage}` : 'Could not load report data'
            );
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
    [
      applyCorpusToUi,
      markCorpusSatisfied,
      needsCorpusPreload,
      restoreCorpusDeduped,
      setReportError,
      setReportWarning,
      supabase,
      tryResolveLocalCorpus,
    ]
  );

  const ensureSharedCallsLoaded = useCallback(
    async (force = false) => {
      if (readRegisterFromPostgresClient()) {
        return;
      }
      await ensureCorpusLoaded({ force, silent: !needsDistributionPreload });
    },
    [ensureCorpusLoaded, needsDistributionPreload]
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
      const syncTime = new Date();
      setLastSyncedAt(syncTime);
      notifyCorpusRegisterDelta([], syncTime);

      if (opts?.showToast) {
        feedback.backgroundUpdate('Sync timestamp updated');
      }
      syncInFlightRef.current = false;
      setSyncInProgress(false);
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
          feedback.actionFailed('Could not refresh — report data is not loaded yet');
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

        if (addedCount > 0 || updatedCount > 0) {
          setRefreshDelta({ added: addedCount, updated: updatedCount });
        }
        if (opts?.showToast) {
          const toastParts: string[] = [];
          if (addedCount > 0) toastParts.push(`${addedCount} added`);
          if (updatedCount > 0) toastParts.push(`${updatedCount} updated`);
          if (toastParts.length > 0) {
            feedback.backgroundUpdate(`${toastParts.join(', ')} in the last minute`);
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
        feedback.actionFailed('Failed to refresh calls: ' + sanitizeUserFacingMessage(message));
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncInProgress(false);
    }
  }, [
    applyCorpusToUi,
    ensureCorpusLoaded,
    ensureSharedCallsLoaded,
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

  const {
    callTypeOptions,
    stateOptions,
    cityOptions,
    regionOptions,
    accountOptions,
    technicianOptions,
  } = useMemo(
    () =>
      buildReportFilterOptions({
        callTypes,
        statesList,
        citiesList,
        regionsList,
        accountsList,
        techniciansList,
      }),
    [callTypes, statesList, citiesList, regionsList, accountsList, techniciansList]
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
    agingAsOf,
    setAgingAsOf,
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
    repairFilter,
    setRepairFilter,
    selectedState,
    setSelectedState,
    selectedCity,
    setSelectedCity,
    selectedRegion,
    setSelectedRegion,
    selectedAccount,
    setSelectedAccount,
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
    regionsList,
    setRegionsList,
    accountsList,
    setAccountsList,
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
    }),
    callTypeOptions,
    stateOptions,
    cityOptions,
    regionOptions,
    accountOptions,
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
    prefsReady,
    reportBanner,
    setReportError,
    setReportWarning,
    clearReportBanner,
    refreshDelta,
    clearRefreshDelta,
  }), [
    search,
    debouncedSearch,
    pincodeSearch,
    debouncedPincodeSearch,
    isSearchDebouncing,
    flushSearchDebounce,
    dateRange,
    agingAsOf,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
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
    offices,
    callTypes,
    statesList,
    citiesList,
    regionsList,
    accountsList,
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
    regionOptions,
    accountOptions,
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
    prefsReady,
    reportBanner,
    setReportError,
    setReportWarning,
    clearReportBanner,
    refreshDelta,
    clearRefreshDelta,
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
