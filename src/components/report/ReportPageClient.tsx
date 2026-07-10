'use client';

import type ExcelJS from 'exceljs';
import dynamic from 'next/dynamic';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { signOutAndGoToLogin } from '@/lib/auth/sign-out-client';
import {
  canAccessMisTab,
  defaultMisTab,
  hasCapability,
  visibleTabs,
  type MisTabId,
} from '@/lib/auth/rbac-catalog';
import axios from 'axios';
import {
  Download,
  Filter,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  X,
} from 'lucide-react';
import { PageAlert } from '@/components/ui/PageAlert';
import { HorizontalScrollFade } from '@/components/ui/HorizontalScrollFade';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { ReportOrientationBanner } from '@/components/report/ReportOrientationBanner';
import ReportExportQueuePanel from '@/components/report/ReportExportQueuePanel';
import { useReportExportQueue } from '@/components/report/useReportExportQueue';
import type { ExportQueueRunContext } from '@/lib/report/export-queue';
import { isExportActiveForTab } from '@/lib/report/export-queue';
import { consumeExportInterruptedFlag, markExportInterrupted } from '@/lib/report/export-queue-session';
import { exportLabelForMisTab } from '@/lib/report/export-labels';
import { ReportErrorBoundary } from '@/components/report/ReportErrorBoundary';
import { ReportPageSkeleton, ReportLoadingPanel } from '@/components/report/ReportLoadingFeedback';
import { useRegisterFilterOptions } from '@/lib/report/hooks/useRegisterFilterOptions';
import { feedback } from '@/lib/ui/feedback';
import { useUser } from '@/components/layout/DashboardLayout';
import { DateRangeSelector } from '@/components/register/DateRangeSelector';
import { useRouter, usePathname } from 'next/navigation';

const CallDetail = dynamic(
  () => import('@/components/calls/CallDetail').then((m) => ({ default: m.CallDetail })),
  { ssr: false }
);
import { RegisterBranchFranchiseeFilters } from '@/components/register/RegisterBranchFranchiseeFilters';
import { RegisterMultiSelect } from '@/components/register/RegisterMultiSelect';
import { RegisterColumnPicker } from '@/components/register/RegisterColumnPicker';
import { RegisterPageFilters } from '@/components/register/RegisterPageFilters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  buildRegisterListQueryKey,
  normalizeRegisterPageSize,
  readStoredRegisterPageSize,
  resolveTechnicianDisplayName,
  REGISTER_PAGE_SIZE_OPTIONS,
  type RegisterPageSize,
  buildSummaryQueryKey,
  filtersEqual,
  joinFilterParam,
  migrateStringFilter,
  resolveViewCallTypesParam,
  resolveSummaryOfficeIdsParam,
} from '@/lib/report/filters';
import {
  loadVisibleRegisterColumns,
  REGISTER_TABLE_COLUMNS,
  saveVisibleRegisterColumns,
  type RegisterTableColumnKey,
} from '@/lib/register/table-columns';
import { getCallTypeBadgeClass } from '@/lib/report/call-type-badge';
import { MAX_CLIENT_CORPUS_DAYS, resolveRegisterDateSqlColumn } from '@/lib/trhcalls/query';
import {
  findCallsInIndexedDb,
  findCallsInMemoryCaches,
  isIdentifierLookupSearch,
  registerRowMatchesViewFilters,
  summarizeRegisterRows,
  classifyRegisterRowStatus,
  isRegisterRowSolvedForMis,
  isRegisterRowCancelled,
  normalizeRegisterSummary,
  type RegisterSummary,
  type RegisterSummaryBucket,
  type RegisterViewFilterParts,
} from '@/lib/report/search';
import {
  appliedFilterPartsFromSnapshot,
  isAnyFilterActive,
  normalizeAgingAsOfDate,
  toDateString,
} from '@/lib/report/filters';
import { globalReportCache, setGlobalReportCache, distributionDataCache, setDistributionDataCache, callCorpusStore } from '@/lib/report/data-store';
import { indexRegisterRowsWithSerial, subscribeRegisterDelta } from '@/lib/report/sync';
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
} from '@/lib/report/corpus';
import { openReportsDb, readCorpusMeta } from '@/lib/report/corpus-storage';
import { deriveSummaryDashboard, diagnoseSummaryDerivation } from '@/lib/report/summary-derive';
import {
  readRegisterFromPostgresClient,
  readSummaryFromPostgresClient,
  registerPostgresHotPathAvailable,
} from '@/lib/read-model/client-flags';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { deriveRegisterPageFromCalls, deriveRegisterView } from '@/lib/report/register-view';
import {
  collectRegisterRowsFromSessionCache,
  downloadRegisterCsvFromRows,
  prepareRegisterCsvFromServer,
  fetchAllRegisterRowsForExport,
  isRegisterExportAbortError,
  logRegisterBulk,
  shouldStreamRegisterExportFromServer,
} from '@/lib/register/export-fetch';
import { clearPortalAuditCache, ensurePortalAuditCache } from '@/lib/report/portal-cache';
import ClientImportTab from '@/components/report/ClientImportTab';
import { BdMisSummaryPanel } from '@/components/report/BdMisSummaryPanel';
import type { BdMisGrandRow, BdMisRegionalRow, BdMisSourceFlags } from '@/lib/report/bd-mis-summary';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/report/summary-derive';
import MisSourceCheckboxes from '@/components/report/MisSourceCheckboxes';
import {
  loadClientMergeWithCrmPrefs,
  saveClientMergeWithCrmPrefs,
} from '@/components/report/MisClientMergeCheckbox';
import {
  SummaryMergedMetricCell,
  accountOpenCallsFromAging,
  accountOpenCallsFromAgingByAccount,
  accountMergeFlags,
  accountRowScore,
  buildAccountDisplayRows,
  buildClientOnlyRegionalRows,
  type ClientMergeWithCrmPrefs,
  displayLoggedCallCount,
  filterClientAccountSummary,
  filterTopAccountsByZone,
  findAccountMetric,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  isAccountExcludedFromZoneTop,
  findAccountMetricByAccount,
  findBranchMetric,
  findBranchRowMetric,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeFlagsFromSelection,
  mergeSelectedMetrics,
  rollupAccountsByAccount,
  rollupCrmAccountsByRegion,
  sumAccountMetric,
  sumMergedAccountMetric,
  sumMergedAccountOpenCalls,
  resolveSummaryRegionMetric,
  resolveSummaryRegionOpenCalls,
  sumAccountMetricByRegion,
  sumBranchMetric,
  sumBranchLoggedCalls,
} from '@/components/report/SummaryMergedMetricCell';
import {
  isClientOnlyMode,
  loadMisSourceSelection,
  saveMisSourceSelection,
  sourceCodesToParam,
  type MisSourceSelection,
} from '@/lib/mis-client-import/source-selection';

type AccountMisGrouping = 'zone' | 'overview' | 'zone-top';

function regionPerfRowClass(region: string): string {
  const r = String(region ?? '').toUpperCase();
  if (r.includes('NORTH')) return 'perf-region-row perf-region-row--north';
  if (r.includes('EAST')) return 'perf-region-row perf-region-row--east';
  if (r.includes('WEST')) return 'perf-region-row perf-region-row--west';
  if (r.includes('SOUTH')) return 'perf-region-row perf-region-row--south';
  return 'perf-region-row perf-region-row--default';
}

function regionPerfAccountCellClass(region: string): string {
  const r = String(region ?? '').toUpperCase();
  if (r === 'NORTH' || r === 'NORTH ZONE') return 'perf-region-cell perf-region-cell--north';
  if (r === 'EAST' || r === 'EAST ZONE') return 'perf-region-cell perf-region-cell--east';
  if (r === 'WEST' || r === 'WEST ZONE') return 'perf-region-cell perf-region-cell--west';
  if (r === 'SOUTH' || r === 'SOUTH ZONE') return 'perf-region-cell perf-region-cell--south';
  return 'perf-region-cell perf-region-cell--default';
}

function resolveAccountMisTableRows(
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
    return filterTopAccountsByZone(
      filteredAccounts,
      topN,
      scoreFn,
      zoneTopExcludeAccounts
    );
  }
  return filteredAccounts;
}

// --- IndexedDB Local Storage Cache Helpers (same DB version as report-corpus-storage) ---
const saveCallsToDB = async (calls: any[]) => {
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

const getCallsFromDB = async (): Promise<any[]> => {
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

const saveMeta = async (key: string, val: any) => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
  } catch (err) {
    console.error('IndexedDB meta save error:', err);
  }
};

const getMeta = async (key: string): Promise<any> => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
};

const clearCallsDB = async () => {
  try {
    const db = await openReportsDb();
    const tx = db.transaction(['calls', 'meta'], 'readwrite');
    tx.objectStore('calls').clear();
    tx.objectStore('meta').clear();
  } catch (err) {
    console.error('IndexedDB clear error:', err);
  }
};

type RegisterPageCacheEntry = {
  data: any[];
  total: number;
  registerSummary?: RegisterSummary | null;
  summaryData?: any[];
  accountsData?: any[];
  globalHeadcount?: number;
};

function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

