'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useReportFilters } from '@/modules/mis/components/ReportFiltersContext';
import {
  buildSummaryQueryKey,
  resolveSummaryOfficeIdsParam,
  resolveViewCallTypesParam,
} from '@/modules/mis/services/filters';
import {
  buildAccountDisplayRows,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  mergeFlagsFromSelection,
  type ClientMergeWithCrmPrefs,
} from '@/modules/mis/components/SummaryMergedMetricCell';
import { loadClientMergeWithCrmPrefs } from '@/modules/mis/components/MisClientMergeCheckbox';
import {
  isClientOnlyMode,
  loadMisSourceSelection,
  type MisSourceSelection,
} from '@/modules/mis/client-import';
import {
  globalReportCache,
} from '@/modules/mis/services/data-store';
import {
  reportPerf,
  type AccountMisGrouping,
} from '@/modules/mis/services/report-page-helpers';
import { useSummaryClientImport } from './useSummaryClientImport';
import { useSummaryFetch } from './useSummaryFetch';

interface UseSummaryTabStateProps {
  supabase: SupabaseClient;
  activeTab: string;
  misAccess: { summary: boolean; accounts: boolean };
}

export function useSummaryTabState({
  supabase: _supabase,
  activeTab,
  misAccess,
}: UseSummaryTabStateProps) {
  const {
    selectedBranch,
    selectedFranchisee,
    selectedCallTypes,
    selectedOfficeIds,
    dateRange,
    dateFilterColumn,
    agingAsOf,
    offices,
    getAppliedFiltersSnapshot,
    appliedRevision,
    ensureCorpusLoaded,
  } = useReportFilters();

  const [summaryData, setSummaryData] = useState<any[]>(globalReportCache?.summaryData || []);
  const [clientSummaryData, setClientSummaryData] = useState<any[]>([]);
  const [clientAccountSummaryData, setClientAccountSummaryData] = useState<any[]>([]);
  const [accountsData, setAccountsData] = useState<any[]>(globalReportCache?.accountsData || []);
  const [globalHeadcount, setGlobalHeadcount] = useState<number>(globalReportCache?.globalHeadcount || 0);
  const [summaryTabLoading, setSummaryTabLoading] = useState(false);
  const [clientImportActiveSources, setClientImportActiveSources] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [sourceSelection, setSourceSelection] = useState<MisSourceSelection>(() =>
    loadMisSourceSelection()
  );
  const [clientMergeWithCrm, setClientMergeWithCrm] = useState<ClientMergeWithCrmPrefs>(
    loadClientMergeWithCrmPrefs
  );
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});

  // Accounts tab filters & configurations
  const [filterRegion, setFilterRegion] = useState<string[]>(globalReportCache?.filterRegion || []);
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string[]>(
    Array.isArray(globalReportCache?.filterAccount) ? globalReportCache.filterAccount : []
  );
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

  // Refs for tracking async loadings & caching
  const summaryDataRef = useRef(summaryData);
  const accountsDataRef = useRef(accountsData);
  const globalHeadcountRef = useRef(globalHeadcount);
  const lastSummaryQueryKeyRef = useRef<string | null>(
    globalReportCache?.summaryQueryKey || null
  );

  const summaryTabLoadRef = useRef(0);
  const summaryFilterLoadInFlightRef = useRef(false);
  const summaryFilterLoadKeyRef = useRef<string | null>(null);

  const refreshClientImportOverlayRef = useRef<
    (scope: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >(async () => {});

  summaryDataRef.current = summaryData;
  accountsDataRef.current = accountsData;
  globalHeadcountRef.current = globalHeadcount;

  const mergeFlags = useMemo(() => mergeFlagsFromSelection(sourceSelection), [sourceSelection]);
  const sourceSelectionKey = useMemo(
    () => [...sourceSelection.clientSourceCodes].sort().join(','),
    [sourceSelection.clientSourceCodes]
  );
  const clientOnlyMode = isClientOnlyMode(sourceSelection);
  const alignCrmToAccounts = mergeFlags.crm && mergeFlags.client;
  const mergedAccountRowsForTotals = useMemo(
    () => buildAccountDisplayRows(accountsData, clientAccountSummaryData, mergeFlags),
    [accountsData, clientAccountSummaryData, mergeFlags]
  );

  const summaryExcelExportRef = useRef<{
    summaryData: typeof summaryData;
    clientSummaryData: typeof clientSummaryData;
    clientAccountSummaryData: typeof clientAccountSummaryData;
    mergedAccountRowsForTotals: ReturnType<typeof buildAccountDisplayRows>;
    mergeFlags: ReturnType<typeof mergeFlagsFromSelection>;
    clientMergeWithCrm: ClientMergeWithCrmPrefs;
    clientOnlyMode: boolean;
  } | null>(null);

  summaryExcelExportRef.current = {
    summaryData,
    clientSummaryData,
    clientAccountSummaryData,
    mergedAccountRowsForTotals,
    mergeFlags,
    clientMergeWithCrm,
    clientOnlyMode,
  };

  const summaryOfficeIdsParam = useMemo(
    () => resolveSummaryOfficeIdsParam(offices, selectedBranch, selectedFranchisee),
    [offices, selectedBranch, selectedFranchisee]
  );

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

  // Instantiate sub-hooks
  const {
    loadClientImportSources,
    loadClientImportSummaryPayload,
    fetchClientImportSummary,
    commitClientImportSummary,
  } = useSummaryClientImport({
    sourceSelection,
    setClientImportActiveSources,
    setClientSummaryData,
    setClientAccountSummaryData,
    summaryTabLoadRef,
    resolveClientImportScope: () => fetchHelper.resolveClientImportScope(),
    refreshClientImportOverlayRef,
  });

  const fetchHelper = useSummaryFetch({
    offices,
    selectedCallTypes,
    selectedOfficeIds,
    dateRange,
    dateFilterColumn,
    agingAsOf,
    getAppliedFiltersSnapshot,
    ensureCorpusLoaded,
    summaryOfficeIdsParam,
    viewCallTypesParam,
    lastSummaryQueryKeyRef,
    summaryTabLoadRef,
    summaryFilterLoadInFlightRef,
    summaryFilterLoadKeyRef,
    refreshClientImportOverlayRef,
    setSummaryData,
    setAccountsData,
    setGlobalHeadcount,
    summaryDataRef,
    accountsDataRef,
    loadClientImportSummaryPayload,
    commitClientImportSummary,
  });

  // Trigger loading when tab switches to summary/accounts
  useEffect(() => {
    const isSummaryActive = activeTab === 'summary' && misAccess.summary;
    const isAccountsActive = activeTab === 'accounts' && misAccess.accounts;
    const isBdActive = activeTab === 'bd_mis_summary';
    const isClientImportActive = activeTab === 'client_import';
    const needsFetch = isSummaryActive || isAccountsActive || isBdActive || isClientImportActive;

    if (!needsFetch) return;

    summaryTabLoadRef.current += 1;
    const currentGeneration = summaryTabLoadRef.current;

    const tStart = performance.now();
    reportPerf('tabSwitch', `switched to ${activeTab}`, tStart);

    const initSummary = async () => {
      setSummaryTabLoading(true);
      try {
        if (isClientImportActive || isSummaryActive || isAccountsActive) {
          await loadClientImportSources();
        }
        if (isSummaryActive || isAccountsActive) {
          await fetchHelper.runSummaryFilterLoad(currentGeneration);
        }
      } catch (err) {
        console.error('Failed to load summary dataset:', err);
      } finally {
        if (currentGeneration === summaryTabLoadRef.current) {
          setSummaryTabLoading(false);
        }
        reportPerf('tabSwitch', `${activeTab} loaded`, tStart);
      }
    };

    void initSummary();
  }, [activeTab, misAccess.summary, misAccess.accounts, appliedRevision, sourceSelectionKey, loadClientImportSources, fetchHelper.runSummaryFilterLoad]);

  return {
    summaryData,
    setSummaryData,
    summaryDataRef,
    accountsData,
    setAccountsData,
    accountsDataRef,
    globalHeadcount,
    setGlobalHeadcount,
    globalHeadcountRef,
    clientSummaryData,
    setClientSummaryData,
    clientAccountSummaryData,
    setClientAccountSummaryData,
    clientImportActiveSources,
    sourceSelection,
    setSourceSelection,
    clientMergeWithCrm,
    setClientMergeWithCrm,
    summaryTabLoading,
    setSummaryTabLoading,
    expandedBranches,
    setExpandedBranches,
    filterRegion,
    setFilterRegion,
    showRegionDropdown,
    setShowRegionDropdown,
    filterAccount,
    setFilterAccount,
    accountMisGrouping,
    setAccountMisGrouping,
    accountMisTopN,
    setAccountMisTopN,
    accountMisZoneTopExclude,
    setAccountMisZoneTopExclude,
    showZoneTopExcludeDropdown,
    setShowZoneTopExcludeDropdown,
    tempZoneTopExclude,
    setTempZoneTopExclude,
    showAccountDropdown,
    setShowAccountDropdown,
    tempFilterRegion,
    setTempFilterRegion,
    tempFilterAccount,
    setTempFilterAccount,
    mergeFlags,
    clientOnlyMode,
    alignCrmToAccounts,
    mergedAccountRowsForTotals,
    summaryExcelExportRef,
    resolveSummaryAgingStr: fetchHelper.resolveSummaryAgingStr,
    buildSummaryQueryKey,
    lastSummaryQueryKeyRef,
    refreshClientImportOverlayRef,
    applySummaryFromCorpus: fetchHelper.applySummaryFromCorpus,
    applySummaryFromSharedCalls: fetchHelper.applySummaryFromSharedCalls,
    runSummaryFilterLoad: fetchHelper.runSummaryFilterLoad,
    loadClientImportSources,
    fetchClientImportSummary,
    hydrateSummaryFromCache: fetchHelper.hydrateSummaryFromCache,
    resolveClientImportScope: fetchHelper.resolveClientImportScope,
  };
}
