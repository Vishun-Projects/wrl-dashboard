'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  defaultMisTab,
  isSuperAdmin,
  type MisTabId,
} from '@/lib/auth/rbac-catalog';
import axios from 'axios';
import {
  getRegisterCellClassName,
  renderRegisterCell as renderRegisterCellBase,
} from '@/modules/mis/components/RegisterTableCells';
import { useReportExportQueue } from '@/modules/mis/hooks/useReportExportQueue';
import type { ExportQueueRunContext } from '@/modules/mis/services/export-queue';
import { isExportActiveForTab } from '@/modules/mis/services/export-queue';
import { consumeExportInterruptedFlag, markExportInterrupted } from '@/modules/mis/services/export-queue-session';
import { exportLabelForMisTab } from '@/modules/mis/services/export-labels';
import { ReportErrorBoundary } from '@/modules/mis/components/ReportErrorBoundary';
import { ReportPageOverlays } from '@/modules/mis/components/ReportPageOverlays';
import { ReportPageHeaderBar } from '@/modules/mis/components/ReportPageHeaderBar';
import { ReportSharedFiltersBar } from '@/modules/mis/components/ReportSharedFiltersBar';
import { ReportRegisterTabPanel } from '@/modules/mis/components/ReportRegisterTabPanel';
import { ReportSummaryTabPanel } from '@/modules/mis/components/ReportSummaryTabPanel';
import { ReportAccountsTabPanel } from '@/modules/mis/components/ReportAccountsTabPanel';
import { ReportBdMisTabPanel } from '@/modules/mis/components/ReportBdMisTabPanel';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';
import { useRegisterFilterOptions } from '@/modules/mis/hooks/useRegisterFilterOptions';
import { feedback } from '@/lib/ui/feedback';
import { useUser } from '@/components/layout/DashboardLayout';
import { CallRegisterClient } from '@/modules/mis/pages/CallRegisterPageClient';

import { RegisterPageFilters } from '@/modules/mis/register/components/RegisterPageFilters';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import {
  resolveViewCallTypesParam,
  resolveSummaryOfficeIdsParam,
  toDateString,
} from '@/modules/mis/services/filters';
import {
  loadVisibleRegisterColumns,
  REGISTER_TABLE_COLUMNS,
  saveVisibleRegisterColumns,
  type RegisterTableColumnKey,
} from '@/modules/mis/register';
import { MAX_CLIENT_CORPUS_DAYS } from '@/sql/trhcalls/query';
import {
  globalReportCache,
  callCorpusStore,
} from '@/modules/mis/services/data-store';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  getFilteredCorpusCalls,
} from '@/modules/mis/services/corpus';
import {
  readRegisterFromPostgresClient,
} from '@/lib/read-model/client-flags';
import {
  collectRegisterRowsFromSessionCache,
  prepareRegisterCsvFromServer,
  fetchAllRegisterRowsForExport,
  isRegisterExportAbortError,
  shouldStreamRegisterExportFromServer,
} from '@/modules/mis/register';
import ClientImportTab from '@/modules/mis/components/ClientImportTab';
import { saveMisSourceSelection } from '@/modules/mis/client-import';
import {
  buildAccountDisplayRows,
  matchesAccountFilter,
  matchesRegionFilter,
} from '@/modules/mis/components/SummaryMergedMetricCell';
import {
  corpusSpanDays,
  reportPerf,
  reportPerfLogDocumentNavigationOnce,
  resolveAccountMisTableRows,
} from '@/modules/mis/services/report-page-helpers';
import {
  buildMisAccess,
  buildMisTabs,
  resolveActiveMisTab,
} from '@/modules/mis/services/mis-tab-access';
import {
  buildRegisterExportQueryFromViewFilters,
  buildRegisterListQueryKeyFromViewFilters,
} from '@/modules/mis/services/register-query-builders';

// Import hooks
import { useRegisterTabState } from '@/modules/mis/hooks/useRegisterTabState';
import { useSummaryTabState } from '@/modules/mis/hooks/useSummaryTabState';
import { useBdMisTabState } from '@/modules/mis/hooks/useBdMisTabState';
import { useReportOverlaysState } from '@/modules/mis/hooks/useReportOverlaysState';

/** Cadbury+Coke+CRM Summary tab — hidden until reconciliation is production-ready. */
const BD_MIS_SUMMARY_TAB_ENABLED = false;