function adjustRegisterSummaryBucket(
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

function registerPageCachePut(
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

function registerPageCacheGet(
  root: Map<string, Map<number, RegisterPageCacheEntry>>,
  queryKey: string,
  page: number
): RegisterPageCacheEntry | undefined {
  return root.get(queryKey)?.get(page);
}

/** No-op — perf hooks kept so call sites stay stable without console noise. */
function logSummaryDebug(_label: string, _payload: Record<string, unknown>) {}

function corpusSpanDays(startDateStr: string, endDateStr: string): number {
  const spanStart = new Date(`${startDateStr}T00:00:00`);
  const spanEnd = new Date(`${endDateStr}T23:59:59`);
  if (Number.isNaN(spanStart.getTime()) || Number.isNaN(spanEnd.getTime())) return 0;
  return Math.floor((spanEnd.getTime() - spanStart.getTime()) / 86400000) + 1;
}

function reportPerfLogDocumentNavigationOnce() {
  /* no-op */
}

function reportPerf(
  _phase: string,
  _action: string,
  _opStart: number,
  _extra?: Record<string, unknown>
) {
  /* no-op */
}

/** Cadbury+Coke+CRM Summary tab — hidden until reconciliation is production-ready. */
const BD_MIS_SUMMARY_TAB_ENABLED = false;

export default function ReportPageClient() {
  const [mounted, setMounted] = useState(false);
  const { userProfile } = useUser();
  const userPermissions = (userProfile?.permissions ?? []) as string[];
  const misAccess = useMemo(
    () => ({
      register: canAccessMisTab(userPermissions, 'register'),
      summary: canAccessMisTab(userPermissions, 'summary'),
      accounts: canAccessMisTab(userPermissions, 'accounts'),
      client_import: canAccessMisTab(userPermissions, 'client_import'),
      bd_mis_summary:
        BD_MIS_SUMMARY_TAB_ENABLED && canAccessMisTab(userPermissions, 'bd_mis_summary'),
    }),
    [userPermissions]
  );

  const misTabs = useMemo(
    () =>
      visibleTabs(userPermissions, 'mis_reports')
        .filter((tab) => BD_MIS_SUMMARY_TAB_ENABLED || tab.id !== 'bd_mis_summary')
        .map((tab) => ({
        id: tab.id as MisTabId,
        label: tab.label,
        allowed: true,
      })),
    [userPermissions]
  );

  useEffect(() => {
    if (!userProfile?.permissions?.length) return;
    const nextTab = defaultMisTab(userPermissions);
    setActiveTab((current) => {
      if (misTabs.some((tab) => tab.id === current)) return current;
      return nextTab;
    });
  }, [userProfile?.permissions, userPermissions, misTabs]);

  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const pageSessionStartRef = React.useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const {
    search,
    setSearch,
    pincodeSearch,
    setPincodeSearch,
    debouncedSearch,
    debouncedPincodeSearch,
    dateRange,
    setDateRange,
    agingAsOf,
    setAgingAsOf,
    dateFilterColumn,
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
    selectedRegion,
    selectedAccount,
    selectedBranch,
    setSelectedBranch,
    selectedFranchisee,
    setSelectedFranchisee,
    selectedTechnician,
    setSelectedTechnician,
    setStatesList,
    setCitiesList,
    setRegionsList,
    setAccountsList,
    techniciansList,
    setTechniciansList,
    setBranchesList,
    setFranchiseesList,
    branchesList,
    franchiseesList,
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
    prefsReady,
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
  const [clientImportMeta, setClientImportMeta] = useState<{
    rowsInDateRange: number;
    totalRowsInFiles: number;
  } | null>(null);
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
  /** BD MIS Excel union uses full client snapshots (YTD); not used for date-filtered Summary Dashboard. */
  const [excelUnionRegionalRows, setExcelUnionRegionalRows] = useState<BdMisRegionalRow[]>([]);
  const [excelUnionGrand, setExcelUnionGrand] = useState<BdMisGrandRow | null>(null);
  const useBdMisExcelUnion = false;
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
      } catch(e) {}
    }
    setMounted(true);
  }, []);
  const [page, setPage] = useState(globalReportCache?.page || 1);
  const [limit, setLimit] = useState(readStoredRegisterPageSize);

  const technicianRoster = useMemo(
    () =>
      techniciansList.map((t: { ncode: string; vname: string }) => ({
        value: String(t.ncode),
        label: String(t.vname || t.ncode),
      })),
    [techniciansList]
  );
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const registerPagesCacheRef = React.useRef<Map<string, Map<number, RegisterPageCacheEntry>>>(new Map());
  const lastKnownRegisterTotalRef = React.useRef<number>(globalReportCache?.total || 0);
  const clearFiltersRef = React.useRef<boolean>(false);

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

  useEffect(() => {
    reportPerfLogDocumentNavigationOnce();
    const tMount = performance.now();
    reportPerf('lifecycle', 'ReportPage mount effect (after paint)', tMount, {
      why: 'Runs after first paint; msSincePageSessionStart ≈ time from component render start to this effect.',
      msSincePageSessionStart: Number((tMount - pageSessionStartRef.current).toFixed(1)),
    });
  }, []);

  const [selectedBranchEngs, setSelectedBranchEngs] = useState<string[]>([]);
  const [showEngPopup, setShowEngPopup] = useState<string | null>(null);
  const [fetchingEngs, setFetchingEngs] = useState(false);
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
  const exportStartedAtRef = React.useRef<number>(0);
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
      buildRegisterListQueryKey({
        officeIdsParam: summaryOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: debouncedSearch || '',
        pincodeForUrl: debouncedPincodeSearch || '',
        startDateStr: toDateString(dateRange.start),
        endDateStr: toDateString(dateRange.end),
        dateFilterColumn,
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
        agingAsOf: agingAsOf || '',
        pageLimit: limit,
      }),
    [
      summaryOfficeIdsParam,
      viewCallTypesParam,
      debouncedSearch,
      debouncedPincodeSearch,
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
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

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
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

  const handleSelectCall = async (id: string, row?: any) => {
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
    data: any[];
    type: string;
    title: string;
    params: any;
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

  const renderRegisterCell = (key: RegisterTableColumnKey, row: any) => {
    switch (key) {
      case 'UniqueCallNo':
        return (
          <button onClick={() => handleSelectCall(String(row.id), row)} className="text-slate-700 underline hover:text-slate-900">
            {row.UniqueCallNo}
          </button>
        );
      case 'vcclid':
        return (
          <button onClick={() => handleSelectCall(String(row.id), row)} className="underline hover:text-slate-700">
            {row.vcclid ?? '—'}
          </button>
        );
      case 'calltype':
        return (
          <span className={`ui-strong ${getCallTypeBadgeClass(row.calltype)}`}>
            {row.calltype || 'N/A'}
          </span>
        );
      case 'callsdtrndate':
        return formatDate(row.callsdtrndate);
      case 'PartyName':
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.PartyName}
            {priorityFilter.length === 0 && row.is_major_repair === 'True' && (
              <span className="report-major-badge rounded bg-rose-500 px-1 py-0.5 text-[8px] text-white ui-strong">MAJOR</span>
            )}
          </span>
        );
      case 'officename':
        return row.officename && row.officename !== 'UNKNOWN' ? row.officename : '—';
      case 'region':
        return row.region ?? '—';
      case 'account':
        return row.account ?? '—';
      case 'franchisee_name':
        return row.franchisee_name && row.franchisee_name !== 'Unallocated'
          ? row.franchisee_name
          : '—';
      case 'Pincode':
        return row.Pincode ?? row.pincode ?? '—';
      case 'itemname':
        return row.itemname;
      case 'callsvserialno': {
        const serial = row.callsvserialno != null ? String(row.callsvserialno) : '';
        return serial ? <TruncatedText text={serial} className="font-mono" /> : '—';
      }
      case 'serviceman':
        return resolveTechnicianDisplayName(row, technicianRoster);
      case 'vcomplaint':
        return row.vcomplaint;
      case 'Status':
        return (() => {
          const bucket = classifyRegisterRowStatus(row);
          const isRejected =
            bucket === 'closed' &&
            (row.bmreject === 'Yes' ||
              String(row.rejectionstatus) === '1' ||
              String(row.rejectionstatus) === '2');
          if (isRejected) return <span className="badge-cancelled">Closed - Rejected</span>;
          if (bucket === 'cancelled') return <span className="badge-cancelled">Cancelled</span>;
          if (bucket === 'closed') return <span className="badge-solved">Solved</span>;
          if (bucket === 'techSolved') return <span className="badge-solved">Tech. Solved</span>;
          if (bucket === 'assigned') return <span className="badge-assigned">Assigned</span>;
          return <span className="badge-open">Open</span>;
        })();
      case 'portal_action':
        return (() => {
          const flag = row.audit_flag || 'unseen';
          const label = flag === 'noted' ? 'Verified' : flag === 'query' ? 'Hold' : flag === 'escalate' ? 'Rejected' : 'Unseen';
          const badgeClass = flag === 'noted' ? 'badge-solved' : flag === 'query' ? 'badge-assigned' : flag === 'escalate' ? 'badge-cancelled' : 'badge-unseen';
          const commentCount = row.comment_count ?? row.comments?.length ?? 0;
          return (
            <div className="flex flex-col items-start gap-1">
              <span className={`text-[10px] px-2 py-0.5 rounded ui-label ${badgeClass}`}>{label}</span>
              {commentCount > 0 && (
                <span className="text-[9px] text-slate-400 font-medium">{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
              )}
            </div>
          );
        })();
      case 'callsolveddate':
        return formatDate(row.callsolveddate);
      case 'bm_approved_date':
        return row.bm_approved_date ? String(row.bm_approved_date) : '—';
      case 'ho_approved_date':
        return row.ho_approved_date ? String(row.ho_approved_date) : '—';
      case 'vsolveremarks':
        return (() => {
          const rejectionRemark = row.vcomment || null;
          const solveRemark = row.vsolveremarks || row.cancel_reason || null;
          if (rejectionRemark) {
            return <span className="font-medium text-rose-600">⚑ {rejectionRemark}</span>;
          }
          return <span className="text-slate-400">{solveRemark || '—'}</span>;
        })();
      case 'vpersoncalling':
        return row.vpersoncalling;
      case 'vinsttel1':
        return row.vinsttel1;
      case 'vinstaddress':
        return row.vinstaddress;
      default:
        return '—';
    }
  };

  const getRegisterCellClassName = (key: RegisterTableColumnKey) => {
    if (key === 'UniqueCallNo') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-mono text-slate-400';
    if (key === 'vcclid') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-900';
    if (key === 'PartyName') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-800';
    if (key === 'Pincode' || key === 'callsvserialno') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700';
    if (key === 'officename' || key === 'region' || key === 'account' || key === 'franchisee_name' || key === 'itemname') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-700';
    if (key === 'serviceman' || key === 'vinsttel1') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-900';
    if (key === 'vpersoncalling') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-600';
    if (key === 'bm_approved_date' || key === 'ho_approved_date') {
      return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-600';
    }
    if (key === 'vsolveremarks') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px]';
    if (key === 'vinstaddress') return 'whitespace-nowrap px-3 py-2 text-[11px] text-slate-500';
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-500';
  };

  const fetchControllerRef = React.useRef<AbortController | null>(null);
  const registerAuthFailedRef = React.useRef(false);
  const drillDownControllerRef = React.useRef<AbortController | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
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
  const loadExcelUnionSummaryRef = React.useRef<() => Promise<void>>(async () => {});
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
  };

  // Client-side cascades computation removed in favor of server-side cascades

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';

    // Handle DD/MM/YYYY with optional time
    if (typeof dateStr === 'string' && dateStr.includes('/') && dateStr.split('/')[0].length <= 2) {
      const parts = dateStr.split(' ')[0].split('/');
      if (parts.length === 3) {
        const [d, m, y] = parts;
        const date = new Date(`${y}-${m}-${d}`);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      }
    }

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Return raw if still invalid, might be a string already
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

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
      const isBaseFilter = 
        selectedState.length === 0 &&
        selectedCity.length === 0 &&
        selectedBranch.length === 0 &&
        selectedFranchisee.length === 0 &&
        selectedTechnician.length === 0 &&
        search === '' &&
        pincodeSearch === '' &&
        selectedStatus.length === 0 &&
        priorityFilter.length === 0 &&
        portalFilter.length === 0 &&
        selectedOfficeIds.length === 0 &&
        selectedCallTypes.length === 0 &&
        !filterAccount && filterRegion.length === 0;

      if (isBaseFilter) {
        try {
          localStorage.setItem('report_fortnight_cache', JSON.stringify({
            data: calls.slice(0, 100),
            total,
            summaryData,
            accountsData,
            globalHeadcount
          }));
        } catch(e) {}
          
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

  const getEffectiveViewFilters = useCallback((): RegisterViewFilterParts => {
    return registerViewFilterRef.current;
  }, []);

  /** Summary/Accounts rows must include region hierarchy and headcount. */
  const isApiShapedSummary = (rows: unknown[]): boolean =>
    rows.length > 0 &&
    rows.some(
      (r) =>
        typeof r === 'object' &&
        r != null &&
        'headcount' in r &&
        (r as { headcount?: unknown }).headcount != null &&
        'region' in r
    );

  const buildCurrentSummaryQueryKey = () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    return buildSummaryQueryKey({
      officeIdsParam: resolveSummaryOfficeIdsParam(
        offices,
        applied.selectedBranch,
        applied.selectedFranchisee
      ),
      callTypesParam: resolveViewCallTypesParam(applied.selectedCallTypes),
      startDateStr,
      endDateStr,
      agingAsOf: agingStr,
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
        ? buildSummaryQueryKey({
            officeIdsParam: resolveSummaryOfficeIdsParam(
              offices,
              applied.selectedBranch,
              applied.selectedFranchisee
            ),
            callTypesParam: resolveViewCallTypesParam(applied.selectedCallTypes),
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
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, appliedDateColumn);
    const spanDays = corpusSpanDays(startDateStr, endDateStr);
    const officeIdsParam = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
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
      setClientImportMeta({
        rowsInDateRange: client.rowsInDateRange,
        totalRowsInFiles: client.totalRowsInFiles,
      });
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

  const fetchSummaryFromApi = useCallback(async (): Promise<boolean> => {
    const payload = await loadSummaryFromApiPayload();
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
    return payload.branchSummary.length > 0 || payload.accountSummary.length > 0;
  }, [loadSummaryFromApiPayload, commitSummaryResult]);

  const applyRegisterFromCorpus = useCallback(
    (pageNum = 1, pageLimit: RegisterPageSize = limit): boolean => {
      if (readRegisterFromPostgresClient()) return false;
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
      const queryKey = buildRegisterListQueryKey({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: viewFilters.search || '',
        pincodeForUrl: viewFilters.pincodeSearch || '',
        startDateStr,
        endDateStr,
        dateFilterColumn: dateCol,
        selectedState: viewFilters.selectedState,
        selectedCity: viewFilters.selectedCity,
        selectedRegion: viewFilters.selectedRegion,
        selectedAccount: viewFilters.selectedAccount,
        selectedBranch: viewFilters.selectedBranch,
        selectedFranchisee: viewFilters.selectedFranchisee,
        selectedTechnician: viewFilters.selectedTechnician,
        selectedStatus: viewFilters.selectedStatus,
        priorityFilter: viewFilters.priorityFilter,
        portalFilter: viewFilters.portalFilter,
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
      const queryKey = buildRegisterListQueryKey({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: viewFilters.search || '',
        pincodeForUrl: viewFilters.pincodeSearch || '',
        startDateStr,
        endDateStr,
        dateFilterColumn,
        selectedState: viewFilters.selectedState,
        selectedCity: viewFilters.selectedCity,
        selectedRegion: viewFilters.selectedRegion,
        selectedAccount: viewFilters.selectedAccount,
        selectedBranch: viewFilters.selectedBranch,
        selectedFranchisee: viewFilters.selectedFranchisee,
        selectedTechnician: viewFilters.selectedTechnician,
        selectedStatus: viewFilters.selectedStatus,
        priorityFilter: viewFilters.priorityFilter,
        portalFilter: viewFilters.portalFilter,
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
    }
  ) => {
    const pageSize: RegisterPageSize = opts?.pageLimit ?? limit;
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

    const queryKey = buildRegisterListQueryKey({
      officeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: searchForUrl || '',
      pincodeForUrl: pincodeForUrl || '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
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
      agingAsOf: agingAsOf || '',
      pageLimit: pageSize,
    });

    const localCorpusMatchesAppliedRange =
      !globalReportCache ||
      (toDateString(globalReportCache.dateRange.start) === startDateStr &&
        toDateString(globalReportCache.dateRange.end) === endDateStr);

    if (
      p === 1 &&
      searchForUrl?.trim() &&
      isIdentifierLookupSearch(searchForUrl) &&
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
        return;
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
        return;
      }
    }

    if (!searchActive && !readRegisterFromPostgresClient()) {
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
        return;
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
        return;
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
      let u = basePath;
      if (searchForUrl) u += `&search=${encodeURIComponent(searchForUrl)}`;
      if (pincodeForUrl) u += `&pincode=${encodeURIComponent(pincodeForUrl)}`;
      if (startDateStr) u += `&startDate=${startDateStr}`;
      if (endDateStr) u += `&endDate=${endDateStr}`;
      u += `&dateFilterColumn=${encodeURIComponent(dateFilterColumn)}`;
      const stateParam = joinFilterParam(selectedState);
      const cityParam = joinFilterParam(selectedCity);
      const regionParam = joinFilterParam(selectedRegion);
      const accountParam = joinFilterParam(selectedAccount);
      const technicianParam = joinFilterParam(selectedTechnician);
      const statusParam = joinFilterParam(selectedStatus);
      const priorityParam = joinFilterParam(priorityFilter);
      const portalParam = joinFilterParam(portalFilter);
      if (stateParam) u += `&state=${encodeURIComponent(stateParam)}`;
      if (cityParam) u += `&city=${encodeURIComponent(cityParam)}`;
      if (regionParam) u += `&region=${encodeURIComponent(regionParam)}`;
      if (accountParam) u += `&account=${encodeURIComponent(accountParam)}`;
      const branchParam = joinFilterParam(selectedBranch);
      const franchiseeParam = joinFilterParam(selectedFranchisee);
      if (branchParam) u += `&branch=${encodeURIComponent(branchParam)}`;
      if (franchiseeParam) u += `&franchisee=${encodeURIComponent(franchiseeParam)}`;
      if (technicianParam) u += `&technician=${encodeURIComponent(technicianParam)}`;
      if (statusParam) u += `&status=${encodeURIComponent(statusParam)}`;
      if (priorityParam) u += `&priority=${encodeURIComponent(priorityParam)}`;
      if (portalParam) u += `&portalFilter=${encodeURIComponent(portalParam)}`;
      u += '&fetchFilterOptions=false';
      return u;
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
          if (readRegisterFromPostgresClient()) {
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
      if (axios.isCancel(err)) {
        reportPerf('fetchData', 'aborted (axios cancel)', opStart, {
          opId,
          why: 'AbortController: newer fetchData or navigation cancelled this request.',
        });
        return false;
      }
      const unauthorized = axios.isAxiosError(err) && err.response?.status === 401;
      if (unauthorized) {
        registerAuthFailedRef.current = true;
        fetchControllerRef.current?.abort();
        void signOutAndGoToLogin();
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

  const formatSQLDate = (date: Date) => {
    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  };

  const isTransferred = (rec: any) => {
    return (rec.vtransfercallno && String(rec.vtransfercallno).trim() !== '') || String(rec.ncancelreason) === '2';
  };

  const isSolved = (rec: any) => isRegisterRowSolvedForMis(rec);

  const isCancelled = (rec: any) => {
    if (isTransferred(rec)) return false;
    return classifyRegisterRowStatus(rec) === 'cancelled';
  };

  const isOpen = (rec: any) => {
    const bucket = classifyRegisterRowStatus(rec);
    return bucket === 'openUnallocated' || bucket === 'assigned';
  };

  const fetchDelta = async () => {
    if (readRegisterFromPostgresClient()) {
      registerPagesCacheRef.current.clear();
      const ok = await fetchData(1, { skipCache: true });
      if (ok) {
        feedback.refreshed();
      } else {
        feedback.actionFailed('Failed to refresh report data');
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

    const filterCtx = registerViewFilterRef.current;
    const viewFiltered = isAnyFilterActive(filterCtx);
    const findRowIndex = (rows: any[], rec: any) =>
      rows.findIndex(
        (r) =>
          String(r.UniqueCallNo) === String(rec.UniqueCallNo) ||
          String(r.vcclid) === String(rec.vcclid)
      );

    const currentData = dataRef.current;
    const currentTotal = totalRef.current;
    const currentRegisterSummary = registerSummaryRef.current;
    const currentSummaryData = summaryDataRef.current;
    const currentAccountsData = accountsDataRef.current;
    const currentGlobalHeadcount = globalHeadcountRef.current;

    const updatedData = [...currentData];
    let newAddedCount = 0;
    let dataChanged = false;

    newRecords.forEach((newRec: any) => {
      const idx = findRowIndex(updatedData, newRec);
      if (idx > -1) {
        updatedData[idx] = newRec;
        dataChanged = true;
        return;
      }

      if (viewFiltered) {
        if (registerRowMatchesViewFilters(newRec, filterCtx)) {
          updatedData.unshift(newRec);
          newAddedCount++;
          dataChanged = true;
        }
        return;
      }

      updatedData.unshift(newRec);
      newAddedCount++;
      dataChanged = true;
    });

    if (!dataChanged) return;

    if (!viewFiltered) {
      updatedData.sort((a, b) => {
        const dateA = new Date(a.callsdtrndate || 0).getTime();
        const dateB = new Date(b.callsdtrndate || 0).getTime();
        return dateB - dateA;
      });
    }

    const recordsForSummary = viewFiltered
      ? newRecords.filter((rec) => findRowIndex(currentData, rec) > -1)
      : newRecords;

    if (viewFiltered) {
      setData(updatedData);
      return;
    }

    const nextSummaryData = [...currentSummaryData];
    recordsForSummary.forEach((newRec: any) => {
      if (isTransferred(newRec)) return;
      const branchRowIdx = nextSummaryData.findIndex(
        (b) =>
          b.officeId === newRec.nofficeid ||
          b.branch?.toLowerCase() === newRec.officename?.toLowerCase()
      );
      if (branchRowIdx > -1) {
        const row = { ...nextSummaryData[branchRowIdx] };
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          if (isSolved(oldRec)) row.solved_calls = Math.max(0, (row.solved_calls || 0) - 1);
          else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
          else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
        }
        if (isSolved(newRec)) row.solved_calls = (row.solved_calls || 0) + 1;
        else if (isCancelled(newRec)) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
        else if (isOpen(newRec)) row.open_calls = (row.open_calls || 0) + 1;
        nextSummaryData[branchRowIdx] = row;
      }
    });

    const nextAccountsData = [...currentAccountsData];
    recordsForSummary.forEach((newRec: any) => {
      if (isTransferred(newRec)) return;
      const accRowIdx = nextAccountsData.findIndex(
        (a) => a.account?.toLowerCase() === newRec.PartyName?.toLowerCase()
      );
      if (accRowIdx > -1) {
        const row = { ...nextAccountsData[accRowIdx] };
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          if (isSolved(oldRec)) row.total_solved = Math.max(0, (row.total_solved || 0) - 1);
          else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
          else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
        }
        if (isSolved(newRec)) row.total_solved = (row.total_solved || 0) + 1;
        else if (isCancelled(newRec)) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
        else if (isOpen(newRec)) row.open_calls = (row.open_calls || 0) + 1;
        nextAccountsData[accRowIdx] = row;
      }
    });

    let nextSummary = currentRegisterSummary ? { ...currentRegisterSummary } : null;
    if (nextSummary) {
      let newTotal = nextSummary.total;

      recordsForSummary.forEach((newRec: any) => {
        if (classifyRegisterRowStatus(newRec) === 'transferred') return;
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(oldRec), -1);
        } else {
          newTotal++;
        }

        adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(newRec), 1);
      });

      nextSummary = {
        ...nextSummary!,
        total: newTotal,
      };
    }

    const nextTotal = currentTotal + newAddedCount;
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

  const handleDrillDown = async (type: string, title: string, params: any) => {
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

  const fetchEngineers = async (branch: string) => {
    setFetchingEngs(true);
    setShowEngPopup(branch);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);
      let url = `/api/report/engineers?branch=${encodeURIComponent(branch)}`;
      if (startDateStr) url += `&startDate=${startDateStr}`;
      if (endDateStr) url += `&endDate=${endDateStr}`;

      const res = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setSelectedBranchEngs(res.data);
    } catch (err) {
      feedback.actionFailed('Failed to fetch engineer names');
    } finally {
      setFetchingEngs(false);
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
        const cacheParams = await getMeta('cacheParams');
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
              const derived = deriveRegisterPageFromCorpus(
                restored,
                corpusKey,
                {
                  search: '',
                  pincodeSearch: '',
                  selectedState: [],
                  selectedCity: [],
                  selectedRegion: [],
                  selectedAccount: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                },
                1,
                10,
                viewDateFilter
              );
              if (derived) {
                const allFiltered = getFilteredCorpusCalls(
                  {
                    search: '',
                    pincodeSearch: '',
                    selectedState: [],
                    selectedCity: [],
                    selectedRegion: [],
                    selectedAccount: [],
                    selectedBranch: [],
                    selectedFranchisee: [],
                    selectedTechnician: [],
                    selectedCallTypes,
                    selectedOfficeIds,
                    selectedStatus: [],
                    priorityFilter: [],
                    portalFilter: [],
                  },
                  restored,
                  viewDateFilter
                );
                setData(derived.rows);
                setTotal(derived.total);
                setRegisterSummary(summarizeRegisterRows(allFiltered));
                setLastRefreshed(new Date(restored.lastSyncedAt));
                lastKnownRegisterTotalRef.current = derived.total;
                lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
                  officeIdsParam: registerOfficeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  searchForUrl: '',
                  pincodeForUrl: '',
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedState: [],
                  selectedCity: [],
                  selectedRegion: [],
                  selectedAccount: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                  agingAsOf: agingAsOf || '',
                  pageLimit: limit,
                });
                lastAppliedFilterSnapshotRef.current = JSON.stringify({
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedState: [],
                  selectedCity: [],
                  selectedRegion: [],
                  selectedAccount: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
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
                  registerSummary: summarizeRegisterRows(allFiltered),
                  lastRefreshed: new Date(restored.lastSyncedAt),
                  agingAsOf,
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                  selectedState: [],
                  selectedCity: [],
                  selectedRegion: [],
                  selectedAccount: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
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
              
              const refreshedDate = new Date(cacheParams.lastRefreshed);
              setLastRefreshed(refreshedDate);

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
                selectedStatus: [],
                priorityFilter: [],
                portalFilter: [],
                selectedState: [],
                selectedCity: [],
                selectedBranch: [],
                selectedFranchisee: [],
                selectedTechnician: [],
                summaryQueryKey: cacheParams.summaryQueryKey,
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

              lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
                officeIdsParam,
                callTypesParam: viewCallTypesParam,
                searchForUrl: '',
                pincodeForUrl: '',
                startDateStr,
                endDateStr,
                dateFilterColumn,
                selectedState: [],
                selectedCity: [],
                selectedRegion: [],
                selectedAccount: [],
                selectedBranch: [],
                selectedFranchisee: [],
                selectedTechnician: [],
                selectedStatus: [],
                priorityFilter: [],
                portalFilter: [],
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

    const officeIdsParam = summaryOfficeIdsParam;
    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);

    lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: '',
      pincodeForUrl: '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
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
    agingAsOf,
  ]);

  const runSummaryFilterLoad = useCallback(async (generation: number) => {
    const isStale = () => generation !== summaryTabLoadRef.current;

    const applied = getAppliedFiltersSnapshot();
    if (!applied) return;

    const startDateStr = toDateString(applied.dateRange.start);
    const endDateStr = toDateString(applied.dateRange.end);
    const appliedDateColumn = applied.dateFilterColumn;
    const agingStr = normalizeAgingAsOfDate(applied.agingAsOf);
    const officeIdsParam = resolveSummaryOfficeIdsParam(
      offices,
      applied.selectedBranch,
      applied.selectedFranchisee
    );
    const callTypesParam = resolveViewCallTypesParam(applied.selectedCallTypes);
    const loadKey = buildSummaryQueryKey({
      officeIdsParam,
      callTypesParam,
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

  const loadExcelUnionSummary = useCallback(async () => {
    if (!sourceSelection.crm || sourceSelection.clientSourceCodes.length === 0) {
      setExcelUnionRegionalRows([]);
      setExcelUnionGrand(null);
      return;
    }
    try {
      const data = await fetchBdMisSummaryPayload();
      if (!data) return;
      setExcelUnionRegionalRows(data.regionalRows ?? []);
      setExcelUnionGrand(data.grand ?? null);
    } catch (err) {
      console.warn('Excel union summary fetch failed:', err);
      setExcelUnionRegionalRows([]);
      setExcelUnionGrand(null);
    }
  }, [fetchBdMisSummaryPayload, sourceSelection.crm, sourceSelection.clientSourceCodes.length]);

  loadExcelUnionSummaryRef.current = loadExcelUnionSummary;

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
      } = await import('@/lib/report/summary-trace-export');
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
      '@/lib/report/bd-mis-excel-export'
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
    const { workbookToPreparedExport } = await import('@/lib/report/summary-excel-export');
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
    loadClientImportSources,
    appliedRevision,
  ]);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      drillDownControllerRef.current?.abort();
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t0 = performance.now();
    reportPerf('searchForm', 'submit (skipCache, raw search+pincode)', t0, {
      why: 'Bypasses debounce and session cache for explicit search.',
    });
    fetchData(1, {
      searchOverride: search,
      pincodeOverride: pincodeSearch,
      skipCache: true,
    });
  };

  const buildCurrentRegisterQueryKey = useCallback(() => {
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    return buildRegisterListQueryKey({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: debouncedSearch || '',
      pincodeForUrl: debouncedPincodeSearch || '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
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
      agingAsOf: agingAsOf || '',
      pageLimit: limit,
    });
  }, [
    dateRange.start,
    dateRange.end,
    dateFilterColumn,
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
    agingAsOf,
    viewCallTypesParam,
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
          const exportQuery = {
            officeId: summaryOfficeIdsParam,
            callType: viewCallTypesParam,
            startDate: startDateStr,
            endDate: endDateStr,
            dateFilterColumn,
            search: debouncedSearch || undefined,
            pincode: debouncedPincodeSearch || undefined,
            state: joinFilterParam(selectedState),
            city: joinFilterParam(selectedCity),
            region: joinFilterParam(selectedRegion),
            account: joinFilterParam(selectedAccount),
            branch: joinFilterParam(selectedBranch),
            franchisee: joinFilterParam(selectedFranchisee),
            technician: joinFilterParam(selectedTechnician),
            status: joinFilterParam(selectedStatus),
            priority: joinFilterParam(priorityFilter),
            portalFilter: joinFilterParam(portalFilter),
          };

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
              exportStartedAtRef.current = Date.now();
              onProgress({ fetched: 0, total });
              const prepared = await prepareRegisterCsvFromServer({
                query: exportQuery,
                knownTotal: total,
                signal,
                onProgress: (progress) => {
                  const { fetched, total: exportTotal, detail } = progress;
                  const elapsed = (Date.now() - exportStartedAtRef.current) / 1000;
                  const rate = fetched > 0 && elapsed >= 0.5 ? fetched / elapsed : 0;
                  const etaSeconds =
                    detail || rate <= 0 || exportTotal <= fetched
                      ? undefined
                      : Math.max(1, Math.ceil((exportTotal - fetched) / rate));
                  onProgress({ fetched, total: exportTotal, etaSeconds, detail });
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
            const { prepareRegisterCsvExport } = await import('@/lib/register/server/csv-export');
            return prepareRegisterCsvExport(
              exportData,
              `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`
            );
          }

          const { prepareRegisterExcelFromRows } = await import('@/lib/register/excel-export');
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
          '@/lib/report/bd-mis-excel-export'
        );
        const { workbookToPreparedExport } = await import('@/lib/report/summary-excel-export');
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
        } = await import('@/lib/report/summary-excel-export');
        const workbook = await buildSummaryDashboardWorkbook(summaryData);
        return workbookToPreparedExport(workbook, fileName);
      }

      if (sourceTab === 'accounts') {
        const {
          buildKeyAccountMisWorkbook,
          workbookToPreparedExport,
        } = await import('@/lib/report/summary-excel-export');
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
          exportRows as import('@/lib/report/summary-derive').AccountSummaryRow[],
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
            const hint =
              sourceTab === 'register' && !message.includes('date range')
                ? ' Try narrowing the date range and export again.'
                : '';
            feedback.actionFailed(`Failed to export: ${message}${hint}`);
            throw err instanceof Error ? err : new Error(message);
          }
        },
        { sourceTab, kind: 'standard' }
      );
    },
    [activeTab, enqueueExport, executeExport]
  );

  const totalPages = Math.ceil(total / limit);

  const localFilteredData = React.useMemo(() => {
    return data;
  }, [data]);

  const displayedData = localFilteredData;

  const liveStats = React.useMemo(() => {
    let total = 0;
    let solved = 0;
    let open = 0;
    let cancelled = 0;

    localFilteredData.forEach(row => {
      const isTransferred = (row.vtransfercallno && row.vtransfercallno !== '') || row.cancel_reason?.includes('Transfer');
      if (isTransferred) return;

      total++;
      const bucket = classifyRegisterRowStatus(row);
      if (bucket === 'transferred') return;

      if (bucket === 'cancelled') cancelled++;
      else if (bucket === 'closed' || bucket === 'techSolved') solved++;
      else open++;
    });

    return { total, solved, open, cancelled };
  }, [localFilteredData]);


  if (!mounted) {
    return <ReportPageSkeleton className="bg-bg-canvas" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg-canvas text-slate-900">
      {/* Page Header / Controls — h-14 matches sidebar header */}
      <div className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-bg-canvas px-4">
        <div className="flex items-center gap-6">
          <div className="flex">
            {misTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={`relative flex h-14 items-center px-3 text-xs font-medium transition-all ${activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600' }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefreshed && (
            <span
              className="text-[10px] text-slate-400 font-medium"
              title={`Last refreshed: ${lastRefreshed.toLocaleString()}`}
            >
              {formatRelativeTime(lastRefreshed)}
            </span>
          )}
          {filterUpdating && (
            <span className="text-[10px] font-medium text-blue-600 animate-pulse">
              Updating filters…
            </span>
          )}
          {(activeTab === 'summary' || activeTab === 'accounts' || activeTab === 'bd_mis_summary') &&
            (syncInProgress || corpusLoading || filterUpdating || summaryTabLoading || bdMisTabLoading) && (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              title="Updating summary…"
            />
          )}
          <button
            onClick={() => {
              const t0 = performance.now();
              reportPerf('ui', 'Sync button → fetchDelta()', t0, {
                why: 'Incremental lastSync poll; see fetchDelta logs.',
              });
              fetchDelta();
            }}
            disabled={syncInProgress}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-bg-canvas text-slate-700 shadow-sm transition-all hover:bg-bg-soft disabled:opacity-50"
            title="Refresh report data"
          >
            <div className={`${syncInProgress ? 'animate-spin' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
            </div>
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 bg-bg-canvas text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-bg-soft transition-all shadow-sm"
            title={
              activeTab === 'bd_mis_summary'
                ? 'Export audit workbook — how regional counts were built'
                : total > 500
                  ? 'Export filtered register (large datasets download as CSV from server)'
                  : 'Export filtered register to Excel (.xlsx)'
            }
          >
            <FileSpreadsheet
              size={14}
              className={
                isCurrentTabExcelExporting ? 'animate-pulse text-amber-600' : 'text-emerald-600'
              }
            />
            {isCurrentTabExcelExporting ? 'Exporting…' : 'Export Excel'}
          </button>
          {activeTab === 'summary' || activeTab === 'bd_mis_summary' ? (
            <button
              type="button"
              onClick={() => handleBdMisTraceExport()}
              className="flex items-center gap-2 bg-bg-canvas text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-bg-soft transition-all shadow-sm"
              title="Export summary dashboard + full row-by-row trace (CRM, Cadbury, Coke)"
            >
              <FileSpreadsheet
                size={14}
                className={
                  isCurrentTabTraceExporting ? 'animate-pulse text-amber-600' : 'text-blue-600'
                }
              />
              {isCurrentTabTraceExporting ? 'Trace export…' : 'Export Trace'}
            </button>
          ) : null}
          <ReportExportQueuePanel
            items={exportQueueItems}
            onClearFinished={clearFinishedExports}
            onCancelItem={(id) => {
              cancelExportJob(id);
              feedback.cancelled('Export cancelled');
            }}
          />
        </div>
      </div>

      {reportBanner ? (
        <PageAlert
          variant={reportBanner.variant}
          message={reportBanner.message}
          onDismiss={clearReportBanner}
        />
      ) : null}

      {activeTab === 'register' && !orientationDismissed ? (
        <ReportOrientationBanner
          userName={userProfile?.name}
          added={refreshDelta?.added}
          updated={refreshDelta?.updated}
          onDismiss={() => {
            setOrientationDismissed(true);
            sessionStorage.setItem('report-orientation-dismissed', '1');
            clearRefreshDelta();
          }}
        />
      ) : null}

      {/* Control Bar */}
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
      ) : (
        <>
          <div className="report-toolbar-filters-row report-shared-filters-surface border-b border-slate-200 bg-bg-canvas px-4 py-2">
            <RegisterMultiSelect
              label="Call Type"
              emptyLabel="All Call Types"
              options={callTypeOptions}
              selected={selectedCallTypes}
              onChange={setSelectedCallTypes}
              applyMode="confirm"
              layout="inline"
              searchable
              panelClassName="w-64"
            />
            <RegisterBranchFranchiseeFilters applyMode="confirm" layout="inline" />
            <div className="report-toolbar-filters-date report-shared-date-field shrink-0">
              <DateRangeSelector
                value={dateRange.label}
                startDate={dateRange.start}
                endDate={dateRange.end}
                onChange={(range) => setDateRange(range)}
              />
            </div>
            <div className="report-toolbar-filters-aging report-shared-aging-group flex shrink-0 items-center gap-2">
              <span className="report-shared-aging-label text-[10px] whitespace-nowrap text-amber-600 ui-label">Aging As Of</span>
              <input
                type="date"
                className="register-filter-select report-shared-aging-input h-8 w-auto bg-amber-50/80 text-amber-900"
                value={agingAsOf}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setAgingAsOf(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleApplySummaryFilters}
              disabled={summaryTabLoading || bdMisTabLoading}
              aria-busy={summaryTabLoading || bdMisTabLoading}
          className={`filter-apply-btn report-shared-apply-btn ${
                summaryTabLoading || bdMisTabLoading
                  ? 'border border-blue-300 bg-blue-50 text-blue-800'
                  : hasPendingFilterChanges
                    ? 'filter-apply-btn--pending'
                    : ''
              }`}
            >
              {summaryTabLoading || bdMisTabLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Filter className="h-3.5 w-3.5" aria-hidden />
              )}
              {summaryTabLoading || bdMisTabLoading ? 'Applying…' : 'Apply filters'}
            </button>
            {(activeTab === 'summary' || activeTab === 'accounts' || activeTab === 'bd_mis_summary') &&
              (clientImportActiveSources.length > 0 ||
                sourceSelection.clientSourceCodes.includes('cadbury')) && (
                <div className="report-toolbar-filters-sources report-shared-sources-group shrink-0 border-l border-slate-200 pl-2 flex flex-wrap items-center gap-2">
                  <MisSourceCheckboxes
                    selection={sourceSelection}
                    activeSources={clientImportActiveSources}
                    onChange={(selection) => {
                      saveMisSourceSelection(selection);
                      setSourceSelection(selection);
                    }}
                    mergePrefs={clientMergeWithCrm}
                    onMergePrefsChange={(prefs) => {
                      setClientMergeWithCrm(prefs);
                      saveClientMergeWithCrmPrefs(prefs);
                    }}
                  />
                </div>
              )}
          </div>
        </>
      )}

      {/* Main Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-canvas">
        <style jsx global>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(333%); }
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 0px;
            height: 0px;
            display: none;
          }
          .custom-scrollbar {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .inner-scrollbar::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .inner-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .inner-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 10px;
          }
          .inner-scrollbar:hover::-webkit-scrollbar-thumb {
            background: #94a3b8;
          }
        `}</style>

        {activeTab === 'register' ? (
          <ReportErrorBoundary label="Call Register">
          <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
            {loading && data.length === 0 ? (
              <ReportLoadingPanel label="Loading call register…" className="flex-1" />
            ) : (
              <>
            <div className="register-table-meta">
              <span className="text-[11px] font-medium text-slate-700">
                {total.toLocaleString()} {total === 1 ? 'call' : 'calls'}
              </span>
              <RegisterColumnPicker
                visibleColumns={visibleRegisterColumns}
                onChange={setVisibleRegisterColumns}
              />
            </div>
            <HorizontalScrollFade
              className="min-h-0 min-w-0 flex-1"
              scrollClassName="register-table-wrap inner-scrollbar"
            >
              <table className="register-table">
              <colgroup>
                <col className="register-col-num" />
                <col className="register-col-id" />
              </colgroup>
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-bg-soft">
                <tr>
                  <th className="register-table-sticky-col register-table-sticky-col-1 border-r border-slate-100 px-2 py-2.5 text-center text-[11px] font-medium whitespace-nowrap text-slate-500">#</th>
                  {visibleRegisterColumnDefs.map((col, colIdx) => (
                    <th
                      key={col.key}
                      className={`border-r border-slate-100 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap text-slate-500 ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-bg-canvas">
                {displayedData.length > 0 ? displayedData.map((row, idx) => (
                  <tr key={idx} className="transition-colors hover:bg-bg-soft">
                    <td className="register-table-sticky-col register-table-sticky-col-1 whitespace-nowrap border-r border-slate-50 px-2 py-2 text-center text-[11px] text-slate-400">
                      {(page - 1) * limit + idx + 1}
                    </td>
                    {visibleRegisterColumnDefs.map((col, colIdx) => (
                      <td
                        key={col.key}
                        className={`${getRegisterCellClassName(col.key)} ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                      >
                        {renderRegisterCell(col.key, row)}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={visibleRegisterColumnDefs.length + 1} className="register-table-empty">
                      <p className="text-sm font-medium text-slate-700">No calls match your filters</p>
                      {isAnyRegisterFilterActive && (
                        <button
                          type="button"
                          onClick={() => {
                            clearAllFilters();
                            void runRegisterFilterLoad({ force: true });
                          }}
                          className="mt-3 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-bg-soft"
                        >
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </HorizontalScrollFade>
          {/* Pagination Controls */}
          <div className="flex h-11 flex-shrink-0 items-center justify-between border-t border-slate-200 bg-bg-soft px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span className="font-medium text-slate-700">
                {total > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} of {total.toLocaleString()}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Rows</span>
                <select
                  value={limit}
                  onChange={(e) => handleRegisterPageSizeChange(Number(e.target.value))}
                  disabled={loading && data.length === 0}
                  className="rounded border border-slate-200 bg-bg-canvas px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-sm hover:border-slate-300 focus:border-slate-400 focus:outline-none disabled:opacity-50"
                  aria-label="Rows per page"
                >
                  {REGISTER_PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const newPage = Math.max(1, page - 1);
                  setPage(newPage);
                  fetchData(newPage);
                }}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft disabled:opacity-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              
              <div className="flex items-center gap-1 mx-2">
                {(() => {
                  const totalPages = Math.max(1, Math.ceil(total / limit));
                  const pages = [];
                  const windowSize = 2;

                  pages.push(1);
                  if (page > windowSize + 2) pages.push('...');
                  
                  const start = Math.max(2, page - windowSize);
                  const end = Math.min(totalPages - 1, page + windowSize);
                  for (let p = start; p <= end; p++) {
                    pages.push(p);
                  }
                  
                  if (page < totalPages - (windowSize + 1)) pages.push('...');
                  if (totalPages > 1) pages.push(totalPages);

                  return pages.map((p, idx) => {
                    if (p === '...') return <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 text-[12px]">...</span>;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setPage(p as number);
                          fetchData(p as number);
                        }}
                        className={`w-8 h-8 flex items-center justify-center rounded text-[12px] transition-all font-medium ${page === p ? 'bg-slate-900 text-white shadow-sm' : 'bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft'}`}
                      >
                        {p}
                      </button>
                    );
                  });
                })()}
              </div>

              {loading && (
                <span className="inline-block w-3 h-3 border-2 border-slate-600 border-t-transparent rounded-full animate-spin ml-2" />
              )}
              
              <button
                onClick={() => {
                  const totalPages = Math.max(1, Math.ceil(total / limit));
                  const newPage = Math.min(totalPages, page + 1);
                  setPage(newPage);
                  fetchData(newPage);
                }}
                disabled={page >= Math.ceil(total / limit) || loading}
                className="p-1.5 rounded bg-bg-canvas border border-slate-200 text-slate-600 hover:bg-bg-soft disabled:opacity-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
              </>
            )}
        </div>
          </ReportErrorBoundary>
        ) : activeTab === 'summary' ? (
          <ReportErrorBoundary label="Summary Dashboard">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-soft/10 inner-scrollbar">
            {summaryTabLoading ? (
              <div
                className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
                aria-hidden
              />
            ) : null}
            <div className="flex flex-col gap-3 p-4 pb-8">
              {/* Region Summary Table — fixed compact block, always visible */}
              <section>
                <h2 className="mb-2 px-2 text-[11px] text-slate-500 ui-label">Regional Performance (AI)</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-bg-canvas shadow-sm">
                  <table className="perf-dashboard-table w-full text-left border-collapse text-[11px]">
                    <thead className="perf-table-header">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30">Region</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'≤2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'3-7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'8-15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {useBdMisExcelUnion
                        ? excelUnionRegionalRows.map((row) => (
                            <tr
                              key={row.region}
                              className={`${regionPerfRowClass(row.region)} text-slate-900 ui-strong`}
                            >
                              <td className="p-2 border border-slate-300">{row.region}</td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('total_calls', `${row.region} - Total Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {displayLoggedCallCount(
                                  row.total_calls,
                                  row.cancelled_calls,
                                  false
                                ).toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums text-emerald-600 cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('solved_calls', `${row.region} - Solved Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.total_solved.toLocaleString()}
                              </td>
                              <td className="p-2 border border-slate-300 text-center tabular-nums text-rose-600">
                                {row.cancelled_calls.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums perf-metric-open ui-strong cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('open_calls', `${row.region} - Open Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.open_calls.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_2', `${row.region} - <2 Days`, { region: row.region })
                                }
                              >
                                {row.age_2.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_3', `${row.region} - 2-7 Days`, { region: row.region })
                                }
                              >
                                {row.age_3.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_7', `${row.region} - 7-15 Days`, { region: row.region })
                                }
                              >
                                {row.age_7.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_15', `${row.region} - >15 Days`, { region: row.region })
                                }
                              >
                                {row.age_15.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('part_pending', `${row.region} - Part Pending`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.part_pending.toLocaleString()}
                              </td>
                              <td className="p-2 border border-slate-300 text-center tabular-nums">
                                {row.active_eng.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        : clientOnlyMode
                        ? buildClientOnlyRegionalRows(clientAccountSummaryData).map((row) => {
                            const open = row.open_calls;
                            return (
                              <tr
                                key={row.region}
                                className={`${regionPerfRowClass(row.region)} text-slate-900 ui-strong`}
                              >
                                <td className="p-2 border border-slate-300">{row.region}</td>
                                <td className="p-2 border border-slate-300 text-center tabular-nums">
                                  {displayLoggedCallCount(
                                  row.total_calls,
                                  row.cancelled_calls,
                                  false
                                ).toLocaleString()}
                                </td>
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.total_solved} className="text-emerald-600" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.cancelled_calls} className="text-rose-600" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={open} className="perf-metric-open ui-strong" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_2} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_3} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_7} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_15} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.part_pending} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.active_eng} />
                              </tr>
                            );
                          })
                        : Array.from(
                            new Set(
                              (alignCrmToAccounts ? mergedAccountRowsForTotals : summaryData).map((b) => b.region)
                            )
                          )
                            .sort()
                            .map((region) => {
                        const totals = alignCrmToAccounts
                          ? rollupCrmAccountsByRegion(accountsData, region)
                          : summaryData
                              .filter((b) => b.region === region)
                              .reduce(
                                (acc, b) => ({
                                  total: acc.total + Number(b.total_calls || 0),
                                  solved: acc.solved + Number(b.solved_calls || 0),
                                  cancelled: acc.cancelled + Number(b.cancelled_calls || 0),
                                  open: acc.open + Number(b.open_calls || 0),
                                  age2: acc.age2 + Number(b.age_2 || 0),
                                  age3: acc.age3 + Number(b.age_3 || 0),
                                  age7: acc.age7 + Number(b.age_7 || 0),
                                  age15: acc.age15 + Number(b.age_15 || 0),
                                  parts: acc.parts + Number(b.part_pending || 0),
                                  engs: acc.engs + Number(b.active_eng || 0),
                                }),
                                {
                                  total: 0,
                                  solved: 0,
                                  cancelled: 0,
                                  open: 0,
                                  age2: 0,
                                  age3: 0,
                                  age7: 0,
                                  age15: 0,
                                  parts: 0,
                                  engs: 0,
                                }
                              );

                        const crmTotal = alignCrmToAccounts ? totals.total_calls : totals.total;
                        const crmSolved = alignCrmToAccounts ? totals.total_solved : totals.solved;
                        const crmCancelled = alignCrmToAccounts ? totals.cancelled_calls : totals.cancelled;
                        const crmOpen = alignCrmToAccounts ? totals.open_calls : totals.open;
                        const crmAge2 = alignCrmToAccounts ? totals.age_2 : totals.age2;
                        const crmAge3 = alignCrmToAccounts ? totals.age_3 : totals.age3;
                        const crmAge7 = alignCrmToAccounts ? totals.age_7 : totals.age7;
                        const crmAge15 = alignCrmToAccounts ? totals.age_15 : totals.age15;
                        const crmParts = alignCrmToAccounts ? totals.part_pending : totals.parts;
                        const crmEngs = alignCrmToAccounts ? totals.active_eng : totals.engs;

                        const clientField = (field: string) =>
                          mergeFlags.client
                            ? alignCrmToAccounts
                              ? sumAccountMetricByRegion(clientAccountSummaryData, region, field)
                              : findBranchMetric(clientSummaryData, region, field)
                            : 0;

                        const mTotal = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'total_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmTotal,
                          clientField('total_calls')
                        );
                        const mSolved = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          alignCrmToAccounts ? 'total_solved' : 'solved_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmSolved,
                          clientField(alignCrmToAccounts ? 'total_solved' : 'solved_calls')
                        );
                        const mCancelled = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'cancelled_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmCancelled,
                          clientField('cancelled_calls')
                        );
                        const mOpen = resolveSummaryRegionOpenCalls(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          mergeFlags,
                          clientMergeWithCrm,
                          crmOpen,
                          alignCrmToAccounts
                            ? clientField('age_2') +
                                clientField('age_3') +
                                clientField('age_7') +
                                clientField('age_15')
                            : clientField('open_calls')
                        );
                        const mAge2 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_2',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge2,
                          clientField('age_2')
                        );
                        const mAge3 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_3',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge3,
                          clientField('age_3')
                        );
                        const mAge7 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_7',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge7,
                          clientField('age_7')
                        );
                        const mAge15 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_15',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge15,
                          clientField('age_15')
                        );
                        const mParts = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'part_pending',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmParts,
                          clientField('part_pending')
                        );
                        const mEngs = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'active_eng',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmEngs,
                          clientField('active_eng')
                        );

                        return (
                          <tr key={region} className={`${regionPerfRowClass(region)} text-slate-900 ui-strong`}>
                            <td className="p-2 border border-slate-300">{region}</td>
                            <td
                              className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                              onClick={() => handleDrillDown('total_calls', `${region} - Total Calls`, { region })}
                            >
                              {displayLoggedCallCount(
                                mergeSelectedMetrics(mTotal.crm, mTotal.client, mTotal.mergeSelection),
                                mergeSelectedMetrics(
                                  mCancelled.crm,
                                  mCancelled.client,
                                  mCancelled.mergeSelection
                                ),
                                clientOnlyMode
                              ).toLocaleString()}
                            </td>
                            <SummaryMergedMetricCell {...mSolved} className="text-emerald-600" onClick={() => handleDrillDown('solved_calls', `${region} - Solved Calls`, { region })} />
                            <SummaryMergedMetricCell {...mCancelled} className="text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${region} - Cancelled Calls`, { region })} />
                            <SummaryMergedMetricCell {...mOpen} className="perf-metric-open ui-strong" onClick={() => handleDrillDown('open_calls', `${region} - Open Calls`, { region })} />
                            <SummaryMergedMetricCell {...mAge2} onClick={() => handleDrillDown('age_2', `${region} - <2 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge3} onClick={() => handleDrillDown('age_3', `${region} - 2-7 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge7} onClick={() => handleDrillDown('age_7', `${region} - 7-15 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge15} onClick={() => handleDrillDown('age_15', `${region} - >15 Days`, { region })} />
                            <SummaryMergedMetricCell {...mParts} onClick={() => handleDrillDown('part_pending', `${region} - Part Pending`, { region })} />
                            <SummaryMergedMetricCell {...mEngs} />
                          </tr>
                        );
                      })}
                      {/* All India Total Row */}
                      <tr className="perf-total-row text-slate-900 group ui-strong">
                        <td className="p-2 border border-slate-300 flex items-center justify-between">
                          <span>AI</span>
                          <button
                            onClick={() => handleDrillDown('discrepancy', 'AI - Discrepancy Records', { region: 'AI' })}
                            className="p-1 hover:bg-black/10 rounded transition-colors"
                            title="View records handled by multiple branches"
                          >
                            <AlertCircle className="w-3 h-3 text-slate-700" />
                          </button>
                        </td>
                        <td className="p-2 border border-slate-300 text-center tabular-nums">
                          {(
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'total_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : mergeFlags.client
                                ? displayLoggedCallCount(
                                    mergeSelectedMetrics(
                                      sumBranchLoggedCalls(summaryData),
                                      sumBranchMetric(clientSummaryData, 'total_calls'),
                                      mergeFlags
                                    ),
                                    mergeSelectedMetrics(
                                      summaryData.reduce(
                                        (sum, b) => sum + Number(b.cancelled_calls || 0),
                                        0
                                      ),
                                      mergeFlags.client
                                        ? sumBranchMetric(clientSummaryData, 'cancelled_calls')
                                        : 0,
                                      mergeFlags
                                    ),
                                    false
                                  )
                                : sumBranchLoggedCalls(summaryData)
                          ).toLocaleString()}
                        </td>
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'total_solved',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'solved_calls')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'cancelled_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'cancelled_calls')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountOpenCalls(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'open_calls')
                                : 0
                          }
                          className="bg-slate-800/20"
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_2',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_2')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_3',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_3')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_7',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_7')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_15',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_15')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'part_pending',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'part_pending')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'active_eng',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'active_eng')
                                : 0
                          }
                        />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Branch table — full height via page scroll */}
              <section className="flex flex-col">
                <h2 className="mb-2 flex-shrink-0 px-2 text-[11px] text-slate-500 ui-label">Branch Wise Performance</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-bg-canvas shadow-sm inner-scrollbar">
                  <table className="perf-dashboard-table w-full text-left border-collapse text-[11px]">
                    <thead className="perf-table-header sticky top-0 z-20 shadow-sm">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30 min-w-[200px]">Branches</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'≤2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'3-7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'8-15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientOnlyMode ? (
                        clientSummaryData.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="p-4 text-center text-[10px] text-slate-500">
                              No client branch data for selected sources.
                            </td>
                          </tr>
                        ) : (
                          clientSummaryData.map((branch, idx) => (
                            <tr key={idx} className="hover:bg-bg-soft text-slate-900">
                              <td className="p-2 border border-slate-300">
                                {String(branch.branch ?? branch.region ?? '')}
                              </td>
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.total_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.solved_calls ?? branch.total_solved ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.cancelled_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.open_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_2 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_3 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_7 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_15 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.part_pending ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.active_eng ?? 0)} />
                            </tr>
                          ))
                        )
                      ) : !mergeFlags.crm ? (
                        <tr>
                          <td colSpan={11} className="p-4 text-center text-[10px] text-slate-500">
                            CRM branch data hidden — enable CRM under Data sources.
                          </td>
                        </tr>
                      ) : (
                      Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        if (regionBranches.length === 0) return null;

                        const topLevel = regionBranches.filter(b =>
                          b.parentId === 0 || !regionBranches.find(p => p.officeId === b.parentId)
                        ).sort((a, b) => Number(b.total_calls) - Number(a.total_calls));

                        const bgClass = regionPerfRowClass(region);

                        return (
                          <React.Fragment key={region}>
                            {topLevel.map(branch => {
                              const children = regionBranches.filter(b => b.parentId === branch.officeId);
                              const hasChildren = children.length > 0;
                              const isExpanded = expandedBranches[branch.officeId];

                              const getAggregate = (item: any, key: string) => {
                                const getAllChildren = (id: number): any[] => {
                                  let direct = regionBranches.filter(b => b.parentId === id);
                                  let all = [...direct];
                                  direct.forEach(d => {
                                    all = [...all, ...getAllChildren(d.officeId)];
                                  });
                                  return all;
                                };
                                const allDescendants = getAllChildren(item.officeId);
                                return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
                              };

                              return (
                                <React.Fragment key={branch.officeId}>
                                  <tr className={`${bgClass} transition-colors font-medium text-slate-900`}>
                                    <td className="p-2 border border-slate-300">
                                      <div className="flex items-center gap-1">
                                        {hasChildren ? (
                                          <button
                                            onClick={() => setExpandedBranches(prev => ({ ...prev, [branch.officeId]: !prev[branch.officeId] }))}
                                            className="p-0.5 hover:bg-bg-canvas/50 rounded transition-all text-slate-700"
                                          >
                                            {isExpanded ? <ChevronDown size={12} strokeWidth={3} /> : <ChevronRight size={12} strokeWidth={3} />}
                                          </button>
                                        ) : (
                                          <div className="w-4" />
                                        )}
                                        <span className="truncate">{branch.branch}</span>
                                      </div>
                                    </td>
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'total_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'total_calls')} onClick={() => handleDrillDown('total_calls', `${branch.branch} - Total Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'solved_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'solved_calls')} onClick={() => handleDrillDown('solved_calls', `${branch.branch} - Solved Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'cancelled_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'cancelled_calls')} className="text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${branch.branch} - Cancelled Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'open_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'open_calls')} className="ui-strong" onClick={() => handleDrillDown('open_calls', `${branch.branch} - Open Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_2')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_2')} onClick={() => handleDrillDown('age_2', `${branch.branch} - <2 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_3')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_3')} onClick={() => handleDrillDown('age_3', `${branch.branch} - 2-7 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_7')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_7')} onClick={() => handleDrillDown('age_7', `${branch.branch} - 7-15 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_15')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_15')} onClick={() => handleDrillDown('age_15', `${branch.branch} - >15 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'part_pending')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'part_pending')} onClick={() => handleDrillDown('part_pending', `${branch.branch} - Part Pending`, { officeId: branch.officeId })} />
                                    <td className="p-2 border border-slate-300 text-center">
                                      <div className="flex flex-col items-center justify-center leading-tight">
                                        <span className="text-blue-700 ui-strong">{getAggregate(branch, 'active_eng')}</span>
                                        <span className="text-[9px] text-slate-400 font-medium">of {getAggregate(branch, 'headcount')}</span>
                                      </div>
                                    </td>
                                  </tr>

                                  {isExpanded && children.map(child => (
                                    <tr key={child.officeId} className="bg-bg-canvas/60 hover:bg-bg-canvas transition-colors text-slate-600 italic">
                                      <td className="p-1.5 pl-8 border border-slate-300">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{child.branch}</span>
                                        </div>
                                      </td>
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.total_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'total_calls')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('total_calls', `${child.branch} - Total Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.solved_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'solved_calls')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('solved_calls', `${child.branch} - Solved Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.cancelled_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'cancelled_calls')} className="p-1.5 text-[10px] text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${child.branch} - Cancelled Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.open_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'open_calls')} className="p-1.5 text-[10px] ui-label" onClick={() => handleDrillDown('open_calls', `${child.branch} - Open Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_2)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_2')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_2', `${child.branch} - <2 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_3)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_3')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_3', `${child.branch} - 2-7 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_7)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_7')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_7', `${child.branch} - 7-15 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_15)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_15')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_15', `${child.branch} - >15 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.part_pending)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'part_pending')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('part_pending', `${child.branch} - Part Pending`, { officeId: child.officeId })} />
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">
                                        <span className="text-blue-600 ui-strong">{child.active_eng}</span>
                                        <span className="text-slate-400 ml-1">/ {child.headcount}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
          </ReportErrorBoundary>
        ) : activeTab === 'accounts' ? (
          <ReportErrorBoundary label="Key Account MIS">
            <div className="relative flex-1 flex flex-col min-h-0 p-6 space-y-4 bg-bg-soft/10">
              {summaryTabLoading ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
                  aria-hidden
                />
              ) : null}
              {(() => {
                const displayAccounts = mergedAccountRowsForTotals;
                const filteredAccounts = displayAccounts.filter((a) => {
                  const matchRegion = matchesRegionFilter(filterRegion, String(a.region ?? ''));
                  const matchAccount = matchesAccountFilter(filterAccount, String(a.account ?? ''));
                  return matchRegion && matchAccount;
                });
                const tableAccounts = resolveAccountMisTableRows(
                  filteredAccounts,
                  accountMisGrouping,
                  accountMisTopN,
                  clientAccountSummaryData,
                  mergeFlags,
                  clientMergeWithCrm,
                  accountMisZoneTopExclude
                );
                const filteredClientAccounts = filterClientAccountSummary(
                  clientAccountSummaryData,
                  filterRegion,
                  filterAccount
                );

                return (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2 mb-2 flex-shrink-0">
                      <h2 className="text-[11px] text-slate-500 ui-label">Key Account Wise Performance</h2>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {accountMisGrouping === 'zone-top' ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] text-slate-600">
                              <span className="ui-label">Top</span>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={accountMisTopN}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10);
                                  if (!Number.isFinite(n)) return;
                                  const clamped = Math.max(1, Math.min(100, n));
                                  setAccountMisTopN(clamped);
                                  localStorage.setItem('report_account_mis_top_n', String(clamped));
                                }}
                                className="w-10 rounded border border-slate-200 px-1 py-0.5 text-center text-[10px] ui-strong"
                              />
                              <span className="ui-label">per zone</span>
                            </label>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!showZoneTopExcludeDropdown) {
                                    setTempZoneTopExclude(accountMisZoneTopExclude);
                                  }
                                  setShowZoneTopExcludeDropdown(!showZoneTopExcludeDropdown);
                                }}
                                className="flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] text-slate-600 hover:border-slate-400 ui-label"
                              >
                                <span>
                                  Exclude
                                  {accountMisZoneTopExclude.length > 0
                                    ? ` (${accountMisZoneTopExclude.length})`
                                    : ''}
                                </span>
                                <ChevronDown size={10} />
                              </button>
                              {showZoneTopExcludeDropdown ? (
                                <>
                                  <div
                                    className="fixed inset-0 z-[60]"
                                    onClick={() => setShowZoneTopExcludeDropdown(false)}
                                  />
                                  <div className="absolute right-0 top-full mt-1 w-52 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden">
                                    <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                      <button
                                        type="button"
                                        onClick={() => setTempZoneTopExclude([])}
                                        className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong"
                                      >
                                        Clear
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAccountMisZoneTopExclude(tempZoneTopExclude);
                                          localStorage.setItem(
                                            'report_account_mis_zone_top_exclude',
                                            JSON.stringify(tempZoneTopExclude)
                                          );
                                          setShowZoneTopExcludeDropdown(false);
                                        }}
                                        className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong"
                                      >
                                        Done
                                      </button>
                                    </div>
                                    <p className="px-2 py-1 text-[9px] text-slate-500 border-b border-slate-100">
                                      Checked accounts are hidden from zone top ranking.
                                    </p>
                                    <div className="max-h-48 overflow-y-auto p-1">
                                      {Array.from(
                                        new Set(displayAccounts.map((a) => String(a.account ?? '')))
                                      )
                                        .sort()
                                        .map((acc) => (
                                          <label
                                            key={acc}
                                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempZoneTopExclude.some(
                                                (x) =>
                                                  x.trim().toLowerCase() === acc.trim().toLowerCase()
                                              )}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempZoneTopExclude([...tempZoneTopExclude, acc]);
                                                } else {
                                                  setTempZoneTopExclude(
                                                    tempZoneTopExclude.filter(
                                                      (x) =>
                                                        x.trim().toLowerCase() !==
                                                        acc.trim().toLowerCase()
                                                    )
                                                  );
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 ui-label">
                                              {acc}
                                            </span>
                                          </label>
                                        ))}
                                    </div>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                        <div
                          className="flex items-center gap-1.5"
                          role="group"
                          aria-labelledby="account-mis-layout-label"
                        >
                          <span
                            id="account-mis-layout-label"
                            className="text-[10px] font-normal text-slate-400 ui-label select-none cursor-default"
                          >
                            Layout:
                          </span>
                          <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-bg-soft/80 p-0.5 text-[10px]">
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'zone'}
                            onClick={() => {
                              setAccountMisGrouping('zone');
                              localStorage.setItem('report_account_mis_grouping', 'zone');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'zone'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Total Calls
                          </button>
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'zone-top'}
                            onClick={() => {
                              setAccountMisGrouping('zone-top');
                              localStorage.setItem('report_account_mis_grouping', 'zone-top');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'zone-top'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Top Client
                          </button>
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'overview'}
                            onClick={() => {
                              setAccountMisGrouping('overview');
                              localStorage.setItem('report_account_mis_grouping', 'overview');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'overview'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Client Wise
                          </button>
                          </div>
                        </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 bg-bg-canvas border border-slate-200 rounded-lg shadow-sm overflow-auto custom-scrollbar relative">
                      <table className="perf-account-mis-table w-full text-left border-collapse text-[10px]">
                        <thead className="sticky top-0 z-20 outline outline-1 outline-slate-800 shadow-sm">
                          {/* Category Headers */}
                          <tr className="account-mis-cat-header bg-slate-800 text-white ui-strong">
                            <th className="p-1.5 border-r border-slate-600/50" colSpan={accountMisGrouping === 'overview' ? 2 : 3}>Basics</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center" colSpan={4}>Calls Summary (Breakdown)</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center account-mis-cat-header--aging" colSpan={7}>Breakdown (Aging)</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center account-mis-cat-header--deploy" colSpan={3}>Deployment</th>
                            <th className="p-1.5 text-center account-mis-cat-header--install" colSpan={2}>Installation</th>
                          </tr>
                          <tr className="account-mis-col-header bg-slate-100 text-slate-700 ui-strong">
                            {accountMisGrouping !== 'overview' ? (
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1 relative">
                                <span>Region</span>
                                <button
                                  onClick={() => {
                                    if (!showRegionDropdown) {
                                      setTempFilterRegion(filterRegion);
                                    }
                                    setShowRegionDropdown(!showRegionDropdown);
                                  }}
                                  className="w-full bg-bg-canvas border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong"
                                >
                                  <span className="truncate">
                                    {filterRegion.length === 0 ? 'All' : `${filterRegion.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showRegionDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowRegionDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                      <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterRegion([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterRegion(tempFilterRegion);
                                            setShowRegionDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(displayAccounts.map(a => String(a.region ?? '')))).sort().map(r => (
                                          <label key={r} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterRegion.includes(r)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterRegion([...tempFilterRegion, r]);
                                                } else {
                                                  setTempFilterRegion(tempFilterRegion.filter(x => x !== r));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{r}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            ) : null}
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1 relative">
                                <span>Key Account</span>
                                <button
                                  onClick={() => {
                                    if (!showAccountDropdown) {
                                      setTempFilterAccount(filterAccount);
                                    }
                                    setShowAccountDropdown(!showAccountDropdown);
                                  }}
                                  className="w-full bg-bg-canvas border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong font-medium"
                                >
                                  <span className="truncate">
                                    {filterAccount.length === 0 ? 'All' : `${filterAccount.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showAccountDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowAccountDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100 font-medium">
                                      <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterAccount([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterAccount(tempFilterAccount);
                                            setShowAccountDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(displayAccounts.map(a => String(a.account ?? '')))).sort().map(acc => (
                                          <label key={acc} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterAccount.includes(acc)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterAccount([...tempFilterAccount, acc]);
                                                } else {
                                                  setTempFilterAccount(tempFilterAccount.filter(x => x !== acc));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{acc}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Population</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total calls</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total solved</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3 text-rose-700 font-semibold">Cancelled</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3"># open calls</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">&lt;2 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">2-7 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">7-15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">&gt;15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">% &gt;7 Days</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">Part pending</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong"># of active Eng.</th>

                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Total</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Pending</th>

                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong">Pending</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {tableAccounts.map((a, i) => {
                            const region = String(a.region ?? '');
                            const account = String(a.account ?? '');
                            const isOverview = accountMisGrouping === 'overview';
                            const rowMergeFlags = accountMergeFlags(account, mergeFlags, clientMergeWithCrm);
                            const drillRegion = isOverview ? 'AI' : region;
                            const clientMetric = (field: string) =>
                              isOverview
                                ? findAccountMetricByAccount(filteredClientAccounts, account, field)
                                : findAccountMetric(clientAccountSummaryData, region, account, field);
                            const crmOpenSum = Number(a.open_calls || 0);
                            const clientOpen = isOverview
                              ? accountOpenCallsFromAgingByAccount(filteredClientAccounts, account)
                              : accountOpenCallsFromAging(
                                  clientAccountSummaryData,
                                  region,
                                  account
                                );
                            const openDisplay = mergeSelectedMetrics(crmOpenSum, clientOpen, rowMergeFlags);
                            const mergedAge7 = mergeSelectedMetrics(
                              Number(a.age_7 || 0),
                              clientMetric('age_7'),
                              rowMergeFlags
                            );
                            const mergedAge15 = mergeSelectedMetrics(
                              Number(a.age_15 || 0),
                              clientMetric('age_15'),
                              rowMergeFlags
                            );
                            const perc_gt_7 =
                              openDisplay > 0
                                ? (((mergedAge7 + mergedAge15) / openDisplay) * 100).toFixed(0) + '%'
                                : '0%';
                            const dep_pending = Number(a.deployment_total || 0) - Number(a.deployment_done || 0);
                            const inst_pending = Number(a.installation_total || 0) - Number(a.installation_done || 0);

                            const regColor = isOverview
                              ? 'perf-region-cell perf-region-cell--default'
                              : regionPerfAccountCellClass(region);

                            return (
                              <tr key={i} className="hover:bg-bg-soft transition-colors text-slate-900 border-b border-slate-200">
                                {!isOverview ? (
                                  <td className={`p-1.5 border border-slate-300 ${regColor} ui-strong`}>{region}</td>
                                ) : null}
                                <td className="p-1.5 border border-slate-300 font-medium text-[9px] bg-bg-soft/30">{account}</td>
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.population || 0)}
                                  client={clientMetric('population')}
                                  className="p-1.5 text-slate-500 ui-strong"
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.total_calls || 0)}
                                  client={clientMetric('total_calls')}
                                  className="p-1.5"
                                  onClick={() => handleDrillDown('total_calls', `${account} - Total Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.total_solved || 0)}
                                  client={clientMetric('total_solved')}
                                  className="p-1.5 text-emerald-600"
                                  onClick={() => handleDrillDown('total_solved', `${account} - Solved Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.cancelled_calls || 0)}
                                  client={clientMetric('cancelled_calls')}
                                  className="p-1.5 text-rose-600"
                                  onClick={() => handleDrillDown('cancelled_calls', `${account} - Cancelled Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td
                                  className="p-1.5 border border-slate-300 text-center text-slate-900 perf-metric-open cursor-pointer hover:bg-black/5 ui-strong"
                                  onClick={() => handleDrillDown('open_calls', `${account} - Open Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                >
                                  {openDisplay.toLocaleString()}
                                </td>

                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_2 || 0)}
                                  client={clientMetric('age_2')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_2', `${account} - <2 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_3 || 0)}
                                  client={clientMetric('age_3')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_3', `${account} - 2-7 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_7 || 0)}
                                  client={clientMetric('age_7')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_7', `${account} - 7-15 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_15 || 0)}
                                  client={clientMetric('age_15')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_15', `${account} - >15 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td className="p-1.5 border border-slate-300 text-center text-blue-700 perf-metric-pct ui-strong">{perc_gt_7}</td>

                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.part_pending || 0)}
                                  client={clientMetric('part_pending')}
                                  className="p-1.5"
                                  onClick={() => handleDrillDown('part_pending', `${account} - Part Pending`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td className="p-1.5 border border-slate-300 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="text-blue-700 ui-strong">
                                      {mergeSelectedMetrics(
                                        Number(a.active_eng || 0),
                                        clientMetric('active_eng'),
                                        rowMergeFlags
                                      )}
                                    </span>
                                    <span className="text-[9px] text-slate-400 font-medium">({Number(a.headcount || 0)})</span>
                                  </div>
                                </td>

                                <td className="p-1.5 border border-slate-300 text-center perf-metric-deploy">{Number(a.deployment_total || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center perf-metric-deploy">{Number(a.deployment_done || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-amber-700 perf-metric-pending-deploy ui-strong">{dep_pending}</td>

                                <td className="p-1.5 border border-slate-300 text-center perf-metric-install">{Number(a.installation_done || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-700 perf-metric-pending-install ui-strong">{inst_pending}</td>
                              </tr>
                            );
                          })}

                          {/* Account Total Row */}
                          {(() => {
                            const kamisFiltersActive =
                              filterRegion.length > 0 || filterAccount.length > 0;
                            const useBranchGrandTotals =
                              mergeFlags.crm && !mergeFlags.client && !kamisFiltersActive;

                            const kamisGrandAccountRows = kamisFiltersActive
                              ? filteredAccounts
                              : mergedAccountRowsForTotals;

                            const totalPopulation = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.population || b.total_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'population',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalCalls = useBranchGrandTotals
                              ? sumBranchLoggedCalls(summaryData)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'total_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalSolved = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'total_solved',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalCancelled = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'cancelled_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalOpen = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)
                              : sumMergedAccountOpenCalls(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge2 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_2',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge3 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_3',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge7 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_7',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge15 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_15',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalParts = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'part_pending',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalEngs = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'active_eng',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalPercGt7 =
                              totalOpen > 0
                                ? (((totalAge7 + totalAge15) / totalOpen) * 100).toFixed(0) + '%'
                                : '0%';

                            return (
                          <tr className="account-mis-grand-total bg-slate-900 text-white text-[10px] ui-label">
                            <td className="p-1.5 border border-slate-700" colSpan={accountMisGrouping === 'overview' ? 1 : 2}>GRAND TOTAL (AI)</td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalPopulation.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('total_calls', `All India - Total Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalCalls.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('total_solved', `All India - Solved Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalSolved.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-rose-400 cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('cancelled_calls', `All India - Cancelled Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalCancelled.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center bg-slate-800 cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('open_calls', `All India - Open Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalOpen.toLocaleString()}
                            </td>

                            {/* Aging Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge2.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge3.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge7.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge15.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {totalPercGt7}
                            </td>

                            {/* Support Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalParts.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {totalEngs}
                              <span className="text-[9px] text-slate-400 ml-1">({globalHeadcount})</span>
                            </td>

                            {/* Deployment Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_total || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-amber-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.deployment_total || 0) - Number(a.deployment_done || 0)), 0).toLocaleString()}
                            </td>

                            {/* Installation Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.installation_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-emerald-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.installation_total || 0) - Number(a.installation_done || 0)), 0).toLocaleString()}
                            </td>
                          </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          </ReportErrorBoundary>
        ) : activeTab === 'bd_mis_summary' ? (
          <ReportErrorBoundary label="Cadbury+Coke+CRM Summary Dashboard">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-soft/10 inner-scrollbar">
              {bdMisTabLoading ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
                  aria-hidden
                />
              ) : null}
              <div className="flex flex-col gap-3 p-4 pb-8">
                <BdMisSummaryPanel
                  rows={bdMisRegionalRows}
                  grand={
                    bdMisGrand ?? {
                      region: 'ALL',
                      total_calls: 0,
                      total_solved: 0,
                      cancelled_calls: 0,
                      age_2: 0,
                      age_3: 0,
                      age_7: 0,
                      age_15: 0,
                      part_pending: 0,
                      active_eng: 0,
                      open_calls: 0,
                    }
                  }
                  loading={bdMisTabLoading}
                />
              </div>
            </div>
          </ReportErrorBoundary>
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
          ) : null}
      </div>


      {/* Engineer Popup */}
      {isDrawerOpen && selectedCall && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <div className="modal-backdrop fixed inset-0 animate-in fade-in duration-200" onClick={() => setIsDrawerOpen(false)} />
          <div className="relative bg-bg-canvas shadow rounded-lg w-full max-w-[900px] h-[min(760px,92vh)] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200">
            <CallDetail
              call={selectedCall}
              onClose={() => setIsDrawerOpen(false)}
              onFlagUpdate={handleFlagUpdate}
              onPostComment={handlePostComment}
            />
          </div>
        </div>
      )}

      {showEngPopup && (
        <div className="modal-backdrop modal-backdrop--soft fixed inset-0 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-bg-canvas rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-bg-soft/50">
              <div>
                <h3 className="text-sm text-slate-900 ui-label">Engineer List</h3>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">{showEngPopup}</p>
              </div>
              <button
                onClick={() => setShowEngPopup(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <ChevronLeft className="rotate-180" size={18} />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2">
              {fetchingEngs ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                  <p className="text-[10px] text-slate-400 ui-label">Fetching Names...</p>
                </div>
              ) : selectedBranchEngs.length > 0 ? (
                <div className="grid grid-cols-1 gap-1">
                  {selectedBranchEngs.map((name, i) => (
                    <div key={i} className="px-3 py-2 text-[11px] font-medium text-slate-700 bg-bg-soft/50 rounded-lg border border-slate-100/50 hover:border-slate-200 hover:bg-bg-canvas transition-all">
                      {name}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-[10px] text-slate-400 ui-label">
                  No engineers found
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-bg-soft border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowEngPopup(null)}
                className="px-4 py-1.5 bg-slate-900 text-white text-[10px] rounded-lg hover:bg-slate-800 transition-all ui-label"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill Down Side Panel */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[200] flex justify-end">
          <div className="modal-backdrop absolute inset-0 backdrop-blur-sm" onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} />
          <div className="relative w-full max-w-5xl bg-bg-canvas h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-bg-soft">
              <div>
                <h3 className="text-sm text-slate-900 ui-label">{drillDown.title}</h3>
                <p className="text-[10px] text-slate-500 font-medium">Detailed breakdown of selected metric</p>
              </div>
              <button onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] text-slate-700 flex items-center gap-2 ui-label">
                    Detail Records
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full text-[9px] ui-strong">{drillDown.data.length} Results</span>
                  </h4>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="sticky top-0 bg-bg-soft border-b border-slate-200 z-10">
                        <tr>
                          {drillDown.data.length > 0 && Object.keys(drillDown.data[0]).map(key => (
                            <th key={key} className="p-3 text-slate-500 border-r border-slate-100 whitespace-nowrap ui-strong">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drillDown.loading ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                                <p className="text-[10px] font-medium text-slate-400">Executing Query...</p>
                              </div>
                            </td>
                          </tr>
                        ) : drillDown.data.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <p className="text-xs font-medium text-slate-400">No data available for this metric</p>
                            </td>
                          </tr>
                        ) : (
                          drillDown.data.map((row, i) => {
                            const callId = row['Ref No'] || row['vtrnno'] || row['Ref. No'] || null;
                            return (
                              <tr 
                                key={i} 
                                className={`transition-colors group ${callId && callId !== '—' ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-bg-soft'}`}
                                onClick={() => {
                                  if (callId && callId !== '—') {
                                    handleSelectCall(callId);
                                  }
                                }}
                              >
                                {Object.values(row).map((val: any, j) => (
                                  <td key={j} className="p-3 border-r border-slate-50 whitespace-nowrap text-slate-600 group-hover:text-slate-900 font-medium truncate max-w-[200px]">
                                    {String(val || '—')}
                                  </td>
                                ))}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
