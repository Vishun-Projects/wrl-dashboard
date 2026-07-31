'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { signOutAndGoToLogin } from '@/lib/auth/sign-out-client';
import {
  isSessionExpiredResponse,
  showSessionExpired,
} from '@/lib/auth/session-expired-client';
import {
  defaultMisTab,
  type MisTabId,
} from '@/lib/auth/rbac-catalog';
import axios from 'axios';
import {
  getRegisterCellClassName,
  renderRegisterCell as renderRegisterCellBase,
} from '@/features/report/components/RegisterTableCells';
import { useReportExportQueue } from '@/features/report/hooks/useReportExportQueue';
import type { ExportQueueRunContext } from '@/features/report/services/export-queue';
import { isExportActiveForTab } from '@/features/report/services/export-queue';
import { consumeExportInterruptedFlag, markExportInterrupted } from '@/features/report/services/export-queue-session';
import { exportLabelForMisTab } from '@/features/report/services/export-labels';
import { ReportErrorBoundary } from '@/features/report/components/ReportErrorBoundary';
import { ReportPageOverlays } from '@/features/report/components/ReportPageOverlays';
import { ReportPageHeaderBar } from '@/features/report/components/ReportPageHeaderBar';
import { ReportSharedFiltersBar } from '@/features/report/components/ReportSharedFiltersBar';
import { ReportRegisterTabPanel } from '@/features/report/components/ReportRegisterTabPanel';
import { ReportSummaryTabPanel } from '@/features/report/components/ReportSummaryTabPanel';
import { ReportAccountsTabPanel } from '@/features/report/components/ReportAccountsTabPanel';
import { ReportBdMisTabPanel } from '@/features/report/components/ReportBdMisTabPanel';
import { ReportPageSkeleton } from '@/features/report/components/ReportLoadingFeedback';
import { useRegisterFilterOptions } from '@/features/report/hooks/useRegisterFilterOptions';
import { feedback } from '@/lib/ui/feedback';
import { useUser } from '@/components/layout/DashboardLayout';
import { CallRegisterClient } from '@/app/report/call-register/call-register-client';

import { RegisterPageFilters } from '@/features/register/components/RegisterPageFilters';
import { useReportFilters } from '@/features/report/components/ReportFiltersContext';
import {
  appendRegisterListFilters,
  appliedFilterPartsFromSnapshot,
  emptyRegisterViewFilterParts,
  isBaseRegisterPersistFilter,
  buildSummaryQueryKey,
  normalizeAgingAsOfDate,
  normalizeRegisterPageSize,
  readStoredRegisterPageSize,
  type RegisterPageSize,
  joinFilterParam,
  resolveViewCallTypesParam,
  resolveSummaryOfficeIdsParam,
  toDateString,
} from '@/features/report/services/filters';
import {
  loadVisibleRegisterColumns,
  REGISTER_TABLE_COLUMNS,
  saveVisibleRegisterColumns,
  type RegisterTableColumnKey,
} from '@/features/register';
import type { TableSortState } from '@/lib/ui/table-sort';
import { MAX_CLIENT_CORPUS_DAYS, resolveRegisterDateSqlColumn } from '@/lib/trhcalls/query';
import {
  findCallsInIndexedDb,
  findCallsInMemoryCaches,
  isIdentifierLookupSearch,
  isTrnLikeSearch,
  summarizeRegisterRows,
  normalizeRegisterSummary,
  type RegisterSummary,
  type RegisterViewFilterParts,
} from '@/features/report/services/search';
import { mergeRegisterDeltaRecords } from '@/features/report/services/register-delta';
import { globalReportCache, setGlobalReportCache, distributionDataCache, setDistributionDataCache, callCorpusStore } from '@/features/report/services/data-store';
import { indexRegisterRowsWithSerial, subscribeRegisterDelta } from '@/features/report/services/sync';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  adoptCorpusStoreForScope,
  corpusStoreCoversFetchScope,
  deriveRegisterPageFromCorpus,
  filterCorpusCallsByViewDate,
  getFilteredCorpusCalls,
  getCorpusCallsArray,
  restoreCorpusFromIndexedDB,
} from '@/features/report/services/corpus';
import { readCorpusMeta } from '@/features/report/services/corpus-storage';
import { deriveSummaryDashboard, diagnoseSummaryDerivation } from '@/lib/summary/derive';
import {
  readRegisterFromPostgresClient,
  readSummaryFromPostgresClient,
  registerPostgresHotPathAvailable,
} from '@/lib/read-model/client-flags';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { deriveRegisterPageFromCalls, deriveRegisterView } from '@/features/report/services/register-view';
import {
  collectRegisterRowsFromSessionCache,
  prepareRegisterCsvFromServer,
  fetchAllRegisterRowsForExport,
  isRegisterExportAbortError,
  logRegisterBulk,
  shouldStreamRegisterExportFromServer,
} from '@/features/register';
import { clearPortalAuditCache, ensurePortalAuditCache } from '@/features/report/services/portal-cache';
import ClientImportTab from '@/features/report/components/ClientImportTab';
import type { BdMisGrandRow, BdMisRegionalRow, BdMisSourceFlags } from '@/features/report/services/bd-mis-summary';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';
import { loadClientMergeWithCrmPrefs } from '@/features/report/components/MisClientMergeCheckbox';
import {
  buildAccountDisplayRows,
  type ClientMergeWithCrmPrefs,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeFlagsFromSelection,
} from '@/features/report/components/SummaryMergedMetricCell';
import {
  isClientOnlyMode,
  loadMisSourceSelection,
  saveMisSourceSelection,
  sourceCodesToParam,
  type MisSourceSelection,
} from '@/features/mis-import';

import {
  corpusSpanDays,
  getCallsFromDB,
  getMeta,
  isApiShapedSummary,
  logSummaryDebug,
  registerPageCacheGet,
  registerPageCachePut,
  reportPerf,
  reportPerfLogDocumentNavigationOnce,
  resolveAccountMisTableRows,
  saveCallsToDB,
  saveMeta,
  type AccountMisGrouping,
  type RegisterPageCacheEntry,
  type ReportIdbCacheParams,
} from '@/features/report/services/report-page-helpers';
import {
  buildMisAccess,
  buildMisTabs,
  resolveActiveMisTab,
} from '@/features/report/services/mis-tab-access';
import {
  buildRegisterExportQueryFromViewFilters,
  buildRegisterListQueryKeyFromViewFilters,
} from '@/features/report/services/register-query-builders';
import {
  buildSummaryQueryKeyFromSnapshot,
} from '@/features/report/services/summary-query-key';

/** Cadbury+Coke+CRM Summary tab — hidden until reconciliation is production-ready. */
const BD_MIS_SUMMARY_TAB_ENABLED = false;

