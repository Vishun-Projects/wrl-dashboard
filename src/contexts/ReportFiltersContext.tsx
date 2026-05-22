'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  buildDistributionCacheKey,
  buildFranchiseeOptions,
  defaultDateRange,
  filterCallsCSR,
  isAnyFilterActive,
  migrateStringFilter,
  type ReportDateRange,
} from '@/lib/report-filters';
import {
  REGISTER_DATE_FILTER_OPTIONS,
  resolveRegisterDateSqlColumn,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls-query';
import {
  distributionDataCache,
  globalReportCache,
  setDistributionDataCache,
  type DistributionDataCache,
} from '@/lib/report-data-store';
import {
  formatSyncTimestamp,
  mapRegisterRowToDistributionPatch,
  mergeCallsDelta,
  notifyRegisterDelta,
  patchCallsDelta,
  REPORT_SYNC_BUFFER_MS,
  REPORT_SYNC_INTERVAL_MS,
} from '@/lib/report-sync';

type ReportFiltersContextValue = {
  search: string;
  setSearch: (v: string) => void;
  pincodeSearch: string;
  setPincodeSearch: (v: string) => void;
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
  rehydrateDistributionFromCache: () => void;
  runBackgroundSync: (opts?: { showToast?: boolean }) => Promise<void>;
  lastSyncedAt: Date | null;
  syncInProgress: boolean;
  syncCascadeOptionsFromCalls: (calls: any[]) => void;
  resourcesLoaded: boolean;
};

const ReportFiltersContext = createContext<ReportFiltersContextValue | null>(null);

function routeNeedsDistributionPreload(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.includes('/report/distribution') ||
    pathname.includes('/report/serial-audit')
  );
}