export default function ReportPageClient() {
  const [mounted, setMounted] = useState(false);
  const [manualCallsHotSyncBusy, setManualCallsHotSyncBusy] = useState(false);
  const { userProfile } = useUser();
  const userPermissions = (userProfile?.permissions ?? []) as string[];
  const canManualCallsHotSync = isSuperAdmin(userPermissions);
  const misAccess = useMemo(
    () => buildMisAccess(userPermissions, BD_MIS_SUMMARY_TAB_ENABLED),
    [userPermissions]
  );

  const misTabs = useMemo(
    () => buildMisTabs(userPermissions, BD_MIS_SUMMARY_TAB_ENABLED),
    [userPermissions]
  );

  const supabase = createClient();
  const pageSessionStartRef = React.useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const {
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
    syncInProgress,
    corpusLoading,
    appliedFilters,
    appliedRevision,
    applyFilters,
    getAppliedFiltersSnapshot,
    hasPendingFilterChanges,
    reportBanner,
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

  const [activeTab, setActiveTab] = useState<MisTabId>('register');
  const [visibleRegisterColumns, setVisibleRegisterColumns] = useState<RegisterTableColumnKey[]>(() =>
    loadVisibleRegisterColumns()
  );

  const [uploadSource, setUploadSource] = useState('coke');

  // Initialize modular hooks
  const summaryTabState = useSummaryTabState({
    supabase,
    activeTab,
    misAccess,
  });

  const registerTabState = useRegisterTabState({
    supabase,
    activeTab,
    misAccess,
    summaryData: summaryTabState.summaryData,
    setSummaryData: summaryTabState.setSummaryData,
    summaryDataRef: summaryTabState.summaryDataRef,
    accountsData: summaryTabState.accountsData,
    setAccountsData: summaryTabState.setAccountsData,
    accountsDataRef: summaryTabState.accountsDataRef,
    globalHeadcount: summaryTabState.globalHeadcount,
    setGlobalHeadcount: summaryTabState.setGlobalHeadcount,
    globalHeadcountRef: summaryTabState.globalHeadcountRef,
    resolveSummaryAgingStr: summaryTabState.resolveSummaryAgingStr,
    buildSummaryQueryKey: summaryTabState.buildSummaryQueryKey,
    lastSummaryQueryKeyRef: summaryTabState.lastSummaryQueryKeyRef,
    refreshClientImportOverlayRef: summaryTabState.refreshClientImportOverlayRef,
    filterRegion: summaryTabState.filterRegion,
    filterAccount: summaryTabState.filterAccount,
  });

  const dbInitialized = registerTabState.dbInitialized;

  const bdMisTabState = useBdMisTabState({
    activeTab,
    dbInitialized,
    appliedRevision,
    sourceSelection: summaryTabState.sourceSelection,
    sourceSelectionKey: JSON.stringify(summaryTabState.sourceSelection),
    enqueueExport: (...args: any[]) => enqueueExport(...(args as [any, any, any])),
    summaryData: summaryTabState.summaryData,
    clientSummaryData: summaryTabState.clientSummaryData,
    accountsData: summaryTabState.accountsData,
    clientAccountSummaryData: summaryTabState.clientAccountSummaryData,
    mergeFlags: summaryTabState.mergeFlags,
  });

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

  const overlaysState = useReportOverlaysState({
    supabase,
    userProfile,
    data: registerTabState.data,
    setData: registerTabState.setData as any,
    viewCallTypesParam,
    dateRange,
    agingAsOf,
    getAppliedFiltersSnapshot,
    resolveSummaryAgingStr: summaryTabState.resolveSummaryAgingStr,
  });

  useEffect(() => {
    if (!userProfile?.permissions?.length) return;
    const nextTab = defaultMisTab(userPermissions);
    setActiveTab((current) => resolveActiveMisTab(current, misTabs, nextTab));
  }, [userProfile?.permissions, userPermissions, misTabs]);

  useEffect(() => {
    if (!globalReportCache?.data) {
      try {
        const cached = localStorage.getItem('report_fortnight_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.data) registerTabState.setData(parsed.data);
          if (parsed.total) registerTabState.setTotal(parsed.total);
        }
      } catch { /* ignore */ }
    }
    setMounted(true);
  }, []);

  const technicianRoster = useMemo(
    () =>
      techniciansList.map((t: { ncode: string; vname: string }) => ({
        value: String(t.ncode),
        label: String(t.vname || t.ncode),
      })),
    [techniciansList]
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
        pageLimit: registerTabState.limit,
      }),
    [
      summaryOfficeIdsParam,
      viewCallTypesParam,
      currentViewFilters,
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      agingAsOf,
      registerTabState.limit,
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

  useEffect(() => {
    saveVisibleRegisterColumns(visibleRegisterColumns);
  }, [visibleRegisterColumns]);

  const visibleRegisterColumnDefs = React.useMemo(
    () => REGISTER_TABLE_COLUMNS.filter((col) => visibleRegisterColumns.includes(col.key)),
    [visibleRegisterColumns]
  );

  const renderRegisterCell = (key: RegisterTableColumnKey, row: any) =>
    renderRegisterCellBase(key, row, {
      onSelectCall: overlaysState.handleSelectCall,
      priorityFilter,
      technicianRoster,
    });

  useEffect(() => {
    if (!dbInitialized || registerTabState.lastRegisterListQueryKeyRef.current) return;
    if (debouncedSearch?.trim() || debouncedPincodeSearch?.trim()) return;
    if (!globalReportCache) return;

    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);

    registerTabState.lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
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
      pageLimit: registerTabState.limit,
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
    registerTabState.limit,
  ]);

  const handleApplySummaryFilters = useCallback(() => {
    applyFilters();
    summaryTabState.setSourceSelection(summaryTabState.sourceSelection);
  }, [applyFilters, summaryTabState]);

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

          const queryKey = buildRegisterListQueryKeyFromViewFilters({
            officeIdsParam: 'All',
            callTypesParam: resolveViewCallTypesParam(selectedCallTypes),
            startDateStr,
            endDateStr,
            dateFilterColumn,
            viewFilters: {
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
            },
            agingAsOf: agingAsOf || '',
            pageLimit: registerTabState.limit,
          });

          const exportQuery = buildRegisterExportQueryFromViewFilters({
            officeId: resolveSummaryOfficeIdsParam(
              offices,
              selectedBranch,
              selectedFranchisee
            ),
            callType: resolveViewCallTypesParam(selectedCallTypes),
            startDate: startDateStr,
            endDate: endDateStr,
            dateFilterColumn,
            viewFilters: {
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
            },
          });

          let exportData: Record<string, unknown>[] = registerTabState.data;

          const needsFullFetch =
            registerTabState.total > registerTabState.limit ||
            registerTabState.data.length < registerTabState.total;

          if (needsFullFetch && exportData.length < registerTabState.total) {
            const cachedAllPages = collectRegisterRowsFromSessionCache(
              registerTabState.registerPagesCacheRef.current,
              queryKey,
              registerTabState.total,
              registerTabState.limit
            );

            if (cachedAllPages?.length) {
              exportData = cachedAllPages;
            }
          }

          if (
            needsFullFetch &&
            !readRegisterFromPostgresClient() &&
            exportData.length < registerTabState.total
          ) {
            const spanDays = corpusSpanDays(startDateStr, endDateStr);

            if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
              const corpusKey = buildCorpusCacheKey(
                startDateStr,
                endDateStr,
                dateFilterColumn
              );

              if (
                callCorpusStore?.cacheKey === corpusKey &&
                (callCorpusStore?.calls.size ?? 0) > 0
              ) {
                const viewDateFilter = buildCorpusViewDateFilter(
                  startDateStr,
                  endDateStr,
                  dateFilterColumn
                );

                exportData = getFilteredCorpusCalls(
                  registerTabState.registerViewFilterRef.current,
                  callCorpusStore,
                  viewDateFilter
                );
              }
            }
          }

          if (needsFullFetch && exportData.length < registerTabState.total) {
            const stream = shouldStreamRegisterExportFromServer(
              registerTabState.total,
              exportData.length
            );

            if (stream) {
              onProgress({
                fetched: 0,
                total: registerTabState.total,
              });

              const {
                data: { session },
              } = await supabase.auth.getSession();

              const prepared = await prepareRegisterCsvFromServer({
                query: exportQuery,
                knownTotal: registerTabState.total,
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
              knownTotal: registerTabState.total,
              signal,
              query: exportQuery,
              onProgress: (fetched, total) => {
                onProgress({
                  fetched,
                  total,
                });
              },
            });
          }

          if (!exportData.length) {
            throw new Error('No data to export');
          }

          const { prepareRegisterExcelFromRows } = await import(
            '@/modules/mis/register/services/excel-export'
          );

          return prepareRegisterExcelFromRows(exportData, {
            filename: `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.xlsx`,
            sheetName: 'Call Register',
            onProgress: (processed, total) => {
              onProgress({
                fetched: processed,
                total,
              });
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
        if (!bdMisTabState.bdMisExportData?.regionalRows?.length) {
          throw new Error('No data to export. Apply filters and wait for the summary to load.');
        }
        const { buildBdMisSummaryWorkbook, bdMisSummaryFilename } = await import(
          '@/modules/mis/services/bd-mis-excel-export'
        );
        const { workbookToPreparedExport } = await import('@/modules/mis/services/summary-excel-export');
        const workbook = await buildBdMisSummaryWorkbook({
          ...bdMisTabState.bdMisExportData,
          filterMeta: bdMisTabState.buildBdMisExportFilterMeta(),
        });
        return workbookToPreparedExport(workbook, bdMisSummaryFilename());
      }

      if (sourceTab === 'summary') {
        const {
          buildSummaryDashboardWorkbook,
          workbookToPreparedExport,
        } = await import('@/modules/mis/services/summary-excel-export');
        const { buildSummaryDashboardExportAlign } = await import(
          '@/modules/mis/services/summary-trace-export'
        );
        const snap = summaryTabState.summaryExcelExportRef.current;
        if (!snap) {
          throw new Error('Summary export state not ready. Wait for the dashboard to load.');
        }
        const uiAlign = buildSummaryDashboardExportAlign({
          summaryData: snap.summaryData,
          clientSummaryData: snap.clientSummaryData,
          clientAccountSummaryData: snap.clientAccountSummaryData,
          mergedAccountRows: snap.mergedAccountRowsForTotals,
          mergeFlags: snap.mergeFlags,
          clientMergeWithCrm: snap.clientMergeWithCrm,
          clientOnlyMode: snap.clientOnlyMode,
        });
        const workbook = await buildSummaryDashboardWorkbook(snap.summaryData, undefined, {
          uiAlign,
        });
        return workbookToPreparedExport(workbook, fileName);
      }

      if (sourceTab === 'accounts') {
        const {
          buildKeyAccountMisWorkbook,
          workbookToPreparedExport,
        } = await import('@/modules/mis/services/summary-excel-export');
        const displayAccounts = buildAccountDisplayRows(
          summaryTabState.accountsData,
          summaryTabState.clientAccountSummaryData,
          summaryTabState.mergeFlags
        );
        const filtered = displayAccounts.filter((a) => {
          const matchRegion = matchesRegionFilter(summaryTabState.filterRegion, String(a.region ?? ''));
          const matchAccount = matchesAccountFilter(summaryTabState.filterAccount, String(a.account ?? ''));
          return matchRegion && matchAccount;
        });
        const exportRows = resolveAccountMisTableRows(
          filtered,
          summaryTabState.accountMisGrouping,
          summaryTabState.accountMisTopN,
          summaryTabState.clientAccountSummaryData,
          summaryTabState.mergeFlags,
          summaryTabState.clientMergeWithCrm,
          summaryTabState.accountMisZoneTopExclude
        );
        const workbook = await buildKeyAccountMisWorkbook(
          exportRows as import('@/lib/summary/derive').AccountSummaryRow[],
          undefined,
          { hideRegion: summaryTabState.accountMisGrouping === 'overview' }
        );
        return workbookToPreparedExport(workbook, fileName);
      }

      throw new Error('Export is not available on this tab');
    },
    [
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      selectedCallTypes,
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
      offices,
      agingAsOf,
      registerTabState,
      bdMisTabState,
      summaryTabState,
      supabase,
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

  const handleManualCallsHotSync = useCallback(async () => {
    if (manualCallsHotSyncBusy) return;
    setManualCallsHotSyncBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await axios.post<{
        success?: boolean;
        ok?: boolean;
        asOf?: string;
        rowsUpserted?: number;
        detail?: string;
        error?: string;
      }>(
        '/api/admin/calls-hot-sync',
        {},
        {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
          timeout: 300_000,
        }
      );
      if (!res.data.ok && res.data.success !== true) {
        throw new Error(res.data.error || res.data.detail || 'Sync failed');
      }
      feedback.actionSuccess(res.data.detail || `Synced through ${res.data.asOf ?? 'yesterday'}`);
      await registerTabState.fetchDelta();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Failed to sync from CRM';
      feedback.actionFailed(message);
    } finally {
      setManualCallsHotSyncBusy(false);
    }
  }, [manualCallsHotSyncBusy, supabase.auth, registerTabState.fetchDelta]);

  if (!mounted) {
    return <ReportPageSkeleton className="bg-bg-canvas" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-canvas text-slate-900">
      <ReportPageHeaderBar
        misTabs={misTabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lastRefreshed={registerTabState.lastRefreshed}
        filterUpdating={registerTabState.loading}
        syncInProgress={syncInProgress}
        corpusLoading={corpusLoading}
        summaryTabLoading={summaryTabState.summaryTabLoading}
        bdMisTabLoading={bdMisTabState.bdMisTabLoading}
        total={registerTabState.total}
        isCurrentTabExcelExporting={isCurrentTabExcelExporting}
        isCurrentTabTraceExporting={isCurrentTabTraceExporting}
        onSync={() => void registerTabState.fetchDelta()}
        canManualCallsHotSync={canManualCallsHotSync}
        manualCallsHotSyncBusy={manualCallsHotSyncBusy}
        onManualCallsHotSync={() => void handleManualCallsHotSync()}
        onExportExcel={() => handleExport('excel')}
        onExportTrace={() => bdMisTabState.handleBdMisTraceExport()}
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
          summary={registerTabState.registerSummary}
          updating={registerTabState.loading}
          updatingLabel={
            registerTabState.loading ? 'Updating filters…' : 'Refreshing call register…'
          }
          onBeforeOpenFilters={() => void loadFilterOptions()}
          onApply={() => void registerTabState.runRegisterFilterLoad({ force: true })}
          onSearchEnter={() => void registerTabState.runRegisterFilterLoad({ force: true })}
          onPincodeEnter={() => void registerTabState.runRegisterFilterLoad({ force: true })}
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
          summaryTabLoading={summaryTabState.summaryTabLoading}
          bdMisTabLoading={bdMisTabState.bdMisTabLoading}
          hasPendingFilterChanges={hasPendingFilterChanges}
          clientImportActiveSources={summaryTabState.clientImportActiveSources}
          sourceSelection={summaryTabState.sourceSelection}
          setSourceSelection={summaryTabState.setSourceSelection}
          clientMergeWithCrm={summaryTabState.clientMergeWithCrm}
          setClientMergeWithCrm={summaryTabState.setClientMergeWithCrm}
        />
      ) : null}

      {/* Main Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-canvas">
        {activeTab === 'register' ? (
          <ReportRegisterTabPanel
            loading={registerTabState.loading}
            data={registerTabState.data}
            displayedData={registerTabState.data}
            total={registerTabState.total}
            page={registerTabState.page}
            limit={registerTabState.limit}
            visibleRegisterColumns={visibleRegisterColumns}
            setVisibleRegisterColumns={setVisibleRegisterColumns}
            visibleRegisterColumnDefs={visibleRegisterColumnDefs}
            getRegisterCellClassName={getRegisterCellClassName}
            renderRegisterCell={renderRegisterCell}
            isAnyRegisterFilterActive={isAnyRegisterFilterActive}
            clearAllFilters={clearAllFilters}
            runRegisterFilterLoad={registerTabState.runRegisterFilterLoad}
            handleRegisterPageSizeChange={registerTabState.handleRegisterPageSizeChange}
            setPage={registerTabState.setPage}
            fetchData={registerTabState.fetchData}
            sort={registerTabState.registerSort}
            onSortChange={registerTabState.handleRegisterSortChange}
          />
        ) : activeTab === 'summary' ? (
          <ReportSummaryTabPanel
            accountsData={summaryTabState.accountsData}
            alignCrmToAccounts={summaryTabState.alignCrmToAccounts}
            clientAccountSummaryData={summaryTabState.clientAccountSummaryData}
            clientMergeWithCrm={summaryTabState.clientMergeWithCrm}
            clientOnlyMode={summaryTabState.clientOnlyMode}
            clientSummaryData={summaryTabState.clientSummaryData}
            expandedBranches={summaryTabState.expandedBranches}
            handleDrillDown={overlaysState.handleDrillDown}
            mergeFlags={summaryTabState.mergeFlags}
            mergedAccountRowsForTotals={summaryTabState.mergedAccountRowsForTotals}
            setExpandedBranches={summaryTabState.setExpandedBranches}
            summaryData={summaryTabState.summaryData}
            summaryTabLoading={summaryTabState.summaryTabLoading}
          />
        ) : activeTab === 'accounts' ? (
          <ReportAccountsTabPanel
            accountMisGrouping={summaryTabState.accountMisGrouping}
            accountMisTopN={summaryTabState.accountMisTopN}
            accountMisZoneTopExclude={summaryTabState.accountMisZoneTopExclude}
            clientAccountSummaryData={summaryTabState.clientAccountSummaryData}
            clientMergeWithCrm={summaryTabState.clientMergeWithCrm}
            filterAccount={summaryTabState.filterAccount}
            filterRegion={summaryTabState.filterRegion}
            globalHeadcount={summaryTabState.globalHeadcount}
            handleDrillDown={overlaysState.handleDrillDown}
            mergeFlags={summaryTabState.mergeFlags}
            mergedAccountRowsForTotals={summaryTabState.mergedAccountRowsForTotals}
            setAccountMisGrouping={summaryTabState.setAccountMisGrouping}
            setAccountMisTopN={summaryTabState.setAccountMisTopN}
            setAccountMisZoneTopExclude={summaryTabState.setAccountMisZoneTopExclude}
            setFilterAccount={summaryTabState.setFilterAccount}
            setFilterRegion={summaryTabState.setFilterRegion}
            setShowAccountDropdown={summaryTabState.setShowAccountDropdown}
            setShowRegionDropdown={summaryTabState.setShowRegionDropdown}
            setShowZoneTopExcludeDropdown={summaryTabState.setShowZoneTopExcludeDropdown}
            setTempFilterAccount={summaryTabState.setTempFilterAccount}
            setTempFilterRegion={summaryTabState.setTempFilterRegion}
            setTempZoneTopExclude={summaryTabState.setTempZoneTopExclude}
            showAccountDropdown={summaryTabState.showAccountDropdown}
            showRegionDropdown={summaryTabState.showRegionDropdown}
            showZoneTopExcludeDropdown={summaryTabState.showZoneTopExcludeDropdown}
            summaryData={summaryTabState.summaryData}
            summaryTabLoading={summaryTabState.summaryTabLoading}
            tempFilterAccount={summaryTabState.tempFilterAccount}
            tempFilterRegion={summaryTabState.tempFilterRegion}
            tempZoneTopExclude={summaryTabState.tempZoneTopExclude}
          />
        ) : activeTab === 'bd_mis_summary' ? (
          <ReportBdMisTabPanel
            bdMisGrand={bdMisTabState.bdMisGrand}
            bdMisRegionalRows={bdMisTabState.bdMisRegionalRows}
            bdMisTabLoading={bdMisTabState.bdMisTabLoading}
          />
        ) : activeTab === 'client_import' ? (
          <ReportErrorBoundary label="Client Import">
            <ClientImportTab
              uploadSource={uploadSource}
              sourceSelection={summaryTabState.sourceSelection}
              dateScope={
                summaryTabState.resolveClientImportScope() ?? {
                  startDate: toDateString(dateRange.start),
                  endDate: toDateString(dateRange.end),
                }
              }
              metaRefreshKey={appliedRevision}
              onUploadSourceChange={setUploadSource}
              onSourceSelectionChange={(selection) => {
                saveMisSourceSelection(selection);
                summaryTabState.setSourceSelection(selection);
              }}
              onImportComplete={() => {
                const scope = summaryTabState.resolveClientImportScope();
                if (scope) void summaryTabState.fetchClientImportSummary(scope);
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
        isDrawerOpen={overlaysState.isDrawerOpen}
        selectedCall={overlaysState.selectedCall}
        onCloseDrawer={overlaysState.handleCloseDrawer}
        onFlagUpdate={overlaysState.handleFlagUpdate}
        onPostComment={overlaysState.handlePostComment}
        drillDown={overlaysState.drillDown}
        setDrillDown={overlaysState.setDrillDown}
        handleSelectCall={overlaysState.handleSelectCall}
      />
    </div>
  );
}