export default function ReportPageClient() {
  const [mounted, setMounted] = useState(false);
  const { userProfile } = useUser();
  const userPermissions = (userProfile?.permissions ?? []) as string[];
  const misAccess = useMemo(
    () => buildMisAccess(userPermissions, BD_MIS_SUMMARY_TAB_ENABLED),
    [userPermissions]
  );

  const misTabs = useMemo(
    () => buildMisTabs(userPermissions, BD_MIS_SUMMARY_TAB_ENABLED),
    [userPermissions]
  );

  useEffect(() => {
    if (!userProfile?.permissions?.length) return;
    const nextTab = defaultMisTab(userPermissions);
    setActiveTab((current) => resolveActiveMisTab(current, misTabs, nextTab));
  }, [userProfile?.permissions, userPermissions, misTabs]);

  const supabase = createClient();
  const pageSessionStartRef = React.useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const {
    search,
    pincodeSearch,
    debouncedSearch,
    debouncedPincodeSearch,
    dateRange,
    setDateRange,
    agingAsOf,
    setAgingAsOf,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    setSelectedCallTypes,
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
    setStatesList,
    setCitiesList,
    setRegionsList,
    setAccountsList,
    techniciansList,
    setTechniciansList,
    setBranchesList,
    setFranchiseesList,
    clearAllFilters,
    isAnyFilterActive: isAnyRegisterFilterActive,
    callTypeOptions,
    offices,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    ensureCorpusLoaded,
    corpusTick,
    corpusLoading,
    distributionCalls,
    ensureSharedCallsLoaded,
    appliedFilters,
    appliedRevision,
    applyFilters,
    getAppliedFiltersSnapshot,
    hasPendingFilterChanges,
    reportBanner,
    setReportError,
    clearReportBanner,
    refreshDelta,
    clearRefreshDelta,
  } = useReportFilters();

  const { loadFilterOptions, resetFilterOptionsCache } = useRegisterFilterOptions(
    supabase,
    appliedFilters,
    {
      setStatesList,
      setCitiesList,
      setRegionsList,
      setAccountsList,
      setBranchesList,
      setFranchiseesList,
      setTechniciansList,
    }
  );

  useEffect(() => {
    resetFilterOptionsCache();
  }, [appliedRevision, resetFilterOptionsCache]);

  const [orientationDismissed, setOrientationDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('report-orientation-dismissed') === '1';
  });

  const summaryOfficeIdsParam = useMemo(
    () =>
      resolveSummaryOfficeIdsParam(
        offices,
        appliedFilters?.selectedBranch ?? selectedBranch,
        appliedFilters?.selectedFranchisee ?? selectedFranchisee
      ),
    [offices, appliedFilters, selectedBranch, selectedFranchisee]
  );
  const registerOfficeIdsParam = 'All';

  const [dbInitialized, setDbInitialized] = useState(!!globalReportCache);
  const [activeTab, setActiveTab] = useState<MisTabId>('register');
  const [visibleRegisterColumns, setVisibleRegisterColumns] = useState<RegisterTableColumnKey[]>(() =>
    loadVisibleRegisterColumns()
  );
  const [data, setData] = useState<any[]>(globalReportCache?.data || []);
  const [summaryData, setSummaryData] = useState<any[]>(globalReportCache?.summaryData || []);
  const [clientSummaryData, setClientSummaryData] = useState<any[]>([]);
  const [clientAccountSummaryData, setClientAccountSummaryData] = useState<any[]>([]);
  const [uploadSource, setUploadSource] = useState('coke');
  const [clientImportActiveSources, setClientImportActiveSources] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [sourceSelection, setSourceSelection] = useState<MisSourceSelection>(() =>
    loadMisSourceSelection()
  );
  const mergeFlags = useMemo(() => mergeFlagsFromSelection(sourceSelection), [sourceSelection]);
  const sourceSelectionKey = useMemo(
    () => [...sourceSelection.clientSourceCodes].sort().join(','),
    [sourceSelection.clientSourceCodes]
  );
  const clientOnlyMode = isClientOnlyMode(sourceSelection);
  const alignCrmToAccounts = mergeFlags.crm && mergeFlags.client;
  const [accountsData, setAccountsData] = useState<any[]>(globalReportCache?.accountsData || []);
  const mergedAccountRowsForTotals = useMemo(
    () => buildAccountDisplayRows(accountsData, clientAccountSummaryData, mergeFlags),
    [accountsData, clientAccountSummaryData, mergeFlags]
  );
  const [globalHeadcount, setGlobalHeadcount] = useState<number>(globalReportCache?.globalHeadcount || 0);
  const [loading, setLoading] = useState(!globalReportCache);
  const [filterUpdating, setFilterUpdating] = useState(false);
  const [summaryTabLoading, setSummaryTabLoading] = useState(false);
  const [bdMisTabLoading, setBdMisTabLoading] = useState(false);
  const [bdMisRegionalRows, setBdMisRegionalRows] = useState<BdMisRegionalRow[]>([]);
  const [bdMisGrand, setBdMisGrand] = useState<BdMisGrandRow | null>(null);
  const [bdMisExportData, setBdMisExportData] = useState<{
    regionalRows: BdMisRegionalRow[];
    grand: BdMisGrandRow;
    crmBranchSummary: BranchSummaryRow[];
    crmAccountSummary: AccountSummaryRow[];
    clientAccountSummary: AccountSummaryRow[];
    sources: BdMisSourceFlags;
  } | null>(null);
  const [total, setTotal] = useState<number>(globalReportCache?.total || 0);

  useEffect(() => {
    if (!globalReportCache?.data) {
      try {
        const cached = localStorage.getItem('report_fortnight_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.data) setData(parsed.data);
          if (parsed.total) setTotal(parsed.total);
        }
      } catch { /* ignore */ }
    }
    setMounted(true);
  }, []);
  const [page, setPage] = useState(globalReportCache?.page || 1);
  const [limit, setLimit] = useState(readStoredRegisterPageSize);
  const [registerSort, setRegisterSort] =
    useState<TableSortState<RegisterTableColumnKey> | null>(null);

  const technicianRoster = useMemo(
    () =>
      techniciansList.map((t: { ncode: string; vname: string }) => ({
        value: String(t.ncode),
        label: String(t.vname || t.ncode),
      })),
    [techniciansList]
  );
  const [, setLoadingPage] = useState<number | null>(null);
  const registerPagesCacheRef = React.useRef<Map<string, Map<number, RegisterPageCacheEntry>>>(new Map());
  const lastKnownRegisterTotalRef = React.useRef<number>(globalReportCache?.total || 0);
  const clearFiltersRef = React.useRef<boolean>(false);

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

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

  useEffect(() => {
    reportPerfLogDocumentNavigationOnce();
    const tMount = performance.now();
    reportPerf('lifecycle', 'ReportPage mount effect (after paint)', tMount, {
      why: 'Runs after first paint; msSincePageSessionStart ≈ time from component render start to this effect.',
      msSincePageSessionStart: Number((tMount - pageSessionStartRef.current).toFixed(1)),
    });
  }, []);

  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(globalReportCache?.lastRefreshed || null);
  const [filterRegion, setFilterRegion] = useState<string[]>(globalReportCache?.filterRegion || []); // Array for multiselect
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string[]>(Array.isArray(globalReportCache?.filterAccount) ? globalReportCache.filterAccount : []);
  const [accountMisGrouping, setAccountMisGrouping] = useState<AccountMisGrouping>(() => {
    if (typeof window === 'undefined') return 'zone';
    const saved = localStorage.getItem('report_account_mis_grouping');
    if (saved === 'overview') return 'overview';
    if (saved === 'zone-top') return 'zone-top';
    return 'zone';
  });
  const [accountMisTopN, setAccountMisTopN] = useState(() => {
    if (typeof window === 'undefined') return 5;
    const n = parseInt(localStorage.getItem('report_account_mis_top_n') ?? '5', 10);
    return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 5;
  });
  const [clientMergeWithCrm, setClientMergeWithCrm] = useState<ClientMergeWithCrmPrefs>(
    loadClientMergeWithCrmPrefs
  );
  const [accountMisZoneTopExclude, setAccountMisZoneTopExclude] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [...DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS];
    try {
      const raw = localStorage.getItem('report_account_mis_zone_top_exclude');
      if (!raw) return [...DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [...DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS];
    } catch {
      return [...DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS];
    }
  });
  const [showZoneTopExcludeDropdown, setShowZoneTopExcludeDropdown] = useState(false);
  const [tempZoneTopExclude, setTempZoneTopExclude] = useState<string[]>([]);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [tempFilterRegion, setTempFilterRegion] = useState<string[]>([]);
  const [tempFilterAccount, setTempFilterAccount] = useState<string[]>([]);
  const {
    items: exportQueueItems,
    enqueue: enqueueExport,
    cancelJob: cancelExportJob,
    clearFinished: clearFinishedExports,
  } = useReportExportQueue({
    onExportComplete: ({ filename, warning }) => {
      if (warning) {
        feedback.actionWarning(warning, {
          description: `Save ${filename} from the export queue when ready.`,
        });
        return;
      }
      feedback.actionSuccess(`Export ready — save ${filename} from the queue.`);
    },
  });

  const resolveSummaryAgingStr = useCallback(
    (applied?: ReturnType<typeof getAppliedFiltersSnapshot>) => {
      const snap = applied ?? getAppliedFiltersSnapshot();
      return normalizeAgingAsOfDate(snap?.agingAsOf ?? agingAsOf);
    },
    [getAppliedFiltersSnapshot, agingAsOf]
  );

  const registerExportScopeKey = useMemo(
    () =>
      buildRegisterListQueryKeyFromViewFilters({
        officeIdsParam: summaryOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        startDateStr: toDateString(dateRange.start),
        endDateStr: toDateString(dateRange.end),
        dateFilterColumn,
        viewFilters: currentViewFilters,
        agingAsOf: agingAsOf || '',
        pageLimit: limit,
      }),
    [
      summaryOfficeIdsParam,
      viewCallTypesParam,
      currentViewFilters,
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      agingAsOf,
      limit,
    ]
  );

  const cancelRegisterExportsOnScopeChange = useCallback(() => {
    for (const item of exportQueueItems) {
      if (
        (item.status === 'queued' || item.status === 'running') &&
        item.sourceTab === 'register'
      ) {
        cancelExportJob(item.id);
      }
    }
  }, [exportQueueItems, cancelExportJob]);

  const isCurrentTabExcelExporting = isExportActiveForTab(exportQueueItems, activeTab, 'standard');
  const isCurrentTabTraceExporting = isExportActiveForTab(exportQueueItems, activeTab, 'trace');

  useEffect(() => {
    if (consumeExportInterruptedFlag()) {
      feedback.cancelled(
        'Exports in progress were cancelled when you refreshed or left this page. Check your Downloads folder for files that already finished.'
      );
    }
  }, []);

  useEffect(() => {
    const hasActive = exportQueueItems.some(
      (item) =>
        item.status === 'queued' || item.status === 'running' || item.status === 'downloading'
    );
    if (!hasActive) return;

    const onBeforeUnload = () => markExportInterrupted();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [exportQueueItems]);

  const prevRegisterExportScopeKeyRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (
      prevRegisterExportScopeKeyRef.current !== null &&
      prevRegisterExportScopeKeyRef.current !== registerExportScopeKey
    ) {
      cancelRegisterExportsOnScopeChange();
    }
    prevRegisterExportScopeKeyRef.current = registerExportScopeKey;
  }, [registerExportScopeKey, cancelRegisterExportsOnScopeChange]);

  const [, setSelectedCallId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleFlagUpdate = async (id: string, flag: string) => {
    const previousData = data;
    const previousSelected = selectedCall;
    setData(prev => prev.map(d => (String(d.id) === String(id) ? { ...d, audit_flag: flag } : d)));
    setSelectedCall((prev: any) => (prev && String(prev.id) === String(id) ? { ...prev, audit_flag: flag } : prev));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post('/api/flags', {
        call_id: id,
        flag_type: flag,
        office_id: selectedCall?.nofficeid || undefined,
        vtrnno: selectedCall?.UniqueCallNo || undefined
      }, { headers: { 'Authorization': `Bearer ${session?.access_token}` } });
      clearPortalAuditCache();
    } catch (err) {
      setData(previousData);
      setSelectedCall(previousSelected);
      throw err;
    }
  };

  const handlePostComment = async (id: string, text: string) => {
    const previousData = data;
    const previousSelected = selectedCall;
    const targetCall = data.find(d => String(d.id) === String(id)) || selectedCall;
    const newComment = { author_name: userProfile?.name || 'User', comment: text, created_at: new Date().toISOString(), author_avatar_url: userProfile?.avatar_url || null };
    setData(prev => prev.map(d => (String(d.id) === String(id) ? {
      ...d,
      comments: [newComment, ...(d.comments || [])],
      comment_count: (d.comment_count || 0) + 1,
    } : d)));
    if (selectedCall && String(selectedCall.id) === String(id)) {
      setSelectedCall((prev: any) => ({
        ...prev,
        comments: [newComment, ...(prev.comments || [])],
        comment_count: (prev.comment_count || 0) + 1,
      }));
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post('/api/comments', { call_id: id, text, office_id: targetCall?.nofficeid }, { headers: { 'Authorization': `Bearer ${session?.access_token}` } });
      clearPortalAuditCache();
    } catch (err) {
      setData(previousData);
      setSelectedCall(previousSelected);
      throw err;
    }
  };

  const handleSelectCall = async (id: string, row?: Record<string, unknown>) => {
    setSelectedCallId(id);
    setIsDrawerOpen(true);
    const targetCall = row || data.find(d => String(d.id) === String(id));
    setSelectedCall(targetCall ? {
      ...targetCall,
      id: String(targetCall.id),
      office_id: targetCall.office_id || String(targetCall.nofficeid || ''),
      customer_name: targetCall.customer_name || targetCall.PartyName,
      branch_name: targetCall.branch_name || targetCall.officename,
      engineer_name: targetCall.engineer_name || targetCall.serviceman,
      vtrnno: targetCall.vtrnno || targetCall.UniqueCallNo,
    } : { id });
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (targetCall?.nofficeid) params.append('officeId', String(targetCall.nofficeid));
      if (targetCall?.UniqueCallNo) params.append('vtrnno', targetCall.UniqueCallNo);
      
      const res = await axios.get(`/api/calls/${id}?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setSelectedCall({
        ...(targetCall || {}),
        ...res.data
      });
    } catch (err: any) {
      feedback.actionFailed(
        sanitizeUserFacingMessage(
          String(err.response?.data?.error || 'Failed to load call details')
        )
      );
    }
  };


  // We no longer sync data to localStorage here to avoid overwriting base cache with filtered data.

  const [drillDown, setDrillDown] = useState<{
    isOpen: boolean;
    loading: boolean;
    data: Array<Record<string, unknown>>;
    type: string;
    title: string;
    params: Record<string, unknown> | null;
  }>({
    isOpen: false,
    loading: false,
    data: [],
    type: '',
    title: '',
    params: null
  });
  const [registerSummary, setRegisterSummary] = useState<RegisterSummary | null>(
    normalizeRegisterSummary(globalReportCache?.registerSummary)
  );

  useEffect(() => {
    saveVisibleRegisterColumns(visibleRegisterColumns);
  }, [visibleRegisterColumns]);

  const visibleRegisterColumnDefs = React.useMemo(
    () => REGISTER_TABLE_COLUMNS.filter((col) => visibleRegisterColumns.includes(col.key)),
    [visibleRegisterColumns]
  );

  const renderRegisterCell = (key: RegisterTableColumnKey, row: any) =>
    renderRegisterCellBase(key, row, {
      onSelectCall: handleSelectCall,
      priorityFilter,
      technicianRoster,
    });

  const fetchControllerRef = React.useRef<AbortController | null>(null);
  const registerAuthFailedRef = React.useRef(false);
  const drillDownControllerRef = React.useRef<AbortController | null>(null);
  const lastSummaryQueryKeyRef = React.useRef<string | null>(globalReportCache?.summaryQueryKey ?? null);
  const lastRegisterListQueryKeyRef = React.useRef<string | null>(null);
  const lastAppliedFilterSnapshotRef = React.useRef<string | null>(null);
  const filterEffectInFlightRef = React.useRef(false);
  const summaryFilterLoadInFlightRef = React.useRef(false);
  const summaryFilterLoadKeyRef = React.useRef<string | null>(null);
  const summaryTabLoadRef = React.useRef(0);
  const summaryUserApplyRef = React.useRef(false);
  const runSummaryFilterLoadRef = React.useRef<(generation: number) => Promise<void>>(async () => {});
  const clientImportSourceFetchTabRef = React.useRef<MisTabId | null>(null);
  const prevSourceSelectionKeyRef = React.useRef<string | null>(null);
  const fetchClientImportSummaryRef = React.useRef<
    (scope?: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >(async () => {});
  const refreshClientImportOverlayRef = React.useRef<
    (scope: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >(async () => {});
  const resolveClientImportScopeRef = React.useRef<
    () => { startDate: string; endDate: string; agingAsOf: string } | null
  >(() => null);
  const dataRef = React.useRef(data);
  const totalRef = React.useRef(total);
  const registerSummaryRef = React.useRef(registerSummary);
  const summaryDataRef = React.useRef(summaryData);
  const accountsDataRef = React.useRef(accountsData);
  const globalHeadcountRef = React.useRef(globalHeadcount);
  dataRef.current = data;
  totalRef.current = total;
  registerSummaryRef.current = registerSummary;
  summaryDataRef.current = summaryData;
  accountsDataRef.current = accountsData;
  globalHeadcountRef.current = globalHeadcount;
  const registerViewFilterRef = React.useRef<RegisterViewFilterParts>({
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
  });
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

  // Client-side cascades computation removed in favor of server-side cascades

  const persistCurrentCache = async (
    calls: any[],
    summaryData: any[],
    accountsData: any[],
    globalHeadcount: number,
    total: number,
    registerSummary: any,
    lastRefreshedDate: Date
  ) => {
    try {
      const isBaseFilter = isBaseRegisterPersistFilter({
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
        filterAccount: Array.isArray(filterAccount) ? filterAccount : [],
        filterRegion,
      });

      if (isBaseFilter) {
        try {
          localStorage.setItem('report_fortnight_cache', JSON.stringify({
            data: calls.slice(0, 100),
            total,
            summaryData,
            accountsData,
            globalHeadcount
          }));
        } catch { /* ignore */ }
          
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
          total,
          registerSummary,
          summaryData,
          accountsData,
          globalHeadcount,
          summaryQueryKey: lastSummaryQueryKeyRef.current ?? globalReportCache?.summaryQueryKey,
        });
      }
    } catch (err) {
      console.error('Failed to persist cache to IndexedDB:', err);
    }
  };


  /** Summary/Accounts rows must include region hierarchy and headcount. */

  const buildCurrentSummaryQueryKey = () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    return buildSummaryQueryKeyFromSnapshot({
      offices,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedCallTypes: applied.selectedCallTypes,
      startDateStr: toDateString(applied.dateRange.start),
      endDateStr: toDateString(applied.dateRange.end),
      agingAsOf: applied.agingAsOf,
    });
  };

  const hydrateSummaryFromCache = (): boolean => {
    const summaryQueryKey = buildCurrentSummaryQueryKey();
    if (!summaryQueryKey) return false;
    const cachedSummary = globalReportCache?.summaryData?.length
      ? globalReportCache.summaryData
      : summaryDataRef.current;
    const cachedAccounts = globalReportCache?.accountsData?.length
      ? globalReportCache.accountsData
      : accountsDataRef.current;

    if (!cachedSummary.length || !isApiShapedSummary(cachedSummary)) {
      return false;
    }

    const exactKeyMatch =
      globalReportCache?.summaryQueryKey === summaryQueryKey ||
      lastSummaryQueryKeyRef.current === summaryQueryKey;

    if (!exactKeyMatch) {
      return false;
    }

    if (summaryDataRef.current !== cachedSummary) setSummaryData(cachedSummary);
    if (accountsDataRef.current !== cachedAccounts) setAccountsData(cachedAccounts || []);
    if (globalReportCache?.globalHeadcount !== undefined) {
      setGlobalHeadcount(globalReportCache.globalHeadcount);
    }
    lastSummaryQueryKeyRef.current = summaryQueryKey;
    return true;
  };

  const commitSummaryResult = useCallback(
    (
      branchSummary: ReturnType<typeof deriveSummaryDashboard>['branchSummary'],
      accountSummary: ReturnType<typeof deriveSummaryDashboard>['accountSummary'],
      headcount: number,
      startDateStr: string,
      endDateStr: string,
      agingStr: string,
      appliedOverride?: ReturnType<typeof getAppliedFiltersSnapshot>
    ) => {
      const applied = appliedOverride ?? getAppliedFiltersSnapshot();
      const summaryQueryKey = applied
        ? buildSummaryQueryKeyFromSnapshot({
            offices,
            selectedBranch: applied.selectedBranch,
            selectedFranchisee: applied.selectedFranchisee,
            selectedCallTypes: applied.selectedCallTypes,
            startDateStr,
            endDateStr,
            agingAsOf: agingStr,
          })
        : buildSummaryQueryKey({
            officeIdsParam: summaryOfficeIdsParam,
            callTypesParam: viewCallTypesParam,
            startDateStr,
            endDateStr,
            agingAsOf: agingStr,
          });

      setSummaryData(branchSummary);
      setAccountsData(accountSummary);
      setGlobalHeadcount(headcount);
      lastSummaryQueryKeyRef.current = summaryQueryKey;

      if (globalReportCache) {
        globalReportCache.summaryData = branchSummary;
        globalReportCache.accountsData = accountSummary;
        globalReportCache.globalHeadcount = headcount;
        globalReportCache.summaryQueryKey = summaryQueryKey;
        globalReportCache.agingAsOf = agingStr;
      }

      void persistCurrentCache(
        globalReportCache?.data || dataRef.current,
        branchSummary,
        accountSummary,
        headcount,
        totalRef.current,
        registerSummaryRef.current,
        callCorpusStore?.lastSyncedAt ? new Date(callCorpusStore.lastSyncedAt) : new Date()
      );
    },
    [getAppliedFiltersSnapshot, offices, summaryOfficeIdsParam, viewCallTypesParam, callCorpusStore?.lastSyncedAt]
  );

  const deriveSummaryFromCorpusPayload = useCallback((): {
    branchSummary: ReturnType<typeof deriveSummaryDashboard>['branchSummary'];
    accountSummary: ReturnType<typeof deriveSummaryDashboard>['accountSummary'];
    globalHeadcount: number;
    startDateStr: string;
    endDateStr: string;
    agingStr: string;
  } | null => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    const appliedDateColumn = applied.dateFilterColumn;
    const officeIdsParam = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, appliedDateColumn);
    const spanDays = corpusSpanDays(startDateStr, endDateStr);
    const deriveOpts = {
      agingAsOf: agingStr,
      endDate: endDateStr,
      officeIdsParam,
      callTypesParam,
    };
    const store = callCorpusStore;

    if (!store?.calls.size || store.cacheKey !== corpusKey) {
      logSummaryDebug('corpus not ready — summary cannot derive client-side', {
        reason: !store?.calls.size ? 'empty_or_missing_corpus' : 'cache_key_mismatch',
        expectedCorpusKey: corpusKey,
        actualCorpusKey: store?.cacheKey ?? null,
        corpusCallCount: store?.calls.size ?? 0,
        dateRange: `${startDateStr} → ${endDateStr}`,
        spanDays,
        maxClientCorpusDays: MAX_CLIENT_CORPUS_DAYS,
        exceedsCorpusLimit: spanDays > MAX_CLIENT_CORPUS_DAYS,
        officeFilter: officeIdsParam,
        callTypeFilter: callTypesParam,
        nextStep:
          spanDays > MAX_CLIENT_CORPUS_DAYS
            ? 'Will fetch /api/report/summary (full SQL range; client corpus capped at 120 days)'
            : 'Will retry after corpus load or fall back to /api/report/summary',
      });
      return null;
    }

    const calls = filterCorpusCallsByViewDate(getCorpusCallsArray(store), viewDateFilter);
    const viewFilters = registerViewFilterRef.current;
    const { filteredCalls } = deriveRegisterView(calls, viewFilters, viewDateFilter);
    const diagnostic = diagnoseSummaryDerivation(filteredCalls, deriveOpts);
    const { branchSummary, accountSummary, globalHeadcount: headcount } = deriveSummaryDashboard(
      filteredCalls,
      {
        ...deriveOpts,
        officeIdsParam: 'All',
        callTypesParam: 'All',
      }
    );

    logSummaryDebug('derived from corpus', {
      ...diagnostic,
      corpusTruncated: store.truncated ?? false,
      branchRows: branchSummary.length,
      accountRows: accountSummary.length,
      globalHeadcount: headcount,
      emptyReason:
        branchSummary.length === 0
          ? diagnostic.afterCallTypeFilter === 0
            ? diagnostic.afterOfficeFilter === 0
              ? diagnostic.eligibleCalls === 0
                ? 'no_eligible_calls_in_corpus'
                : 'office_filter_excluded_all_calls'
              : 'call_type_filter_excluded_all_calls'
            : 'aggregation_produced_no_branch_rows'
          : null,
    });

    return {
      branchSummary,
      accountSummary,
      globalHeadcount: headcount,
      startDateStr,
      endDateStr,
      agingStr,
    };
  }, [getAppliedFiltersSnapshot, offices]);

  const applySummaryFromCorpus = useCallback((): boolean => {
    const payload = deriveSummaryFromCorpusPayload();
    if (!payload) return false;
    commitSummaryResult(
      payload.branchSummary,
      payload.accountSummary,
      payload.globalHeadcount,
      payload.startDateStr,
      payload.endDateStr,
      payload.agingStr
    );
    void refreshClientImportOverlayRef.current({
      startDate: payload.startDateStr,
      endDate: payload.endDateStr,
      agingAsOf: payload.agingStr,
    });
    return payload.branchSummary.length > 0 || (callCorpusStore?.calls.size ?? 0) > 0;
  }, [deriveSummaryFromCorpusPayload, commitSummaryResult]);

  const commitClientImportSummary = useCallback(
    (client: {
      clientBranchSummary: any[];
      clientAccountSummary: any[];
      rowsInDateRange: number;
      totalRowsInFiles: number;
    }) => {
      setClientSummaryData(client.clientBranchSummary);
      setClientAccountSummaryData(client.clientAccountSummary);
    },
    []
  );

  const loadClientImportSummaryPayload = useCallback(
    async (scope: { startDate: string; endDate: string; agingAsOf: string }) => {
      const sourceCodes = sourceCodesToParam(sourceSelection.clientSourceCodes);
      try {
        const res = await axios.get('/api/mis-client-import/summary', {
          withCredentials: true,
          params: {
            startDate: scope.startDate,
            endDate: scope.endDate,
            agingAsOf: scope.agingAsOf,
            ...(sourceCodes ? { sourceCodes } : {}),
          },
        });
        return {
          clientBranchSummary: res.data?.clientBranchSummary ?? [],
          clientAccountSummary: res.data?.clientAccountSummary ?? [],
          rowsInDateRange: Number(res.data?.rowsInDateRange ?? 0),
          totalRowsInFiles: Number(res.data?.totalRowsInFiles ?? 0),
        };
      } catch (err) {
        console.warn('Client import summary fetch failed:', err);
        return {
          clientBranchSummary: [],
          clientAccountSummary: [],
          rowsInDateRange: 0,
          totalRowsInFiles: 0,
        };
      }
    },
    [sourceSelection.clientSourceCodes]
  );

  const commitSummaryLoadBundle = useCallback(
    (
      crm: {
        branchSummary: ReturnType<typeof deriveSummaryDashboard>['branchSummary'];
        accountSummary: ReturnType<typeof deriveSummaryDashboard>['accountSummary'];
        globalHeadcount: number;
        startDateStr: string;
        endDateStr: string;
        agingStr: string;
      } | null,
      client: {
        clientBranchSummary: any[];
        clientAccountSummary: any[];
        rowsInDateRange: number;
        totalRowsInFiles: number;
      } | null,
      appliedOverride?: ReturnType<typeof getAppliedFiltersSnapshot>
    ) => {
      if (crm) {
        commitSummaryResult(
          crm.branchSummary,
          crm.accountSummary,
          crm.globalHeadcount,
          crm.startDateStr,
          crm.endDateStr,
          crm.agingStr,
          appliedOverride
        );
      }
      if (client) {
        commitClientImportSummary(client);
      } else if (crm) {
        void refreshClientImportOverlayRef.current({
          startDate: crm.startDateStr,
          endDate: crm.endDateStr,
          agingAsOf: crm.agingStr,
        });
      }
    },
    [commitSummaryResult, commitClientImportSummary]
  );

  const loadSummaryFromApiPayload = useCallback(async () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const summaryOfficeIds = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);

    try {
      const res = await axios.get('/api/report/summary', {
        withCredentials: true,
        params: {
          officeId: summaryOfficeIds,
          callType: callTypesParam,
          startDate: startDateStr,
          endDate: endDateStr,
          agingAsOf: agingStr,
        },
      });

      const branchSummary = res.data?.branchSummary ?? [];
      const accountSummary = res.data?.accountSummary ?? [];
      const headcount = Number(res.data?.globalHeadcount ?? 0);

      logSummaryDebug('loaded from /api/report/summary', {
        branchRows: branchSummary.length,
        accountRows: accountSummary.length,
        globalHeadcount: headcount,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIds,
        callTypeFilter: callTypesParam,
        emptyReason:
          branchSummary.length === 0
            ? 'API returned zero branch rows — check office/date filters or DB data'
            : null,
      });

      return {
        branchSummary,
        accountSummary,
        globalHeadcount: headcount,
        startDateStr,
        endDateStr,
        agingStr,
      };
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Summary API failed';
      logSummaryDebug('API fallback failed', {
        error: message,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIds,
        callTypeFilter: callTypesParam,
      });
      return null;
    }
  }, [getAppliedFiltersSnapshot, offices]);

  const resolveClientImportScope = useCallback(() => {
    const snap = getAppliedFiltersSnapshot();
    if (!snap) return null;
    return {
      startDate: toDateString(snap.dateRange.start),
      endDate: toDateString(snap.dateRange.end),
      agingAsOf: normalizeAgingAsOfDate(snap.agingAsOf),
    };
  }, [getAppliedFiltersSnapshot]);

  const fetchClientImportSummary = useCallback(
    async (scope?: { startDate: string; endDate: string; agingAsOf: string }): Promise<void> => {
      const genAtStart = summaryTabLoadRef.current;
      const resolvedScope = scope ?? resolveClientImportScope();
      if (!resolvedScope) return;
      const payload = await loadClientImportSummaryPayload(resolvedScope);
      if (genAtStart !== summaryTabLoadRef.current) {
        return;
      }
      commitClientImportSummary(payload);
    },
    [loadClientImportSummaryPayload, resolveClientImportScope, commitClientImportSummary]
  );

  refreshClientImportOverlayRef.current = async (scope) => {
    if (sourceSelection.clientSourceCodes.length === 0) {
      commitClientImportSummary({
        clientBranchSummary: [],
        clientAccountSummary: [],
        rowsInDateRange: 0,
        totalRowsInFiles: 0,
      });
      return;
    }
    await fetchClientImportSummary(scope);
  };

  fetchClientImportSummaryRef.current = fetchClientImportSummary;
  resolveClientImportScopeRef.current = resolveClientImportScope;

  const loadClientImportSources = useCallback(async () => {
    try {
      const res = await axios.get<{ sources: Array<{ code: string; name: string }> }>(
        '/api/mis-client-import/sources',
        { withCredentials: true }
      );
      setClientImportActiveSources(res.data.sources ?? []);
    } catch {
      setClientImportActiveSources([]);
    }
  }, []);

  const applyRegisterFromCorpus = useCallback(
    (pageNum = 1, pageLimit: RegisterPageSize = limit): boolean => {
      if (readRegisterFromPostgresClient()) return false;
      // Corpus rows lack repair ncodes — force server path when Repair done is active.
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
      setLastRefreshed(
        store.lastSyncedAt ? new Date(store.lastSyncedAt) : new Date()
      );
      lastRegisterListQueryKeyRef.current = queryKey;
      lastKnownRegisterTotalRef.current = derived.total;
      registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
        data: derived.rows,
        total: derived.total,
        registerSummary: summary,
      });

      const refreshedDate = store.lastSyncedAt
        ? new Date(store.lastSyncedAt)
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

      return true;
    },
    [
      dateRange.start,
      dateRange.end,
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
    ]
  );

  useEffect(() => {
    if (!dbInitialized) return;
    if (!misAccess.register) return;
    if (registerAuthFailedRef.current) return;
    if (debouncedSearch?.trim() || debouncedPincodeSearch?.trim()) return;
    const registerRowsReady =
      data.length > 0 &&
      (!readRegisterFromPostgresClient() || data.some((r) => r.UniqueCallNo || r.vtrnno));
    if (registerRowsReady) return;
    if (readRegisterFromPostgresClient()) {
      void fetchData(1, { silent: false });
      return;
    }
    if (applyRegisterFromCorpus(1)) {
      setLoading(false);
      setFilterUpdating(false);
    }
  }, [
    dbInitialized,
    corpusTick,
    loading,
    data.length,
    debouncedSearch,
    debouncedPincodeSearch,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    ensureSharedCallsLoaded,
    getSharedCallsForScope,
    distributionCalls,
    misAccess.register,
  ]);

  const applySummaryFromSharedCalls = useCallback((): boolean => {
    if (!readRegisterFromPostgresClient()) return false;
    const scope = getSharedCallsForScope();
    if (!scope) return false;

    const { calls, startDateStr, endDateStr } = scope;
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
    const viewFilters = registerViewFilterRef.current;
    const applied = getAppliedFiltersSnapshot();
    const agingStr = normalizeAgingAsOfDate(applied?.agingAsOf ?? agingAsOf);

    const { filteredCalls } = deriveRegisterView(calls, viewFilters, viewDateFilter);
    const { branchSummary, accountSummary, globalHeadcount: headcount } = deriveSummaryDashboard(
      filteredCalls,
      {
        agingAsOf: agingStr,
        endDate: endDateStr,
        officeIdsParam: 'All',
        callTypesParam: 'All',
      }
    );

    logSummaryDebug('derived from shared Postgres bulk cache', {
      bulkRows: calls.length,
      filteredRows: filteredCalls.length,
      branchRows: branchSummary.length,
      accountRows: accountSummary.length,
      globalHeadcount: headcount,
    });

    commitSummaryResult(
      branchSummary,
      accountSummary,
      headcount,
      startDateStr,
      endDateStr,
      agingStr
    );
    void refreshClientImportOverlayRef.current({
      startDate: startDateStr,
      endDate: endDateStr,
      agingAsOf: agingStr,
    });
    return branchSummary.length > 0 || filteredCalls.length > 0;
  }, [getSharedCallsForScope, getAppliedFiltersSnapshot, dateFilterColumn, agingAsOf, commitSummaryResult]);

  const fetchData = async (
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
    const pincodeForUrl = opts?.pincodeOverride !== undefined ? opts.pincodeOverride : debouncedPincodeSearch;
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
          corpusStore = adoptCorpusStoreForScope(corpusStore, startDateStr, endDateStr, dateFilterColumn);
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
        const summary = p === 1 ? summarizeRegisterRows(allFiltered) : registerSummaryRef.current;
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
          const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
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
                sincePrefetchScheduleMs: Number((performance.now() - prefetchSessionStart).toFixed(1)),
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
            const totalsPath = registerPostgresHotPathAvailable(startDateStr, endDateStr)
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
        reportPerf('fetchData', 'network: /api/report (page>1, fetchTotals=false) complete', opStart, {
          opId,
          parallelAxiosMs: Number((tAfterPage - tBeforePage).toFixed(1)),
          registerRows: (regRes.data.data || []).length,
          why: 'Lighter query without full totals block; totals reused from lastKnownRegisterTotalRef when API omits total.',
        });
        const newChunk = regRes.data.data || [];
        indexRegisterRowsWithSerial(newChunk as Record<string, unknown>[]);
        const apiTotal = regRes.data.total;
        const effectiveTotal =
          apiTotal !== undefined && apiTotal !== null ? apiTotal : lastKnownRegisterTotalRef.current;

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
        // Not a user-facing failure — a newer fetch owns the UI update.
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
      reportPerf('fetchData', isActiveController ? 'done (this request owned controller)' : 'done (superseded)', opStart, {
        opId,
        isActiveController,
        silent: !!opts?.silent,
        why: isActiveController
          ? 'Spinner cleared; last successful or failed path for this opId.'
          : 'Another fetchData replaced fetchControllerRef before finally ran.',
      });
    }
    return succeeded;
  };

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
        setLoadingPage(null);
        return;
      }
      if (applyRegisterFromCorpus(1, next)) {
        setLoading(false);
        setLoadingPage(null);
        return;
      }
      void fetchData(1, { pageLimit: next });
    },
    [limit, applyRegisterFromSharedCalls, applyRegisterFromCorpus]
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

  const fetchDelta = async () => {
    if (readRegisterFromPostgresClient()) {
      registerPagesCacheRef.current.clear();
      const ok = await fetchData(1, { skipCache: true });
      // true = success; null = aborted by a newer fetch (ignore toast);
      // false = real failure. Do not treat undefined/other as failure.
      if (ok === false) {
        feedback.actionFailed('Failed to refresh report data');
      } else if (ok !== null) {
        feedback.refreshed();
      }
      return;
    }
    await runBackgroundSync({ showToast: true });
  };

  const applyRegisterDeltaRecords = (newRecords: any[], syncTime: Date) => {
    setLastRefreshed(syncTime);
    if (globalReportCache) {
      globalReportCache.lastRefreshed = syncTime;
    }
    if (newRecords.length === 0) return;

    const currentGlobalHeadcount = globalHeadcountRef.current;
    const merged = mergeRegisterDeltaRecords({
      currentData: dataRef.current,
      currentTotal: totalRef.current,
      currentRegisterSummary: registerSummaryRef.current,
      currentSummaryData: summaryDataRef.current,
      currentAccountsData: accountsDataRef.current,
      newRecords,
      filterCtx: registerViewFilterRef.current,
    });

    if (merged.kind === 'noop') return;

    if (merged.kind === 'viewFiltered') {
      setData(merged.updatedData);
      return;
    }

    const {
      updatedData,
      nextTotal,
      nextSummary,
      nextSummaryData,
      nextAccountsData,
    } = merged;

    setData(updatedData);
    setTotal(nextTotal);
    setRegisterSummary(nextSummary);
    setSummaryData(nextSummaryData);
    setAccountsData(nextAccountsData);
    registerPagesCacheRef.current.clear();

    if (globalReportCache) {
      globalReportCache.data = updatedData;
      globalReportCache.total = nextTotal;
      globalReportCache.registerSummary = nextSummary;
      globalReportCache.summaryData = nextSummaryData;
      globalReportCache.accountsData = nextAccountsData;
    }

    persistCurrentCache(
      updatedData,
      nextSummaryData,
      nextAccountsData,
      currentGlobalHeadcount,
      nextTotal,
      nextSummary,
      syncTime
    );
  };

  useEffect(() => {
    return subscribeRegisterDelta((records, syncTime) => {
      applyRegisterDeltaRecords(records as any[], syncTime);
    });
  }, []);

  useEffect(() => {
    if (lastSyncedAt) {
      setLastRefreshed(lastSyncedAt);
    }
  }, [lastSyncedAt]);

  const handleDrillDown = async (type: string, title: string, params: Record<string, unknown>) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, isOpen: true, loading: true, type, title, params, data: [] }));
    const d0 = performance.now();
    reportPerf('drillDown', 'POST /api/report/drilldown start', d0, { type, title });
    try {
      const applied = getAppliedFiltersSnapshot();
      const range = applied?.dateRange ?? dateRange;
      const startDateStr = toDateString(range.start);
      const endDateStr = toDateString(range.end);
      const agingStr = resolveSummaryAgingStr(applied);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post('/api/report/drilldown', {
        type,
        callType: params.callType || viewCallTypesParam,
        ...params,
        officeId: params.officeId != null ? String(params.officeId) : undefined,
        startDate: startDateStr,
        endDate: endDateStr,
        agingAsOf: agingStr,
      }, {
        withCredentials: true,
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data }));
      reportPerf('drillDown', 'POST /api/report/drilldown complete', d0, {
        rowCount: (res.data.data || []).length,
      });
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      feedback.actionFailed('Failed to fetch details');
      setDrillDown(prev => ({ ...prev, loading: false }));
    }
  };

  // Initialize cache from IndexedDB on mount
  useEffect(() => {
    const initDBAndCache = async () => {
      const i0 = performance.now();
      reportPerf('initDB', 'IndexedDB bootstrap start', i0, {
        why: 'Reads meta + optional cached calls so UI can paint before network; may schedule fetchDelta.',
      });
      try {
        const tBeforeMeta = performance.now();
        const cacheParams = await getMeta<ReportIdbCacheParams>('cacheParams');
        reportPerf('initDB', 'getMeta(cacheParams) done', i0, {
          hasMeta: !!cacheParams,
          getMetaMs: Number((performance.now() - tBeforeMeta).toFixed(1)),
        });

        const startDateStr = toDateString(dateRange.start);
        const endDateStr = toDateString(dateRange.end);
        if (!readRegisterFromPostgresClient()) {
          const corpusMeta = await readCorpusMeta();
          const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
          if (corpusMeta?.cacheKey === corpusKey && (corpusMeta.callCount ?? 0) > 0) {
            const tBeforeCorpus = performance.now();
            const restored = await restoreCorpusFromIndexedDB(corpusKey);
            reportPerf('initDB', 'corpus IDB restore on reload', i0, {
              callCount: corpusMeta.callCount,
              restored: !!restored,
              restoreMs: Number((performance.now() - tBeforeCorpus).toFixed(1)),
            });
            if (restored) {
              const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
              const clearView = emptyRegisterViewFilterParts({
                selectedCallTypes,
                selectedOfficeIds,
              });
              const derived = deriveRegisterPageFromCorpus(
                restored,
                corpusKey,
                clearView,
                1,
                10,
                viewDateFilter
              );
              if (derived) {
                const allFiltered = getFilteredCorpusCalls(clearView, restored, viewDateFilter);
                const registerSummaryRows = summarizeRegisterRows(allFiltered);
                setData(derived.rows);
                setTotal(derived.total);
                setRegisterSummary(registerSummaryRows);
                setLastRefreshed(new Date(restored.lastSyncedAt));
                lastKnownRegisterTotalRef.current = derived.total;
                lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
                  officeIdsParam: registerOfficeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  viewFilters: clearView,
                  agingAsOf: agingAsOf || '',
                  pageLimit: limit,
                });
                lastAppliedFilterSnapshotRef.current = JSON.stringify({
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedState: clearView.selectedState,
                  selectedCity: clearView.selectedCity,
                  selectedRegion: clearView.selectedRegion,
                  selectedAccount: clearView.selectedAccount,
                  selectedBranch: clearView.selectedBranch,
                  selectedFranchisee: clearView.selectedFranchisee,
                  selectedTechnician: clearView.selectedTechnician,
                  selectedStatus: clearView.selectedStatus,
                  priorityFilter: clearView.priorityFilter,
                  portalFilter: clearView.portalFilter,
                  repairFilter: clearView.repairFilter,
                  agingAsOf,
                  debouncedSearch: '',
                  debouncedPincodeSearch: '',
                });
                setGlobalReportCache({
                  data: derived.rows,
                  summaryData: [],
                  accountsData: [],
                  globalHeadcount: 0,
                  total: derived.total,
                  page: 1,
                  search: '',
                  pincodeSearch: '',
                  selectedOfficeIds,
                  dateRange,
                  dateFilterColumn,
                  filterRegion,
                  filterAccount,
                  selectedCallTypes,
                  registerSummary: registerSummaryRows,
                  lastRefreshed: new Date(restored.lastSyncedAt),
                  agingAsOf,
                  selectedStatus: clearView.selectedStatus,
                  priorityFilter: clearView.priorityFilter,
                  portalFilter: clearView.portalFilter,
                  repairFilter: clearView.repairFilter,
                  selectedState: clearView.selectedState,
                  selectedCity: clearView.selectedCity,
                  selectedRegion: clearView.selectedRegion,
                  selectedAccount: clearView.selectedAccount,
                  selectedBranch: clearView.selectedBranch,
                  selectedFranchisee: clearView.selectedFranchisee,
                  selectedTechnician: clearView.selectedTechnician,
                });
              }
            }
            setLoading(false);
            return;
          }

          if (cacheParams) {
          const officeIdsParam = summaryOfficeIdsParam;

          if (
            cacheParams.startDate === startDateStr &&
            cacheParams.endDate === endDateStr &&
            (cacheParams.dateFilterColumn || 'dtrndate') === dateFilterColumn &&
            cacheParams.officeIds === officeIdsParam &&
            cacheParams.callTypes === viewCallTypesParam
          ) {
            const hydrateFromIdb = async () => {
              const tBeforeCalls = performance.now();
              const cachedCalls = await getCallsFromDB();
              reportPerf('initDB', 'getCallsFromDB done (deferred)', i0, {
                rowCount: cachedCalls?.length ?? 0,
                getCallsMs: Number((performance.now() - tBeforeCalls).toFixed(1)),
              });
              if (!cachedCalls?.length) return;
              setData(cachedCalls);
              setSummaryData(cacheParams.summaryData || []);
              setAccountsData(cacheParams.accountsData || []);
              setGlobalHeadcount(cacheParams.globalHeadcount || 0);
              setTotal(cacheParams.total || 0);
              setRegisterSummary(cacheParams.registerSummary || null);
              
              const refreshedDate = new Date(cacheParams.lastRefreshed ?? Date.now());
              setLastRefreshed(refreshedDate);

              const clearView = emptyRegisterViewFilterParts({
                selectedCallTypes,
                selectedOfficeIds,
              });
              setGlobalReportCache({
                data: cachedCalls,
                summaryData: cacheParams.summaryData || [],
                accountsData: cacheParams.accountsData || [],
                globalHeadcount: cacheParams.globalHeadcount || 0,
                total: cacheParams.total || 0,
                page: 1,
                search: '',
                pincodeSearch: '',
                selectedOfficeIds,
                dateRange,
                dateFilterColumn: resolveRegisterDateSqlColumn(cacheParams.dateFilterColumn),
                filterRegion,
                filterAccount,
                selectedCallTypes,
                registerSummary: cacheParams.registerSummary || null,
                lastRefreshed: refreshedDate,
                agingAsOf,
                selectedStatus: clearView.selectedStatus,
                priorityFilter: clearView.priorityFilter,
                portalFilter: clearView.portalFilter,
                repairFilter: clearView.repairFilter,
                selectedState: clearView.selectedState,
                selectedCity: clearView.selectedCity,
                selectedBranch: clearView.selectedBranch,
                selectedFranchisee: clearView.selectedFranchisee,
                selectedTechnician: clearView.selectedTechnician,
                summaryQueryKey: cacheParams.summaryQueryKey ?? undefined,
              });

              if (cacheParams.summaryQueryKey) {
                lastSummaryQueryKeyRef.current = cacheParams.summaryQueryKey;
              } else if (cacheParams.summaryData?.length) {
                const agingStr = resolveSummaryAgingStr();
                lastSummaryQueryKeyRef.current = buildSummaryQueryKey({
                  officeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  startDateStr,
                  endDateStr,
                  agingAsOf: agingStr,
                });
              }

              lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
                officeIdsParam,
                callTypesParam: viewCallTypesParam,
                startDateStr,
                endDateStr,
                dateFilterColumn,
                viewFilters: clearView,
                agingAsOf: agingAsOf || '',
                pageLimit: limit,
              });

              lastKnownRegisterTotalRef.current = cacheParams.total || 0;

              // Let the UI render the loaded cache first
              setLoading(false);
            };
            window.setTimeout(() => {
              void hydrateFromIdb();
            }, 0);
          }
        }
        }
      } catch (err) {
        console.error('Error initializing cache from IndexedDB:', err);
        reportPerf('initDB', 'error', i0, { err: String(err) });
      } finally {
        setDbInitialized(true);
        reportPerf('initDB', 'dbInitialized=true (filter effect can run)', i0, {
          why: 'Gate removed: auto-fetch-on-filter useEffect waits for this flag.',
        });
      }
    };
    initDBAndCache();
  }, []);

  const runRegisterFilterLoad = useCallback(
    async (opts?: { force?: boolean }) => {
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
      const corpusFetchScopeChanged = !prevScopeKey || prevScopeKey !== currentScopeKey;
      const fetchOpts = {
        skipCache: !!opts?.force || corpusFetchScopeChanged || searchOrPinActive,
        searchOverride: applied.search,
        pincodeOverride: applied.pincodeSearch,
      };

      filterEffectInFlightRef.current = true;
      registerPagesCacheRef.current.clear();
      if (page !== 1) {
        setPage(1);
      }
      if (clearFiltersRef.current) {
        clearFiltersRef.current = false;
      }
      setFilterUpdating(true);

      if (searchOrPinActive) {
        try {
          await fetchData(1, fetchOpts);
          lastAppliedFilterSnapshotRef.current = filterSnapshot;
        } finally {
          filterEffectInFlightRef.current = false;
          setFilterUpdating(false);
        }
        return;
      }

      try {
        if (readRegisterFromPostgresClient()) {
          await fetchData(1, fetchOpts);
          lastAppliedFilterSnapshotRef.current = filterSnapshot;
          return;
        }

        const appliedRepair = applied.repairFilter?.length ?? 0;
        if (appliedRepair > 0) {
          // Corpus rows lack repair ncodes — must hit register API.
          await fetchData(1, fetchOpts);
          lastAppliedFilterSnapshotRef.current = filterSnapshot;
          return;
        }

        const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
        const hasCorpus =
          (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) ||
          corpusStoreCoversFetchScope(callCorpusStore, startDateStr, endDateStr, appliedDateColumn);

        if (!hasCorpus) {
          await ensureCorpusLoaded({ silent: false, force: !!opts?.force });
        }
        await ensurePortalAuditCache();
        applyRegisterFromCorpus(1);
        applySummaryFromCorpus();
        if (corpusSpanDays(startDateStr, endDateStr) > MAX_CLIENT_CORPUS_DAYS) {
          await fetchData(1, fetchOpts);
        }
        lastAppliedFilterSnapshotRef.current = filterSnapshot;
      } finally {
        filterEffectInFlightRef.current = false;
        setFilterUpdating(false);
      }
    },
    [
      dbInitialized,
      activeTab,
      getAppliedFiltersSnapshot,
      agingAsOf,
      page,
      fetchData,
      ensureSharedCallsLoaded,
      getSharedCallsForScope,
      applyRegisterFromSharedCalls,
      applySummaryFromSharedCalls,
      ensureCorpusLoaded,
      applyRegisterFromCorpus,
      applySummaryFromCorpus,
      supabase,
      misAccess.register,
    ]
  );

  useEffect(() => {
    if (!dbInitialized || activeTab !== 'register' || !appliedFilters || !misAccess.register) return;
    void runRegisterFilterLoad();
  }, [dbInitialized, appliedRevision, activeTab, appliedFilters, runRegisterFilterLoad, misAccess.register]);

  useEffect(() => {
    if (!dbInitialized || lastRegisterListQueryKeyRef.current) return;
    if (debouncedSearch?.trim() || debouncedPincodeSearch?.trim()) return;
    if (!globalReportCache) return;

    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);

    lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      startDateStr,
      endDateStr,
      dateFilterColumn,
      viewFilters: {
        ...currentViewFilters,
        search: '',
        pincodeSearch: '',
      },
      agingAsOf: agingAsOf || '',
      pageLimit: limit,
    });
  }, [
    dbInitialized,
    debouncedSearch,
    debouncedPincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    currentViewFilters,
    agingAsOf,
    viewCallTypesParam,
    registerOfficeIdsParam,
    limit,
  ]);

  const runSummaryFilterLoad = useCallback(async (generation: number) => {
    const isStale = () => generation !== summaryTabLoadRef.current;

    const applied = getAppliedFiltersSnapshot();
    if (!applied) return;

    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const appliedDateColumn = applied.dateFilterColumn;
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    const loadKey = buildSummaryQueryKeyFromSnapshot({
      offices,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedCallTypes: applied.selectedCallTypes,
      startDateStr,
      endDateStr,
      agingAsOf: agingStr,
    });

    if (summaryFilterLoadInFlightRef.current && summaryFilterLoadKeyRef.current === loadKey) {
      return;
    }

    const clientImportScope = {
      startDate: startDateStr,
      endDate: endDateStr,
      agingAsOf: agingStr,
    };
    const clientImportPromise = loadClientImportSummaryPayload(clientImportScope);

    if (hydrateSummaryFromCache()) {
      const [client] = await Promise.all([clientImportPromise]);
      if (isStale()) return;
      commitSummaryLoadBundle(null, client, applied);
      return;
    }
    summaryFilterLoadInFlightRef.current = true;
    summaryFilterLoadKeyRef.current = loadKey;

    try {
      const crmPromise = (async () => {
        if (readSummaryFromPostgresClient()) {
          return loadSummaryFromApiPayload();
        }

        const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
        const hasCorpus =
          callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0;

        if (!hasCorpus) {
          await ensureCorpusLoaded({ silent: true });
        }
        if (isStale()) return null;

        const derived = deriveSummaryFromCorpusPayload();
        if (derived) return derived;
        return loadSummaryFromApiPayload();
      })();

      const [crm, client] = await Promise.all([
        crmPromise,
        clientImportPromise,
      ]);
      if (isStale()) return;
      commitSummaryLoadBundle(crm, client, applied);
    } finally {
      if (summaryFilterLoadKeyRef.current === loadKey) {
        summaryFilterLoadInFlightRef.current = false;
        summaryFilterLoadKeyRef.current = null;
      }
    }
  }, [
    getAppliedFiltersSnapshot,
    offices,
    deriveSummaryFromCorpusPayload,
    ensureCorpusLoaded,
    loadSummaryFromApiPayload,
    loadClientImportSummaryPayload,
    commitSummaryLoadBundle,
  ]);

  runSummaryFilterLoadRef.current = runSummaryFilterLoad;

  const handleApplySummaryFilters = useCallback(() => {
    if (summaryTabLoading || bdMisTabLoading || summaryFilterLoadInFlightRef.current) {
      return;
    }
    if (!hasPendingFilterChanges) {
      feedback.actionSuccess('Filters are already applied', { duration: 2500 });
      return;
    }
    summaryUserApplyRef.current = true;
    if (activeTab === 'bd_mis_summary') {
      setBdMisTabLoading(true);
    } else {
      setSummaryTabLoading(true);
    }
    applyFilters();
  }, [activeTab, applyFilters, bdMisTabLoading, hasPendingFilterChanges, summaryTabLoading]);

  const finishSummaryUserApply = useCallback((message: string, failed = false) => {
    if (!summaryUserApplyRef.current) return;
    summaryUserApplyRef.current = false;
    if (failed) {
      feedback.actionFailed(message);
    }
  }, []);

  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'summary' && activeTab !== 'accounts') return;

    const generation = ++summaryTabLoadRef.current;
    setSummaryTabLoading(true);
    void runSummaryFilterLoadRef
      .current(generation)
      .catch(() => {
        if (generation === summaryTabLoadRef.current) {
          finishSummaryUserApply('Could not apply filters — try again', true);
        }
      })
      .finally(() => {
        if (generation === summaryTabLoadRef.current) {
          summaryUserApplyRef.current = false;
          setSummaryTabLoading(false);
        }
      });
  }, [dbInitialized, activeTab, appliedRevision, finishSummaryUserApply]);

  const fetchBdMisSummaryPayload = useCallback(async () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const summaryOfficeIds = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    const clientSources = sourceSelection.clientSourceCodes.length
      ? sourceSelection.clientSourceCodes.join(',')
      : 'coke,cadbury';

    const res = await axios.get('/api/report/bd-mis-summary', {
      withCredentials: true,
      params: {
        officeId: summaryOfficeIds,
        callType: callTypesParam,
        startDate: startDateStr,
        endDate: endDateStr,
        agingAsOf: agingStr,
        includeCrm: sourceSelection.crm ? 'true' : 'false',
        clientSources,
      },
    });
    return res.data;
  }, [getAppliedFiltersSnapshot, offices, sourceSelection]);

  const loadBdMisSummary = useCallback(async () => {
    const data = await fetchBdMisSummaryPayload();
    if (!data) return;

    const regionalRows = data.regionalRows ?? [];
    const grand = data.grand;
    setBdMisRegionalRows(regionalRows);
    setBdMisGrand(grand ?? null);
    if (grand && regionalRows.length) {
      setBdMisExportData({
        regionalRows,
        grand,
        crmBranchSummary: data.crmBranchSummary ?? [],
        crmAccountSummary: data.crmAccountSummary ?? [],
        clientAccountSummary: data.clientAccountSummary ?? [],
        sources: data.sources ?? {
          crm: sourceSelection.crm,
          cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
          coke: sourceSelection.clientSourceCodes.includes('coke'),
        },
      });
    } else {
      setBdMisExportData(null);
    }
  }, [fetchBdMisSummaryPayload, sourceSelection]);

  const buildBdMisExportFilterMeta = useCallback(() => {
    const applied = getAppliedFiltersSnapshot();
    return {
      startDate: toDateString(applied?.dateRange.start ?? dateRange.start),
      endDate: toDateString(applied?.dateRange.end ?? dateRange.end),
      agingAsOf: normalizeAgingAsOfDate(applied?.agingAsOf ?? agingAsOf),
      callTypes:
        applied?.selectedCallTypes?.map((t) => String(t).toUpperCase()).join(', ') || 'BREAKDOWN',
      branches: joinFilterParam(applied?.selectedBranch ?? selectedBranch) || 'All Branches',
      franchisees:
        joinFilterParam(applied?.selectedFranchisee ?? selectedFranchisee) || 'All Franchisees',
      sources:
        bdMisExportData?.sources ??
        ({
          crm: sourceSelection.crm,
          cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
          coke: sourceSelection.clientSourceCodes.includes('coke'),
        } satisfies BdMisSourceFlags),
    };
  }, [
    getAppliedFiltersSnapshot,
    dateRange.start,
    dateRange.end,
    agingAsOf,
    selectedBranch,
    selectedFranchisee,
    bdMisExportData?.sources,
    sourceSelection,
  ]);

  const executeBdMisTraceExport = useCallback(async () => {
    const traceT0 = performance.now();
    console.info('[bd-mis-trace-export] start');
    const applied = getAppliedFiltersSnapshot();
    if (!applied) {
      throw new Error('Apply filters before exporting.');
    }
    const traceAlign = activeTab === 'summary' ? 'summary' : 'bd_mis';
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const summaryOfficeIds = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    const clientSources = sourceSelection.clientSourceCodes.length
      ? sourceSelection.clientSourceCodes.join(',')
      : 'coke,cadbury';

    const apiT0 = performance.now();
    const res = await axios.get('/api/report/bd-mis-summary', {
      withCredentials: true,
      params: {
        officeId: summaryOfficeIds,
        callType: callTypesParam,
        startDate: startDateStr,
        endDate: endDateStr,
        agingAsOf: agingStr,
        includeCrm: sourceSelection.crm ? 'true' : 'false',
        clientSources,
        includeTrace: 'true',
        traceAlign,
      },
    });
    console.info('[bd-mis-trace-export] api-ok', {
      elapsed_ms: Math.round(performance.now() - apiT0),
      status: res.status,
    });

    const data = res.data;
    let regionalRows = data.regionalRows ?? [];
    let grand = data.grand;
    let crmBranchSummary = data.crmBranchSummary ?? [];
    let crmAccountSummary = data.crmAccountSummary ?? [];
    let clientAccountSummary = data.clientAccountSummary ?? [];
    const traceRows = data.traceRows ?? [];

    if (traceAlign === 'summary') {
      const {
        buildUiRegionalPerformanceRows,
        sumUiRegionalRows,
        toBdMisGrandRow,
        toBdMisRegionalRow,
      } = await import('@/features/report/services/summary-trace-export');
      const uiRegional = buildUiRegionalPerformanceRows(
        summaryData,
        clientSummaryData,
        mergeFlags
      );
      if (!uiRegional.length) {
        throw new Error('No data to export. Apply filters and wait for the summary to load.');
      }
      const uiGrand = sumUiRegionalRows(uiRegional);
      regionalRows = uiRegional.map(toBdMisRegionalRow);
      grand = toBdMisGrandRow(uiGrand);
      crmBranchSummary = summaryData;
      crmAccountSummary = accountsData;
      clientAccountSummary = clientAccountSummaryData ?? [];
    }

    console.info('[bd-mis-trace-export] payload', {
      trace_align: traceAlign,
      regional_rows: regionalRows.length,
      trace_rows: traceRows.length,
      has_grand: Boolean(grand),
    });

    if (!regionalRows.length || !grand) {
      throw new Error('No data to export. Apply filters and wait for the summary to load.');
    }

    const { buildBdMisTraceableWorkbook, bdMisTraceableFilename } = await import(
      '@/features/report/services/bd-mis-excel-export'
    );
    const buildT0 = performance.now();
    const workbook = await buildBdMisTraceableWorkbook({
      regionalRows,
      grand,
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources: data.sources ?? {
        crm: sourceSelection.crm,
        cadbury: sourceSelection.clientSourceCodes.includes('cadbury'),
        coke: sourceSelection.clientSourceCodes.includes('coke'),
      },
      traceRows,
      traceAlign,
      filterMeta: buildBdMisExportFilterMeta(),
    });
    console.info('[bd-mis-trace-export] workbook-built', {
      elapsed_ms: Math.round(performance.now() - buildT0),
      sheets: workbook.worksheets.length,
    });
    const filename = bdMisTraceableFilename();
    const dlT0 = performance.now();
    console.info('[bd-mis-trace-export] download-trigger', { filename });
    const { workbookToPreparedExport } = await import('@/features/report/services/summary-excel-export');
    const prepared = await workbookToPreparedExport(workbook, filename);
    console.info('[bd-mis-trace-export] prepare-finished', {
      elapsed_ms: Math.round(performance.now() - dlT0),
    });
    console.info('[bd-mis-trace-export] done', {
      total_elapsed_ms: Math.round(performance.now() - traceT0),
    });
    return prepared;
  }, [
    activeTab,
    getAppliedFiltersSnapshot,
    offices,
    sourceSelection,
    buildBdMisExportFilterMeta,
    summaryData,
    clientSummaryData,
    mergeFlags,
    accountsData,
    clientAccountSummaryData,
  ]);

  const handleBdMisTraceExport = useCallback(() => {
    const sourceTab = activeTab;
    enqueueExport(
      'Summary + Row Trace Excel',
      async (_ctx) => {
        try {
          return await executeBdMisTraceExport();
        } catch (err) {
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Export failed';
          feedback.actionFailed(`Failed to export trace workbook: ${message}`);
          throw err instanceof Error ? err : new Error(message);
        }
      },
      { sourceTab, kind: 'trace' }
    );
  }, [activeTab, enqueueExport, executeBdMisTraceExport]);

  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'bd_mis_summary') return;

    setBdMisTabLoading(true);
    void loadBdMisSummary()
      .catch((err) => {
        console.warn('BD MIS summary fetch failed:', err);
      })
      .finally(() => {
        setBdMisTabLoading(false);
      });
  }, [dbInitialized, activeTab, appliedRevision, loadBdMisSummary, sourceSelectionKey]);

  // Client import tab: refetch when applied filters change (summary/accounts load via runSummaryFilterLoad).
  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'client_import') return;
    const scope = resolveClientImportScopeRef.current();
    if (!scope) return;
    void fetchClientImportSummaryRef.current(scope);
  }, [dbInitialized, activeTab, appliedRevision]);

  // Summary/accounts: refetch client overlay only when CRM/Cadbury/Coke toggles change.
  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'summary' && activeTab !== 'accounts') {
      clientImportSourceFetchTabRef.current = null;
      prevSourceSelectionKeyRef.current = null;
      return;
    }
    if (clientImportSourceFetchTabRef.current !== activeTab) {
      clientImportSourceFetchTabRef.current = activeTab;
      prevSourceSelectionKeyRef.current = sourceSelectionKey;
      return;
    }
    if (prevSourceSelectionKeyRef.current === sourceSelectionKey) return;
    prevSourceSelectionKeyRef.current = sourceSelectionKey;
    const scope = resolveClientImportScopeRef.current();
    if (!scope) return;
    void fetchClientImportSummaryRef.current(scope);
  }, [dbInitialized, activeTab, sourceSelectionKey, appliedRevision]);

  useEffect(() => {
    if (!misAccess.summary && !misAccess.accounts && !misAccess.client_import && !misAccess.bd_mis_summary) return;
    void loadClientImportSources();
  }, [
    misAccess.summary,
    misAccess.accounts,
    misAccess.client_import,
    misAccess.bd_mis_summary,
    loadClientImportSources,
    appliedRevision,
  ]);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      drillDownControllerRef.current?.abort();
    };
  }, []);

  const buildCurrentRegisterQueryKey = useCallback(() => {
    return buildRegisterListQueryKeyFromViewFilters({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      startDateStr: toDateString(dateRange.start),
      endDateStr: toDateString(dateRange.end),
      dateFilterColumn,
      viewFilters: currentViewFilters,
      agingAsOf: agingAsOf || '',
      pageLimit: limit,
    });
  }, [
    dateRange.start,
    dateRange.end,
    dateFilterColumn,
    currentViewFilters,
    agingAsOf,
    viewCallTypesParam,
    registerOfficeIdsParam,
    limit,
  ]);

  const executeExport = useCallback(
    async (
      format: 'excel' | 'csv',
      sourceTab: MisTabId,
      ctx: ExportQueueRunContext
    ) => {
      const fileName = `WRL_MIS_Report_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      const { signal, onProgress } = ctx;

      if (sourceTab === 'register') {
        try {
          const startDateStr = toDateString(dateRange.start);
          const endDateStr = toDateString(dateRange.end);
          const queryKey = buildCurrentRegisterQueryKey();
          const exportQuery = buildRegisterExportQueryFromViewFilters({
            officeId: summaryOfficeIdsParam,
            callType: viewCallTypesParam,
            startDate: startDateStr,
            endDate: endDateStr,
            dateFilterColumn,
            viewFilters: currentViewFilters,
          });

          let exportData: Record<string, unknown>[] = data;
          const needsFullFetch = total > limit || data.length < total;

          if (needsFullFetch && exportData.length < total) {
            const cachedAllPages = collectRegisterRowsFromSessionCache(
              registerPagesCacheRef.current,
              queryKey,
              total,
              limit
            );
            if (cachedAllPages?.length) {
              exportData = cachedAllPages;
            }
          }

          if (needsFullFetch && !readRegisterFromPostgresClient() && exportData.length < total) {
            const spanDays = corpusSpanDays(startDateStr, endDateStr);
            if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
              const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
              if (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) {
                const viewDateFilter = buildCorpusViewDateFilter(
                  startDateStr,
                  endDateStr,
                  dateFilterColumn
                );
                exportData = getFilteredCorpusCalls(
                  registerViewFilterRef.current,
                  callCorpusStore,
                  viewDateFilter
                );
              }
            }
          }

          if (needsFullFetch && exportData.length < total) {
            if (shouldStreamRegisterExportFromServer(total, exportData.length)) {
              onProgress({ fetched: 0, total });
              const {
                data: { session },
              } = await supabase.auth.getSession();
              const prepared = await prepareRegisterCsvFromServer({
                query: exportQuery,
                knownTotal: total,
                signal,
                accessToken: session?.access_token,
                onProgress: (progress) => {
                  onProgress({
                    fetched: progress.fetched,
                    total: progress.total,
                    detail: progress.detail,
                  });
                },
              });
              if (format === 'excel') {
                feedback.actionSuccess('Large export queued as CSV');
              }
              return prepared;
            }

            exportData = await fetchAllRegisterRowsForExport({
              knownTotal: total,
              signal,
              onProgress: (fetched, exportTotal) => {
                onProgress({ fetched, total: exportTotal });
              },
              query: exportQuery,
            });

            if (readRegisterFromPostgresClient() && exportData.length) {
              const viewDateFilter = buildCorpusViewDateFilter(
                startDateStr,
                endDateStr,
                dateFilterColumn
              );
              exportData = deriveRegisterView(
                exportData,
                registerViewFilterRef.current,
                viewDateFilter
              ).filteredCalls;
            }
          }

          if (!exportData.length) {
            throw new Error('No data to export');
          }

          if (format === 'csv') {
            const { prepareRegisterCsvExport } = await import('@/features/register/server/csv-export');
            return prepareRegisterCsvExport(
              exportData,
              `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`
            );
          }

          const { prepareRegisterExcelFromRows } = await import('@/features/register/services/excel-export');
          return prepareRegisterExcelFromRows(exportData, {
            filename: `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.xlsx`,
            sheetName: 'Call Register',
            onProgress: (processed, exportTotal) => {
              onProgress({ fetched: processed, total: exportTotal });
            },
          });
        } catch (err) {
          if (isRegisterExportAbortError(err)) {
            throw new DOMException('Export cancelled', 'AbortError');
          }
          console.error('Register export failed:', err);
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Export failed';
          throw new Error(message);
        }
      }

      if (sourceTab === 'bd_mis_summary') {
        if (!bdMisExportData?.regionalRows?.length) {
          throw new Error('No data to export. Apply filters and wait for the summary to load.');
        }
        const { buildBdMisSummaryWorkbook, bdMisSummaryFilename } = await import(
          '@/features/report/services/bd-mis-excel-export'
        );
        const { workbookToPreparedExport } = await import('@/features/report/services/summary-excel-export');
        const workbook = await buildBdMisSummaryWorkbook({
          ...bdMisExportData,
          filterMeta: buildBdMisExportFilterMeta(),
        });
        return workbookToPreparedExport(workbook, bdMisSummaryFilename());
      }

      if (sourceTab === 'summary') {
        const {
          buildSummaryDashboardWorkbook,
          workbookToPreparedExport,
        } = await import('@/features/report/services/summary-excel-export');
        const workbook = await buildSummaryDashboardWorkbook(summaryData);
        return workbookToPreparedExport(workbook, fileName);
      }

      if (sourceTab === 'accounts') {
        const {
          buildKeyAccountMisWorkbook,
          workbookToPreparedExport,
        } = await import('@/features/report/services/summary-excel-export');
        const displayAccounts = buildAccountDisplayRows(
          accountsData,
          clientAccountSummaryData,
          mergeFlags
        );
        const filtered = displayAccounts.filter((a) => {
          const matchRegion = matchesRegionFilter(filterRegion, String(a.region ?? ''));
          const matchAccount = matchesAccountFilter(filterAccount, String(a.account ?? ''));
          return matchRegion && matchAccount;
        });
        const exportRows = resolveAccountMisTableRows(
          filtered,
          accountMisGrouping,
          accountMisTopN,
          clientAccountSummaryData,
          mergeFlags,
          clientMergeWithCrm,
          accountMisZoneTopExclude
        );
        const workbook = await buildKeyAccountMisWorkbook(
          exportRows as import('@/lib/summary/derive').AccountSummaryRow[],
          undefined,
          { hideRegion: accountMisGrouping === 'overview' }
        );
        return workbookToPreparedExport(workbook, fileName);
      }

      throw new Error('Export is not available on this tab');
    },
    [
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      currentViewFilters,
      summaryOfficeIdsParam,
      viewCallTypesParam,
      data,
      total,
      limit,
      bdMisExportData,
      buildBdMisExportFilterMeta,
      summaryData,
      accountsData,
      clientAccountSummaryData,
      mergeFlags,
      filterRegion,
      filterAccount,
      accountMisGrouping,
      accountMisTopN,
      clientMergeWithCrm,
      accountMisZoneTopExclude,
    ]
  );

  const handleExport = useCallback(
    (format: 'excel' | 'csv' = 'excel') => {
      const sourceTab = activeTab;
      const label = exportLabelForMisTab(sourceTab, format);
      enqueueExport(
        label,
        async (ctx) => {
          try {
            return await executeExport(format, sourceTab, ctx);
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            const message = err instanceof Error ? err.message : 'Export failed';
            feedback.actionFailed(`Failed to export: ${message}`);
            throw err instanceof Error ? err : new Error(message);
          }
        },
        { sourceTab, kind: 'standard' }
      );
    },
    [activeTab, enqueueExport, executeExport]
  );

  if (!mounted) {
    return <ReportPageSkeleton className="bg-bg-canvas" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-canvas text-slate-900">
      <ReportPageHeaderBar
        misTabs={misTabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lastRefreshed={lastRefreshed}
        filterUpdating={filterUpdating}
        syncInProgress={syncInProgress}
        corpusLoading={corpusLoading}
        summaryTabLoading={summaryTabLoading}
        bdMisTabLoading={bdMisTabLoading}
        total={total}
        isCurrentTabExcelExporting={isCurrentTabExcelExporting}
        isCurrentTabTraceExporting={isCurrentTabTraceExporting}
        onSync={() => void fetchDelta()}
        onExportExcel={() => handleExport('excel')}
        onExportTrace={() => handleBdMisTraceExport()}
        exportQueueItems={exportQueueItems}
        onClearFinishedExports={clearFinishedExports}
        onCancelExportJob={cancelExportJob}
        reportBanner={reportBanner}
        onDismissBanner={clearReportBanner}
        orientationDismissed={orientationDismissed}
        userName={userProfile?.name}
        refreshDelta={refreshDelta}
        onDismissOrientation={() => {
          setOrientationDismissed(true);
          sessionStorage.setItem('report-orientation-dismissed', '1');
          clearRefreshDelta();
        }}
      />

      {/* Control Bar — shared filters only on summary / accounts / BD MIS (not client import / deployment). */}
      {activeTab === 'register' ? (
        <RegisterPageFilters
          summary={registerSummary}
          updating={(loading || filterUpdating) && data.length > 0}
          updatingLabel={
            filterUpdating ? 'Updating filters…' : 'Refreshing call register…'
          }
          onBeforeOpenFilters={() => void loadFilterOptions()}
          onApply={() => void runRegisterFilterLoad({ force: true })}
          onSearchEnter={() => void runRegisterFilterLoad({ force: true })}
          onPincodeEnter={() => void runRegisterFilterLoad({ force: true })}
        />
      ) : activeTab === 'summary' ||
        activeTab === 'accounts' ||
        activeTab === 'bd_mis_summary' ? (
        <ReportSharedFiltersBar
          callTypeOptions={callTypeOptions}
          selectedCallTypes={selectedCallTypes}
          setSelectedCallTypes={setSelectedCallTypes}
          dateRange={dateRange}
          setDateRange={setDateRange}
          agingAsOf={agingAsOf}
          setAgingAsOf={setAgingAsOf}
          onApply={handleApplySummaryFilters}
          summaryTabLoading={summaryTabLoading}
          bdMisTabLoading={bdMisTabLoading}
          hasPendingFilterChanges={hasPendingFilterChanges}
          clientImportActiveSources={clientImportActiveSources}
          sourceSelection={sourceSelection}
          setSourceSelection={setSourceSelection}
          clientMergeWithCrm={clientMergeWithCrm}
          setClientMergeWithCrm={setClientMergeWithCrm}
        />
      ) : null}

      {/* Main Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-canvas">
        {activeTab === 'register' ? (
          <ReportRegisterTabPanel
            loading={loading}
            data={data}
            displayedData={data}
            total={total}
            page={page}
            limit={limit}
            visibleRegisterColumns={visibleRegisterColumns}
            setVisibleRegisterColumns={setVisibleRegisterColumns}
            visibleRegisterColumnDefs={visibleRegisterColumnDefs}
            getRegisterCellClassName={getRegisterCellClassName}
            renderRegisterCell={renderRegisterCell}
            isAnyRegisterFilterActive={isAnyRegisterFilterActive}
            clearAllFilters={clearAllFilters}
            runRegisterFilterLoad={runRegisterFilterLoad}
            handleRegisterPageSizeChange={handleRegisterPageSizeChange}
            setPage={setPage}
            fetchData={fetchData}
            sort={registerSort}
            onSortChange={handleRegisterSortChange}
          />
        ) : activeTab === 'summary' ? (
          <ReportSummaryTabPanel
            accountsData={accountsData}
            alignCrmToAccounts={alignCrmToAccounts}
            clientAccountSummaryData={clientAccountSummaryData}
            clientMergeWithCrm={clientMergeWithCrm}
            clientOnlyMode={clientOnlyMode}
            clientSummaryData={clientSummaryData}
            expandedBranches={expandedBranches}
            handleDrillDown={handleDrillDown}
            mergeFlags={mergeFlags}
            mergedAccountRowsForTotals={mergedAccountRowsForTotals}
            setExpandedBranches={setExpandedBranches}
            summaryData={summaryData}
            summaryTabLoading={summaryTabLoading}
          />
        ) : activeTab === 'accounts' ? (
          <ReportAccountsTabPanel
            accountMisGrouping={accountMisGrouping}
            accountMisTopN={accountMisTopN}
            accountMisZoneTopExclude={accountMisZoneTopExclude}
            clientAccountSummaryData={clientAccountSummaryData}
            clientMergeWithCrm={clientMergeWithCrm}
            filterAccount={filterAccount}
            filterRegion={filterRegion}
            globalHeadcount={globalHeadcount}
            handleDrillDown={handleDrillDown}
            mergeFlags={mergeFlags}
            mergedAccountRowsForTotals={mergedAccountRowsForTotals}
            setAccountMisGrouping={setAccountMisGrouping}
            setAccountMisTopN={setAccountMisTopN}
            setAccountMisZoneTopExclude={setAccountMisZoneTopExclude}
            setFilterAccount={setFilterAccount}
            setFilterRegion={setFilterRegion}
            setShowAccountDropdown={setShowAccountDropdown}
            setShowRegionDropdown={setShowRegionDropdown}
            setShowZoneTopExcludeDropdown={setShowZoneTopExcludeDropdown}
            setTempFilterAccount={setTempFilterAccount}
            setTempFilterRegion={setTempFilterRegion}
            setTempZoneTopExclude={setTempZoneTopExclude}
            showAccountDropdown={showAccountDropdown}
            showRegionDropdown={showRegionDropdown}
            showZoneTopExcludeDropdown={showZoneTopExcludeDropdown}
            summaryData={summaryData}
            summaryTabLoading={summaryTabLoading}
            tempFilterAccount={tempFilterAccount}
            tempFilterRegion={tempFilterRegion}
            tempZoneTopExclude={tempZoneTopExclude}
          />
        ) : activeTab === 'bd_mis_summary' ? (
          <ReportBdMisTabPanel
            bdMisGrand={bdMisGrand}
            bdMisRegionalRows={bdMisRegionalRows}
            bdMisTabLoading={bdMisTabLoading}
          />
        ) : activeTab === 'client_import' ? (
          <ReportErrorBoundary label="Client Import">
            <ClientImportTab
              uploadSource={uploadSource}
              sourceSelection={sourceSelection}
              dateScope={
                resolveClientImportScope() ?? {
                  startDate: toDateString(dateRange.start),
                  endDate: toDateString(dateRange.end),
                }
              }
              metaRefreshKey={appliedRevision}
              onUploadSourceChange={setUploadSource}
              onSourceSelectionChange={(selection) => {
                saveMisSourceSelection(selection);
                setSourceSelection(selection);
              }}
              onImportComplete={() => {
                const scope = resolveClientImportScopeRef.current();
                if (scope) void fetchClientImportSummaryRef.current(scope);
              }}
            />
          </ReportErrorBoundary>
        ) : activeTab === 'deployment_completion' ? (
          <ReportErrorBoundary label="Deployment Completion">
            <CallRegisterClient
              enqueueExport={enqueueExport}
              isExporting={isExportActiveForTab(
                exportQueueItems,
                'deployment_completion',
                'standard'
              )}
            />
          </ReportErrorBoundary>
        ) : null}
      </div>

      <ReportPageOverlays
        isDrawerOpen={isDrawerOpen}
        selectedCall={selectedCall}
        onCloseDrawer={() => setIsDrawerOpen(false)}
        onFlagUpdate={handleFlagUpdate}
        onPostComment={handlePostComment}
        drillDown={drillDown}
        setDrillDown={setDrillDown}
        handleSelectCall={handleSelectCall}
      />
    </div>
  );
}