export function ReportFiltersProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const pathname = usePathname();
  const needsDistributionPreload = routeNeedsDistributionPreload(pathname);

  const [search, setSearch] = useState(globalReportCache?.search || '');
  const [pincodeSearch, setPincodeSearch] = useState(globalReportCache?.pincodeSearch || '');
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => {
    if (globalReportCache) {
      return {
        start: new Date(globalReportCache.dateRange.start),
        end: new Date(globalReportCache.dateRange.end),
        label: globalReportCache.dateRange.label || 'Last 14 Days',
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
  const syncInFlightRef = useRef(false);
  const sharedLoadInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const [officeRes, typesRes] = await Promise.all([
          axios.get('/api/offices', { headers }),
          axios.get('/api/report/call-types', { headers }),
        ]);
        if (cancelled) return;
        setOffices(officeRes.data || []);
        setCallTypes(typesRes.data || []);
      } catch {
        // offices/call types are optional for some views
      } finally {
        if (!cancelled) setResourcesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
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
  }, [pincodeSearch, selectedBranch, selectedCity, selectedFranchisee, selectedState, selectedTechnician]);

  const getDateStrings = useCallback(() => {
    const startDateStr = dateRange.start instanceof Date
      ? dateRange.start.toISOString().split('T')[0]
      : String(dateRange.start);
    const endDateStr = dateRange.end instanceof Date
      ? dateRange.end.toISOString().split('T')[0]
      : String(dateRange.end);
    return { startDateStr, endDateStr };
  }, [dateRange.end, dateRange.start]);

  const getSharedCacheKey = useCallback(() => {
    const { startDateStr, endDateStr } = getDateStrings();
    return buildDistributionCacheKey(startDateStr, endDateStr, selectedCallTypes);
  }, [getDateStrings, selectedCallTypes]);

  const applySharedCallsCache = useCallback((cache: DistributionDataCache) => {
    setDistributionDataCache(cache);
    setDistributionCalls(cache.allCalls);
    setDistributionBranches(cache.dbBranches);
    setLastSyncedAt(new Date(cache.lastSyncedAt));
    syncCascadeOptionsFromCalls(cache.allCalls);
  }, [syncCascadeOptionsFromCalls]);

  const ensureSharedCallsLoaded = useCallback(async (force = false) => {
    const { startDateStr, endDateStr } = getDateStrings();
    const cacheKey = buildDistributionCacheKey(startDateStr, endDateStr, selectedCallTypes);

    if (!force && distributionDataCache?.cacheKey === cacheKey && distributionDataCache.allCalls.length > 0) {
      setDistributionCalls(distributionDataCache.allCalls);
      setDistributionBranches(distributionDataCache.dbBranches);
      if (distributionDataCache.lastSyncedAt) {
        setLastSyncedAt(new Date(distributionDataCache.lastSyncedAt));
      }
      syncCascadeOptionsFromCalls(distributionDataCache.allCalls);
      return;
    }

    if (sharedLoadInFlightRef.current && !force) {
      return sharedLoadInFlightRef.current;
    }

    const run = (async () => {
      setDistributionLoading(true);
      try {
        if (force) {
          setDistributionDataCache(null);
        }
        const callTypeParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
        const res = await axios.get('/api/distribution', {
          headers,
          params: {
            startDate: startDateStr,
            endDate: endDateStr,
            callType: callTypeParam,
            refresh: force ? 'true' : 'false',
          },
        });
        const fetchedCalls = res.data?.allCalls || [];
        const fetchedBranches = res.data?.dbBranches || [];
        const syncedAt = Date.now();
        const nextCache: DistributionDataCache = {
          allCalls: fetchedCalls,
          dbBranches: fetchedBranches,
          cacheKey,
          fetchedAt: syncedAt,
          lastSyncedAt: syncedAt,
        };
        applySharedCallsCache(nextCache);
        if (res.data?.degraded && res.data?.warning) {
          toast.warning(res.data.warning);
        }
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load shared call data';
        if (needsDistributionPreload) {
          console.warn('ensureSharedCallsLoaded:', message);
          toast.error('Could not load call distribution', {
            description:
              message.includes('memory') ||
              message.includes('OutOfMemory') ||
              String(err).includes('503')
                ? 'Try a shorter date range (e.g. Last 7 Days).'
                : message,
          });
        }
      } finally {
        setDistributionLoading(false);
      }
    })();

    sharedLoadInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (sharedLoadInFlightRef.current === run) {
        sharedLoadInFlightRef.current = null;
      }
    }
  }, [
    applySharedCallsCache,
    getDateStrings,
    needsDistributionPreload,
    selectedCallTypes,
    supabase,
    syncCascadeOptionsFromCalls,
  ]);

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

    const syncAnchor = distributionDataCache?.lastSyncedAt
      ? new Date(distributionDataCache.lastSyncedAt)
      : lastSyncedAt ?? globalReportCache?.lastRefreshed ?? null;

    if (!syncAnchor) {
      if (routeNeedsDistributionPreload(pathname)) {
        await ensureSharedCallsLoaded();
      }
      return;
    }

    syncInFlightRef.current = true;
    setSyncInProgress(true);

    const { startDateStr, endDateStr } = getDateStrings();
    const callTypeParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');
    const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');
    const lastSyncStr = formatSyncTimestamp(new Date(syncAnchor.getTime() - REPORT_SYNC_BUFFER_MS));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      const cacheKey = getSharedCacheKey();

      const shouldSyncDistribution =
        routeNeedsDistributionPreload(pathname) ||
        (distributionDataCache?.allCalls?.length ?? 0) > 0;

      const [distRes, reportRes] = await Promise.all([
        shouldSyncDistribution
          ? axios.get('/api/distribution', {
              headers,
              params: {
                startDate: startDateStr,
                endDate: endDateStr,
                callType: callTypeParam,
                lastSync: lastSyncStr,
              },
            })
          : Promise.resolve({ data: { deltaCalls: [] as unknown[] } }),
        axios.get('/api/report', {
          headers,
          params: {
            officeId: officeIdsParam,
            callType: callTypeParam,
            startDate: startDateStr,
            endDate: endDateStr,
            lastSync: lastSyncStr,
          },
        }),
      ]);

      const deltaCalls = distRes.data?.deltaCalls || [];
      const registerDeltas = reportRes.data?.data || [];
      const syncTime = new Date();
      const existingCalls =
        distributionDataCache?.cacheKey === cacheKey ? distributionDataCache.allCalls : [];

      let mergedCalls = existingCalls;
      let addedCount = 0;
      let updatedCount = 0;

      if (deltaCalls.length > 0) {
        const distMerge = mergeCallsDelta(mergedCalls, deltaCalls);
        mergedCalls = distMerge.merged;
        addedCount += distMerge.addedCount;
        updatedCount += distMerge.updatedCount;
      }

      if (registerDeltas.length > 0 && mergedCalls.length > 0) {
        const registerPatches = registerDeltas.map((row: Record<string, unknown>) =>
          mapRegisterRowToDistributionPatch(row)
        );
        const registerMerge = patchCallsDelta(mergedCalls, registerPatches);
        mergedCalls = registerMerge.merged;
        addedCount += registerMerge.addedCount;
        updatedCount += registerMerge.updatedCount;
      } else if (registerDeltas.length > 0 && distributionDataCache?.cacheKey === cacheKey) {
        const registerPatches = registerDeltas.map((row: Record<string, unknown>) =>
          mapRegisterRowToDistributionPatch(row)
        );
        const registerMerge = patchCallsDelta([], registerPatches);
        mergedCalls = registerMerge.merged;
        addedCount += registerMerge.addedCount;
        updatedCount += registerMerge.updatedCount;
      }

      const hasDataChanges = deltaCalls.length > 0 || registerDeltas.length > 0;

      if (hasDataChanges && distributionDataCache?.cacheKey === cacheKey) {
        const nextCache: DistributionDataCache = {
          ...distributionDataCache,
          allCalls: mergedCalls,
          fetchedAt: syncTime.getTime(),
          lastSyncedAt: syncTime.getTime(),
        };
        applySharedCallsCache(nextCache);
      } else if (distributionDataCache?.cacheKey === cacheKey) {
        const nextCache: DistributionDataCache = {
          ...distributionDataCache,
          lastSyncedAt: syncTime.getTime(),
        };
        setDistributionDataCache(nextCache);
        setLastSyncedAt(syncTime);
      }

      if (registerDeltas.length > 0) {
        notifyRegisterDelta(registerDeltas, syncTime);
      } else {
        notifyRegisterDelta([], syncTime);
      }

      setLastSyncedAt(syncTime);

      const toastParts: string[] = [];
      if (addedCount > 0) toastParts.push(`${addedCount} added`);
      if (updatedCount > 0) toastParts.push(`${updatedCount} updated`);
      if (toastParts.length === 0) {
        toast.info('No calls added or updated in the last minute');
      } else {
        toast.success(`${toastParts.join(', ')} in the last minute`);
      }
    } catch (err: any) {
      toast.error('Failed to sync calls: ' + (err.response?.data?.error || err.message));
    } finally {
      syncInFlightRef.current = false;
      setSyncInProgress(false);
    }
  }, [
    applySharedCallsCache,
    ensureSharedCallsLoaded,
    getDateStrings,
    getSharedCacheKey,
    lastSyncedAt,
    pathname,
    selectedCallTypes,
    selectedOfficeIds,
    supabase,
  ]);

  useEffect(() => {
    if (!resourcesLoaded || !needsDistributionPreload) return;
    ensureSharedCallsLoaded();
  }, [resourcesLoaded, needsDistributionPreload, ensureSharedCallsLoaded, dateRange, selectedCallTypes]);

  useEffect(() => {
    if (!resourcesLoaded) return;
    if (!lastSyncedAt && !distributionDataCache?.lastSyncedAt && !globalReportCache?.lastRefreshed) return;

    const timer = window.setInterval(() => {
      runBackgroundSync();
    }, REPORT_SYNC_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [resourcesLoaded, lastSyncedAt, runBackgroundSync]);

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
    pincodeSearch,
    setPincodeSearch,
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
    rehydrateDistributionFromCache,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
  }), [
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
    rehydrateDistributionFromCache,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
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
