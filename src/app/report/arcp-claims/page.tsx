'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ArcpClaimsTable } from '@/components/arcp-claims/ArcpClaimsTable';
import {
  ArcpClaimsSummaryPanel,
  type ArcpTableViewMode,
} from '@/components/arcp-claims/ArcpClaimsSummaryPanel';
import { ArcpClaimsToolbar } from '@/components/arcp-claims/ArcpClaimsToolbar';
import { ArcpClaimsHeaderActions } from '@/components/arcp-claims/ArcpClaimsHeaderActions';
import { ArcpClaimsMonthlyTable } from '@/components/arcp-claims/ArcpClaimsMonthlyTable';
import {
  ArcpClaimsLoadBanner,
  formatArcpDurationMs,
  formatArcpFinishTime,
  type ArcpLoadStatus,
  type ArcpRunningTotals,
} from '@/components/arcp-claims/ArcpClaimsLoadBanner';
import { ArcpClaimsPdfViewer } from '@/components/arcp-claims/ArcpClaimsPdfViewer';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  ARCP_DATE_FILTER_OPTIONS,
  ARCP_DEFAULT_DATE_FILTER_COLUMN,
  estimateArcpLoadPlan,
  resolveArcpClientLoadPlan,
  shouldUseClientSideArcpChunks,
  resolveArcpLoadConcurrency,
  resolveArcpClientDetailLoadPlan,
  arcpChunkPeriodLabel,
  deriveArcpGrandTotalsFromAggregates,
  ARCP_MERGE_ACROSS_CHUNKS,
  mergeArcpAggregateRows,
  mergeArcpChunkAggregateRows,
  mergeArcpDetailRows,
  type ArcpClaimsAggregateRow,
  type ArcpDateFilterColumn,
  type ArcpClaimsDetailRow,
  type ArcpLoadPlan,
} from '@/lib/arcp-claims/query';
import { runPool } from '@/lib/utils/run-pool';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';
import type { ArcpPostgresCoverage } from '@/lib/read-model/arcp/coverage-shared';
import { fetchReadModelStatus } from '@/lib/read-model/trigger-sync-client';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import {
  downloadArcpClaimsCsv,
  downloadArcpClaimsDetailCsv,
  prepareArcpDetailExportRows,
} from '@/lib/arcp-claims/export';
import {
  buildArcpClaimsPdfBlob,
  buildArcpClaimsPdfFileName,
} from '@/lib/arcp-claims/pdf';
import {
  applyArcpTallyDetailLevel,
  buildArcpClaimsMonthlyBreakdown,
  buildArcpClaimsTableModel,
  countArcpCategorySections,
  type ArcpTallyDetailLevel,
  type ArcpTallyGrouping,
} from '@/lib/arcp-claims/table';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  formatReportScopeSubtitle,
  isWideOrganizationScope,
  joinFilterParam,
  toDateString,
} from '@/lib/report/filters';
import {
  createChunkedFetchAuth,
  isChunkedFetchAbortError,
  isChunkedFetchAuthError,
  isChunkedFetchNetworkError,
} from '@/lib/supabase/chunked-fetch';
import { PageAlert } from '@/components/ui/PageAlert';
import { usePageAlert } from '@/hooks/usePageAlert';
import { feedback } from '@/lib/ui/feedback';
import { GlossaryTerm } from '@/components/ui/GlossaryTerm';
import {
  appliedArcpFiltersKey,
  filtersFromLoadJobSnapshot,
  type ArcpAppliedFiltersSnapshot,
} from '@/lib/arcp-claims/applied-filters';
import {
  enrichArcpAggregateLabelsClient,
  type ArcpClientLabelLookups,
} from '@/lib/arcp-claims/labels';

type AppliedArcpFilters = ArcpAppliedFiltersSnapshot;

type ArcpLoadJobChunkRow = {
  chunkStart: string;
  chunkEnd: string;
  status: 'pending' | 'done' | 'failed';
};

type ArcpLoadJobStartResponse = {
  jobsEnabled?: boolean;
  jobId: string | null;
  chunks: ArcpLoadJobChunkRow[];
  partialAggregates?: ArcpClaimsAggregateRow[];
  partialRows?: ArcpClaimsDetailRow[];
  progress?: {
    totalChunks: number;
    doneCount: number;
    pendingCount: number;
    failedCount: number;
    cachedCount: number;
  };
  error?: string;
};

type ArcpLoadJobStatusResponse = {
  jobId?: string;
  resumable?: boolean;
  status?: string;
  filters?: Record<string, unknown>;
  partialAggregates?: ArcpClaimsAggregateRow[];
  progress?: {
    totalChunks: number;
    doneCount: number;
    pendingCount: number;
    failedCount: number;
  };
  error?: string;
};

const ARCP_JOB_POLL_MS = 2500;
const ARCP_JOB_POLL_MAX_MS = 30_000;

function arcpChunkProgressLabel(plan: ArcpLoadPlan): string {
  return arcpChunkPeriodLabel(plan.chunkGranularity);
}

function arcpChunkLoadingHint(plan: ArcpLoadPlan): string {
  switch (plan.chunkGranularity) {
    case 'day':
      return 'loading next day';
    case 'week':
      return 'loading next week';
    case 'month':
      return 'loading next month';
    default:
      return 'loading next period';
  }
}

function arcpFilterParams(filters: AppliedArcpFilters): Record<string, string> {
  return {
    startDate: filters.startDateStr,
    endDate: filters.endDateStr,
    dateFilterColumn: filters.arcpDateFilterColumn,
    callType: filters.callTypeParam,
    ...(filters.branchParam ? { branch: filters.branchParam } : {}),
    ...(filters.franchiseeParam ? { franchisee: filters.franchiseeParam } : {}),
  };
}

function buildArcpJobResumeMessage(done: number, total: number, pending: number): string {
  if (done <= 0) return 'Resuming ARCP load from server progress';
  return `${done}/${total} periods cached on server — fetching ${pending} remaining`;
}

function buildArcpPartialFailureMessage(
  failedChunks: number,
  totalChunks: number,
  hasRows: boolean
): string {
  if (hasRows) {
    return `Loaded partial tally — ${failedChunks} of ${totalChunks} period(s) timed out. Click Apply filters again to retry failed periods.`;
  }
  return `${failedChunks} of ${totalChunks} period(s) timed out. Click Apply filters again to retry — completed periods are kept on the server.`;
}

function buildArcpPlanMessage(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  _usePostgres?: boolean,
  scopedFilters?: boolean
): string {
  const eta = formatArcpDurationMs(plan.estimateMs);

  if (plan.chunkCount <= 1) {
    if (scopedFilters) {
      return `Loading ${plan.spanDays}-day tally for selected branch/franchisee (est. ${eta}).`;
    }
    return `Loading ${plan.spanDays}-day tally (est. ${eta}).`;
  }

  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';
  const periodLabel = arcpChunkPeriodLabel(plan.chunkGranularity, false);
  const parallelNote =
    resolveArcpLoadConcurrency({ dateFilterColumn }, plan) > 1
      ? ` (up to ${resolveArcpLoadConcurrency({ dateFilterColumn }, plan)} in parallel)`
      : '';

  return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} ${periodLabel}(s)${parallelNote}. Est. ${eta}. Tally updates as each completes.`;
}

function buildArcpDetailPlanMessage(plan: ArcpLoadPlan, dateFilterColumn: ArcpDateFilterColumn): string {
  if (plan.chunkCount <= 1) {
    return `Fetching line-level detail for ${plan.spanDays} days.`;
  }

  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';
  const eta = formatArcpDurationMs(plan.estimateMs);
  const periodLabel = arcpChunkPeriodLabel(plan.chunkGranularity, false);

  return `${plan.spanDays}-day detail on ${basis} exports in ${plan.chunkCount} ${periodLabel}(s) (est. ${eta}).`;
}

function toLoadStatus(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  loadedCount: number,
  etaMs: number,
  options?: {
    planMessage?: string;
    rowsLoaded?: number;
    scopedFilters?: boolean;
    failedCount?: number;
    processedCount?: number;
  }
): ArcpLoadStatus {
  const total = plan.chunkCount;
  const failedCount =
    options?.failedCount != null && options.failedCount > 0 && options.failedCount <= total
      ? options.failedCount
      : undefined;
  const processed = Math.min(
    total,
    options?.processedCount ?? loadedCount + (failedCount ?? 0)
  );
  const done = Math.min(loadedCount, total);
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const concurrency = resolveArcpLoadConcurrency({ dateFilterColumn }, plan);
  const inFlight = processed < total && total > 1;

  return {
    done,
    total,
    percent,
    failedCount,
    currentRange: inFlight
      ? concurrency > 1
        ? `up to ${concurrency} in parallel`
        : arcpChunkLoadingHint(plan)
      : null,
    etaRemainingLabel: processed < total ? formatArcpDurationMs(etaMs) : null,
    etaFinishLabel: processed < total ? formatArcpFinishTime(Date.now() + etaMs) : null,
    planMessage:
      options?.planMessage ??
      buildArcpPlanMessage(
        plan,
        dateFilterColumn,
        readArcpFromPostgresClient(),
        options?.scopedFilters
      ),
    rowsLoaded: options?.rowsLoaded,
  };
}

export default function ArcpClaimsPage() {
  const supabase = createClient();
  const chunkedAuth = useMemo(() => createChunkedFetchAuth(supabase), [supabase]);
  const {
    dateRange,
    setDateRange,
    selectedBranch,
    selectedFranchisee,
    selectedCallTypes,
    setSelectedCallTypes,
    callTypeOptions,
    offices,
    branchesList,
    franchiseesList,
    resourcesLoaded,
    prefsReady,
    handleBranchesChange,
    setSelectedFranchisee,
  } = useReportFilters();

  const [arcpDateFilterColumn, setArcpDateFilterColumn] =
    useState<ArcpDateFilterColumn>(ARCP_DEFAULT_DATE_FILTER_COLUMN);
  const [rawAggregateRows, setRawAggregateRows] = useState<ArcpClaimsAggregateRow[] | null>(null);
  const [includeTravelReimbursement, setIncludeTravelReimbursement] = useState(true);
  const [tableView, setTableView] = useState<ArcpTableViewMode>('summary');
  const [tallyGrouping, setTallyGrouping] = useState<ArcpTallyGrouping>('category');
  const [tallyDetailLevel, setTallyDetailLevel] = useState<ArcpTallyDetailLevel>('full');
  const [loading, setLoading] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState('');
  const { alert: pageAlert, setError: setPageError, setWarning: setPageWarning, clear: clearPageAlert } =
    usePageAlert();
  const zeroAmountWarnedRef = useRef<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<ArcpLoadStatus | null>(null);
  const [detailExportStatus, setDetailExportStatus] = useState<ArcpLoadStatus | null>(null);
  const [detailExportRunningTotals, setDetailExportRunningTotals] =
    useState<ArcpRunningTotals | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<AppliedArcpFilters | null>(null);
  const [arcpCoverage, setArcpCoverage] = useState<ArcpPostgresCoverage | null>(null);
  const [arcpCrmLabelLookups, setArcpCrmLabelLookups] = useState<ArcpClientLabelLookups | null>(
    null
  );
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const inFlightLoadKeyRef = useRef<string | null>(null);
  const arcpBootstrapRef = useRef(false);

  const loadEstimateHints = useMemo(
    () => ({
      usePostgres: readArcpFromPostgresClient(),
      coverage: arcpCoverage,
    }),
    [arcpCoverage]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const progress = await fetchReadModelStatus(session?.access_token);
        if (!cancelled) setArcpCoverage(progress.arcp ?? null);
      } catch {
        /* status optional for estimates */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!resourcesLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const lookups = await chunkedAuth.getWithAuthRetry<ArcpClientLabelLookups>(
          '/api/report/arcp-claims/label-lookups'
        );
        if (!cancelled) setArcpCrmLabelLookups(lookups);
      } catch {
        /* labels optional — table falls back to codes */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resourcesLoaded, chunkedAuth]);

  const startDateStr = useMemo(() => toDateString(dateRange.start), [dateRange.start]);
  const endDateStr = useMemo(() => toDateString(dateRange.end), [dateRange.end]);
  const callTypeParam = useMemo(
    () => (selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',')),
    [selectedCallTypes]
  );
  const branchParam = useMemo(() => joinFilterParam(selectedBranch) ?? '', [selectedBranch]);
  const franchiseeParam = useMemo(() => joinFilterParam(selectedFranchisee) ?? '', [selectedFranchisee]);

  const branchLabel = useMemo(() => {
    const branchIds = appliedFilters?.selectedBranch ?? selectedBranch;
    if (branchIds.length === 0) return 'All Branches';
    const options = buildMainBranchOptions(offices, branchesList);
    return branchIds
      .map((id) => options.find((option) => option.value === id)?.label ?? id)
      .join(', ');
  }, [appliedFilters?.selectedBranch, selectedBranch, offices, branchesList]);

  const franchiseeLabel = useMemo(() => {
    const franchiseeIds = appliedFilters?.selectedFranchisee ?? selectedFranchisee;
    const branchIds = appliedFilters?.selectedBranch ?? selectedBranch;
    if (franchiseeIds.length === 0) return 'All Franchisees';
    const options = buildFranchiseeOptions(offices, branchIds, franchiseesList);
    return franchiseeIds
      .map((id) => options.find((option) => option.value === id)?.label ?? id)
      .join(', ');
  }, [
    appliedFilters?.selectedFranchisee,
    appliedFilters?.selectedBranch,
    selectedFranchisee,
    selectedBranch,
    offices,
    franchiseesList,
  ]);

  const callTypeLabel = useMemo(() => {
    const callTypes = appliedFilters?.selectedCallTypes ?? selectedCallTypes;
    if (callTypes.length === 0) return 'All Call Types';
    return callTypes.join(', ');
  }, [appliedFilters?.selectedCallTypes, selectedCallTypes]);

  const dateBasisLabel = useMemo(() => {
    const dateColumn = appliedFilters?.arcpDateFilterColumn ?? arcpDateFilterColumn;
    return (
      ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateColumn)?.label ?? 'Call Date'
    );
  }, [appliedFilters?.arcpDateFilterColumn, arcpDateFilterColumn]);

  const draftFilters: AppliedArcpFilters = useMemo(
    () => ({
      startDateStr,
      endDateStr,
      arcpDateFilterColumn,
      branchParam,
      franchiseeParam,
      callTypeParam,
      selectedBranch,
      selectedFranchisee,
      selectedCallTypes,
    }),
    [
      startDateStr,
      endDateStr,
      arcpDateFilterColumn,
      branchParam,
      franchiseeParam,
      callTypeParam,
      selectedBranch,
      selectedFranchisee,
      selectedCallTypes,
    ]
  );

  const draftQueryKey = useMemo(() => appliedArcpFiltersKey(draftFilters), [draftFilters]);
  const appliedQueryKey = useMemo(
    () => (appliedFilters ? appliedArcpFiltersKey(appliedFilters) : null),
    [appliedFilters]
  );
  const hasPendingFilterChanges = appliedQueryKey !== draftQueryKey;

  const mergedAggregateRows = useMemo(() => {
    if (!rawAggregateRows?.length) return [];
    const merged = mergeArcpAggregateRows(rawAggregateRows);
    if (!arcpCrmLabelLookups) return merged;
    return enrichArcpAggregateLabelsClient(merged, arcpCrmLabelLookups);
  }, [rawAggregateRows, arcpCrmLabelLookups]);

  const arcpLabelLookups = useMemo(() => {
    const callTypeLabelsByCode: Record<string, string> = {
      ...(arcpCrmLabelLookups?.callTypeLabelsByCode ?? {}),
    };
    for (const option of callTypeOptions) {
      if (option.value && option.label) {
        callTypeLabelsByCode[String(option.value)] = option.label;
      }
    }
    return {
      callTypeLabelsByCode,
      itemCategoryLabelsByCode: arcpCrmLabelLookups?.itemCategoryLabelsByCode ?? {},
    };
  }, [callTypeOptions, arcpCrmLabelLookups]);

  const tableModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: includeTravelReimbursement,
      grouping: tallyGrouping,
      ...arcpLabelLookups,
    });
  }, [mergedAggregateRows, includeTravelReimbursement, tallyGrouping, arcpLabelLookups]);

  const fullModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: true,
      ...arcpLabelLookups,
    });
  }, [mergedAggregateRows, arcpLabelLookups]);

  /** Same totals as on-screen summary cards and Summary CSV export. */
  const summaryTotals = useMemo(() => {
    const lineCounts = deriveArcpGrandTotalsFromAggregates(mergedAggregateRows);
    const exportTotals = tableModel?.totals ?? fullModel?.totals;
    if (exportTotals) {
      return {
        serviceLineCount: lineCounts.serviceLineCount,
        travelLineCount: lineCounts.travelLineCount,
        amountPayable: exportTotals.amountPayable,
        branchApproved: exportTotals.branchApproved,
        hoApproved: exportTotals.hoApproved,
      };
    }
    return {
      serviceLineCount: lineCounts.serviceLineCount,
      travelLineCount: lineCounts.travelLineCount,
      amountPayable: lineCounts.amountPayable,
      branchApproved: lineCounts.branchApproved,
      hoApproved: lineCounts.hoApproved,
    };
  }, [mergedAggregateRows, fullModel, tableModel]);

  const categorySectionCount = useMemo(
    () => (tableModel ? countArcpCategorySections(tableModel) : 0),
    [tableModel]
  );

  const displayModel = useMemo(() => {
    if (!tableModel) return null;
    return applyArcpTallyDetailLevel(tableModel, tallyDetailLevel);
  }, [tableModel, tallyDetailLevel]);

  useEffect(() => {
    if (loading || !appliedFilters || mergedAggregateRows.length === 0) return;
    const { serviceLineCount, amountPayable, branchApproved, hoApproved } = summaryTotals;
    const warnKey = appliedArcpFiltersKey(appliedFilters);
    if (
      serviceLineCount > 0 &&
      amountPayable === 0 &&
      branchApproved === 0 &&
      hoApproved === 0 &&
      zeroAmountWarnedRef.current !== warnKey
    ) {
      zeroAmountWarnedRef.current = warnKey;
      setPageWarning(
        'Rows loaded but Amount Payable / Branch / HO are all zero for this date basis. Try a wider range or Call Date filter.'
      );
    }
  }, [loading, appliedFilters, mergedAggregateRows.length, summaryTotals, setPageWarning]);

  const hasNoResults = Boolean(
    appliedFilters && !loading && mergedAggregateRows.length === 0
  );

  const monthlyBreakdown = useMemo(() => {
    if (!rawAggregateRows?.length) return null;
    const enrichedMonthlyRows = arcpCrmLabelLookups
      ? enrichArcpAggregateLabelsClient(rawAggregateRows, arcpCrmLabelLookups)
      : rawAggregateRows;
    if (enrichedMonthlyRows.length === 0) return null;
    return buildArcpClaimsMonthlyBreakdown(enrichedMonthlyRows, {
      includeTravel: includeTravelReimbursement,
    });
  }, [rawAggregateRows, arcpCrmLabelLookups, includeTravelReimbursement]);

  const canExportPdf = useMemo(() => {
    if (!appliedFilters || !tableModel) return false;
    if (tableView === 'monthly') return (monthlyBreakdown?.rows.length ?? 0) > 0;
    if (tableView === 'summary') {
      return (displayModel?.rows.length ?? 0) > 0 || tallyDetailLevel === 'totals';
    }
    return (
      (displayModel?.rows.length ?? 0) > 0 ||
      tallyDetailLevel === 'totals' ||
      (monthlyBreakdown?.rows.length ?? 0) > 0
    );
  }, [
    appliedFilters,
    tableModel,
    tableView,
    monthlyBreakdown,
    displayModel,
    tallyDetailLevel,
  ]);

  const draftQueryOpts = useMemo(
    () => ({
      startDate: startDateStr,
      endDate: endDateStr,
      dateFilterColumn: arcpDateFilterColumn,
      callType: callTypeParam,
      branch: branchParam || undefined,
      franchisee: franchiseeParam || undefined,
    }),
    [
      startDateStr,
      endDateStr,
      arcpDateFilterColumn,
      callTypeParam,
      branchParam,
      franchiseeParam,
    ]
  );

  const draftLoadPlan = useMemo(
    () => resolveArcpClientLoadPlan(draftQueryOpts, loadEstimateHints),
    [draftQueryOpts, loadEstimateHints]
  );

  const appliedLoadPlan = useMemo(() => {
    if (!appliedFilters) return null;
    return resolveArcpClientLoadPlan(
      {
        startDate: appliedFilters.startDateStr,
        endDate: appliedFilters.endDateStr,
        dateFilterColumn: appliedFilters.arcpDateFilterColumn,
        callType: appliedFilters.callTypeParam,
        branch: appliedFilters.branchParam || undefined,
        franchisee: appliedFilters.franchiseeParam || undefined,
      },
      loadEstimateHints
    );
  }, [appliedFilters, loadEstimateHints]);

  const draftLoadPreview = useMemo((): ArcpLoadStatus | null => {
    if (!draftLoadPlan.isLongLoad || loading) return null;
    return toLoadStatus(draftLoadPlan, arcpDateFilterColumn, 0, draftLoadPlan.estimateMs, {
      scopedFilters: Boolean(branchParam || franchiseeParam),
    });
  }, [draftLoadPlan, arcpDateFilterColumn, loading, branchParam, franchiseeParam]);

  const pageScopeSubtitle = useMemo(() => {
    if (appliedFilters) {
      return formatReportScopeSubtitle(
        {
          start: new Date(`${appliedFilters.startDateStr}T00:00:00`),
          end: new Date(`${appliedFilters.endDateStr}T00:00:00`),
          label: `${appliedFilters.startDateStr} → ${appliedFilters.endDateStr}`,
        },
        appliedFilters.selectedBranch.length,
        appliedFilters.selectedFranchisee.length
      );
    }
    return formatReportScopeSubtitle(
      dateRange,
      selectedBranch.length,
      selectedFranchisee.length
    );
  }, [appliedFilters, dateRange, selectedBranch, selectedFranchisee]);

  const wideScopeLoad = useMemo(
    () =>
      isWideOrganizationScope(
        appliedFilters?.selectedBranch ?? selectedBranch,
        appliedFilters?.selectedFranchisee ?? selectedFranchisee
      ),
    [appliedFilters, selectedBranch, selectedFranchisee]
  );

  const loadData = useCallback(
    async (
      filters: AppliedArcpFilters,
      refresh = false,
      signal?: AbortSignal,
      generation = 0
    ) => {
      setLoading(true);
      clearPageAlert();
      zeroAmountWarnedRef.current = null;

      const isStale = () => generation !== loadGenerationRef.current || signal?.aborted;
      const loadStartedAt = Date.now();

      const queryOpts = {
        startDate: filters.startDateStr,
        endDate: filters.endDateStr,
        dateFilterColumn: filters.arcpDateFilterColumn,
        callType: filters.callTypeParam,
        branch: filters.branchParam || undefined,
        franchisee: filters.franchiseeParam || undefined,
      };

      const scopedFilters = Boolean(filters.branchParam || filters.franchiseeParam);
      const optimisticPlan = resolveArcpClientLoadPlan(queryOpts, loadEstimateHints);
      if (!isStale()) {
        setLoadStatus(
          toLoadStatus(optimisticPlan, filters.arcpDateFilterColumn, 0, optimisticPlan.estimateMs, {
            scopedFilters,
          })
        );
      }

      let activeHints = loadEstimateHints;
      if (readArcpFromPostgresClient() && !activeHints.coverage) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const progress = await fetchReadModelStatus(session?.access_token);
          if (progress.arcp) {
            activeHints = { usePostgres: true, coverage: progress.arcp };
            if (!isStale()) setArcpCoverage(progress.arcp);
          }
        } catch {
          /* server still resolves Postgres vs CRM without client coverage */
        }
      }

      const loadPlan = resolveArcpClientLoadPlan(queryOpts, activeHints);
      const useClientChunks = shouldUseClientSideArcpChunks(queryOpts, activeHints);
      let chunkList = loadPlan.chunks;
      const chunkTimings: number[] = [];
      const chunkKey = (c: { start: string; end: string }) => `${c.start}|${c.end}`;

      let jobId: string | undefined;
      let jobChunkStatus = new Map<string, ArcpLoadJobChunkRow['status']>();
      let cachedAtStart = 0;
      let pendingAtStart = chunkList.length;
      let runningAggregates: ArcpClaimsAggregateRow[] = [];
      let jobPollTimer: ReturnType<typeof setTimeout> | null = null;
      let jobPollInFlight = false;
      let jobPollDelayMs = ARCP_JOB_POLL_MS;
      let maxProcessedSeen = 0;
      let pollFailedCount = 0;
      let loadedChunks = 0;
      const mergedChunkKeys = new Set<string>();

      const markChunkMerged = (chunk: { start: string; end: string }) => {
        mergedChunkKeys.add(chunkKey(chunk));
      };

      const countMergedChunks = () =>
        Math.min(
          chunkList.filter((c) => mergedChunkKeys.has(chunkKey(c))).length,
          chunkList.length
        );

      const applyInitialAggregates = (rows: ArcpClaimsAggregateRow[]) => {
        runningAggregates = rows;
        if (rows.length === 0) return;
        if (!isStale()) {
          setRawAggregateRows(rows);
          return;
        }
        setRawAggregateRows((prev) => (prev && prev.length > 0 ? prev : rows));
      };

      const monthChunkPlan = loadPlan.chunkGranularity === 'month';

      const mergeChunkAggregates = (
        chunk: { start: string; end: string },
        chunkRows: ArcpClaimsAggregateRow[]
      ) => {
        if (chunkRows.length === 0 || isStale()) return;
        const key = chunkKey(chunk);
        if (mergedChunkKeys.has(key)) return;
        mergedChunkKeys.add(key);
        runningAggregates = mergeArcpChunkAggregateRows(runningAggregates, chunk, chunkRows, {
          replaceMonths: monthChunkPlan,
        });
        setRawAggregateRows(runningAggregates.length > 0 ? runningAggregates : null);
      };

      const updateLoadProgress = (
        loaded: number,
        etaMs: number,
        extra?: { failedCount?: number; processedCount?: number }
      ) => {
        const failed = extra?.failedCount ?? pollFailedCount;
        const processed = Math.min(
          chunkList.length,
          extra?.processedCount ?? loaded + failed
        );
        if (isStale() || processed < maxProcessedSeen) return;
        maxProcessedSeen = processed;
        if (extra?.failedCount != null) pollFailedCount = extra.failedCount;
        loadedChunks = loaded;
        const lineQty = runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0);
        setLoadStatus(
          toLoadStatus(
            { ...loadPlan, chunkCount: chunkList.length, chunks: chunkList },
            filters.arcpDateFilterColumn,
            loaded,
            etaMs,
            {
              scopedFilters,
              rowsLoaded: lineQty > 0 ? lineQty : undefined,
              failedCount: pollFailedCount > 0 ? pollFailedCount : undefined,
              processedCount: processed,
            }
          )
        );
      };

      const syncFromJob = async (): Promise<ArcpLoadJobStatusResponse | null> => {
        if (!jobId || isStale() || signal?.aborted) return null;
        try {
          const status = await chunkedAuth.getWithAuthRetry<ArcpLoadJobStatusResponse>(
            '/api/report/arcp-claims/load-status',
            { signal, params: { kind: 'agg', jobId, progressOnly: 'true' } }
          );
          if (isStale()) return null;

          if (status.progress && status.progress.totalChunks > 0) {
            const failed = status.progress.failedCount;
            const done = countMergedChunks();
            const processed = Math.min(chunkList.length, done + failed);
            const elapsedMs = Date.now() - loadStartedAt;
            const etaMs =
              processed > cachedAtStart
                ? (elapsedMs / Math.max(processed - cachedAtStart, 1)) *
                  Math.max(chunkList.length - processed, 0)
                : loadPlan.estimateMs;
            updateLoadProgress(done, etaMs, {
              failedCount: failed,
              processedCount: processed,
            });
          }

          if (!status.resumable) stopJobPoll();
          return status;
        } catch {
          return null;
        }
      };

      const startJobPoll = () => {
        if (!jobId || jobPollTimer) return;
        void syncFromJob();

        const schedulePoll = () => {
          jobPollTimer = setTimeout(() => {
            jobPollTimer = null;
            if (isStale() || signal?.aborted || !jobId) return;
            if (jobPollInFlight) {
              schedulePoll();
              return;
            }
            jobPollInFlight = true;
            void syncFromJob()
              .finally(() => {
                jobPollInFlight = false;
                jobPollDelayMs = Math.min(jobPollDelayMs * 2, ARCP_JOB_POLL_MAX_MS);
                if (!isStale() && !signal?.aborted && jobId) schedulePoll();
              });
          }, jobPollDelayMs);
        };

        schedulePoll();
      };

      const stopJobPoll = () => {
        if (jobPollTimer) {
          clearTimeout(jobPollTimer);
          jobPollTimer = null;
        }
        jobPollDelayMs = ARCP_JOB_POLL_MS;
      };

      let failedChunks = 0;

      try {
      const headers = await chunkedAuth.getAuthHeaders();
      const jobStartRes = await axios.post<ArcpLoadJobStartResponse>(
        '/api/report/arcp-claims/load-start',
        null,
        {
          headers,
          signal,
          params: { kind: 'agg', ...arcpFilterParams(filters) },
        }
      );
      if (isStale()) {
        applyInitialAggregates(runningAggregates);
        return;
      }
      const jobStart = jobStartRes.data;
      if (jobStart.error) throw new Error(jobStart.error);

      if (jobStart.chunks?.length) {
        chunkList = jobStart.chunks.map((c) => ({
          start: c.chunkStart,
          end: c.chunkEnd,
        }));
        pendingAtStart = jobStart.progress?.pendingCount ?? chunkList.length;
      }

      if (jobStart.jobId && jobStart.jobsEnabled !== false) {
        jobId = jobStart.jobId;
        jobChunkStatus = new Map(
          (jobStart.chunks ?? []).map((c) => [`${c.chunkStart}|${c.chunkEnd}`, c.status])
        );
        cachedAtStart = jobStart.progress?.doneCount ?? 0;
        pendingAtStart = jobStart.progress?.pendingCount ?? chunkList.length;
        runningAggregates = mergeArcpAggregateRows(
          jobStart.partialAggregates ?? [],
          ARCP_MERGE_ACROSS_CHUNKS
        );
        for (const c of jobStart.chunks ?? []) {
          if (c.status === 'done') {
            markChunkMerged({ start: c.chunkStart, end: c.chunkEnd });
          }
        }

        if (!isStale()) {
          loadedChunks = countMergedChunks();
          maxProcessedSeen = Math.min(
            chunkList.length,
            loadedChunks + (jobStart.progress?.failedCount ?? 0)
          );
          pollFailedCount = Math.min(
            jobStart.progress?.failedCount ?? 0,
            chunkList.length
          );
          applyInitialAggregates(runningAggregates);
          setLoadStatus(
            toLoadStatus(
              { ...loadPlan, chunkCount: chunkList.length, chunks: chunkList },
              filters.arcpDateFilterColumn,
              countMergedChunks(),
              loadPlan.estimateMs,
              {
              scopedFilters,
              planMessage: buildArcpJobResumeMessage(
                countMergedChunks(),
                chunkList.length,
                pendingAtStart
              ),
              rowsLoaded:
                runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0) || undefined,
              failedCount: pollFailedCount > 0 ? pollFailedCount : undefined,
              processedCount: maxProcessedSeen,
            })
          );
          startJobPoll();
        } else {
          applyInitialAggregates(runningAggregates);
        }
      } else if (!isStale()) {
        setLoadStatus(
          toLoadStatus(loadPlan, filters.arcpDateFilterColumn, 0, loadPlan.estimateMs, {
            scopedFilters,
          })
        );
      }

      const fetchAggregateChunk = async (
        chunk: { start: string; end: string },
        chunkIndex: number
      ) => {
        const isBmApprove = filters.arcpDateFilterColumn === 'bm_approved_at';
        const chunkTimeoutMs = useClientChunks
          ? isBmApprove
            ? 180_000
            : 300_000
          : isBmApprove
            ? Math.max(loadPlan.estimateMs + 120_000, 300_000)
            : loadPlan.crmChunkCount > 0
              ? Math.max(loadPlan.estimateMs + 60_000, 300_000)
              : Math.max(loadPlan.estimateMs + 30_000, 120_000);

        return chunkedAuth.getWithAuthRetry<{
          aggregates?: ArcpClaimsAggregateRow[];
          meta?: {
            source?: string;
            cached?: boolean;
            cachedChunks?: number;
            fetchedChunks?: number;
            totalChunks?: number;
          };
          error?: string;
        }>(
          '/api/report/arcp-claims',
          {
            timeout: chunkTimeoutMs,
            signal,
            params: {
              startDate: chunk.start,
              endDate: chunk.end,
              dateFilterColumn: filters.arcpDateFilterColumn,
              callType: filters.callTypeParam,
              aggregatesOnly: 'true',
              ...(jobId ? { jobId } : {}),
              ...(filters.branchParam ? { branch: filters.branchParam } : {}),
              ...(filters.franchiseeParam ? { franchisee: filters.franchiseeParam } : {}),
              ...(refresh ? { refresh: 'true' } : {}),
            },
          },
          { chunkIndex }
        );
      };

      const doneChunkKeysAtStart = new Set(
        (jobStart.chunks ?? [])
          .filter((c) => c.status === 'done')
          .map((c) => chunkKey({ start: c.chunkStart, end: c.chunkEnd }))
      );

      let failedChunks = Math.min(jobStart.progress?.failedCount ?? 0, chunkList.length);

        let chunksToFetch = useClientChunks
          ? chunkList.filter((c) => !doneChunkKeysAtStart.has(chunkKey(c)))
          : pendingAtStart > 0 || failedChunks > 0
            ? chunkList
            : [];

        if (
          cachedAtStart >= chunkList.length &&
          chunkList.length > 0 &&
          runningAggregates.length > 0
        ) {
          chunksToFetch = [];
        }

        if (
          chunksToFetch.length === 0 &&
          runningAggregates.length === 0 &&
          chunkList.length > 0 &&
          cachedAtStart < chunkList.length
        ) {
          chunksToFetch = chunkList.filter((c) => !doneChunkKeysAtStart.has(chunkKey(c)));
          if (chunksToFetch.length === 0) {
            chunksToFetch = chunkList;
          }
          cachedAtStart = 0;
          pendingAtStart = chunksToFetch.length;
        }

        if (chunksToFetch.length === 0) {
          applyInitialAggregates(runningAggregates);
        } else if (!useClientChunks) {
          try {
            const data = await fetchAggregateChunk(chunkList[0], 0);
            if (isStale()) return;
            if (data.error) throw new Error(data.error);
            mergeChunkAggregates(chunkList[0], data.aggregates ?? []);
            if (!isStale()) {
              updateLoadProgress(chunkList.length, 0);
            }
          } catch (singleErr: unknown) {
            if (isChunkedFetchAbortError(singleErr, signal)) {
              return;
            }
            if (isChunkedFetchAuthError(singleErr)) {
              throw singleErr;
            }
            failedChunks += 1;
          }
        } else {
          await runPool(
            chunksToFetch,
            resolveArcpLoadConcurrency(queryOpts, {
              ...loadPlan,
              usePostgres: activeHints?.usePostgres,
            }),
            async (chunk) => {
            if (isStale()) return;

            const chunkStartedAt = Date.now();

            try {
              const data = await fetchAggregateChunk(chunk, countMergedChunks());

              if (isStale()) return;
              if (data.error) throw new Error(data.error);

              mergeChunkAggregates(chunk, data.aggregates ?? []);
            } catch (chunkErr: unknown) {
              if (isChunkedFetchAbortError(chunkErr, signal)) {
                return;
              }
              if (isChunkedFetchAuthError(chunkErr)) {
                throw chunkErr;
              }
              failedChunks += 1;
            }

            chunkTimings.push(Math.max(Date.now() - chunkStartedAt, 1));
            const done = countMergedChunks();
            const processedCount = Math.min(chunkList.length, done + failedChunks);
            const elapsedMs = Date.now() - loadStartedAt;
            const etaMs =
              processedCount > cachedAtStart
                ? (elapsedMs / Math.max(processedCount - cachedAtStart, 1)) *
                  Math.max(chunkList.length - processedCount, 0)
                : loadPlan.estimateMs;

            if (!isStale()) {
              updateLoadProgress(done, etaMs, {
                failedCount: failedChunks,
                processedCount,
              });
            }
          }
          );
        }

        if (failedChunks > 0 && !isStale()) {
          const hasRows = runningAggregates.length > 0;
          const partialMessage = buildArcpPartialFailureMessage(
            failedChunks,
            chunkList.length,
            hasRows
          );
          const userPartialMessage = sanitizeUserFacingMessage(partialMessage);
          setPageWarning(userPartialMessage);
          setLoadStatus(
            toLoadStatus(
              { ...loadPlan, chunkCount: chunkList.length, chunks: chunkList },
              filters.arcpDateFilterColumn,
              Math.max(chunkList.length - failedChunks, 0),
              0,
              {
                scopedFilters,
                planMessage: userPartialMessage,
                rowsLoaded: hasRows
                  ? runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0)
                  : undefined,
              }
            )
          );
        }
      } catch (err: unknown) {
        if (isChunkedFetchAbortError(err, signal)) {
          applyInitialAggregates(runningAggregates);
          return;
        }
        if (isStale()) return;
        const message = sanitizeUserFacingMessage(
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load ARCP claims'
        );
        setPageError(message);
      } finally {
        stopJobPoll();
        if (generation === loadGenerationRef.current) {
          if (runningAggregates.length === 0) {
            setRawAggregateRows(null);
          }
          setLoading(false);
          if (failedChunks === 0) {
            setLoadStatus(null);
          }
        }
      }
    },
    [chunkedAuth, loadEstimateHints, supabase]
  );

  const runLoad = useCallback(
    (filters: AppliedArcpFilters, refresh = false) => {
      const key = appliedArcpFiltersKey(filters);
      if (!refresh && inFlightLoadKeyRef.current === key && loadAbortRef.current) {
        return loadAbortRef.current;
      }

      loadAbortRef.current?.abort();
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      const controller = new AbortController();
      loadAbortRef.current = controller;
      inFlightLoadKeyRef.current = key;

      void loadData(filters, refresh, controller.signal, generation).finally(() => {
        if (inFlightLoadKeyRef.current === key) {
          inFlightLoadKeyRef.current = null;
        }
        if (loadAbortRef.current === controller) {
          loadAbortRef.current = null;
        }
      });

      return controller;
    },
    [loadData]
  );

  const handleApplyFilters = useCallback(() => {
    const nextFilters: AppliedArcpFilters = {
      startDateStr,
      endDateStr,
      arcpDateFilterColumn,
      branchParam,
      franchiseeParam,
      callTypeParam,
      selectedBranch: [...selectedBranch],
      selectedFranchisee: [...selectedFranchisee],
      selectedCallTypes: [...selectedCallTypes],
    };

    const nextQueryKey = appliedArcpFiltersKey(nextFilters);
    if (loading && nextQueryKey === appliedQueryKey) {
      return;
    }

    setAppliedFilters(nextFilters);
    if (nextQueryKey !== appliedQueryKey) {
      setRawAggregateRows(null);
    }

    runLoad(nextFilters, false);
  }, [
    arcpDateFilterColumn,
    branchParam,
    callTypeParam,
    endDateStr,
    franchiseeParam,
    runLoad,
    selectedBranch,
    selectedCallTypes,
    selectedFranchisee,
    startDateStr,
    appliedQueryKey,
    loading,
  ]);

  const applyRestoredSession = useCallback(
    (
      restored: ArcpAppliedFiltersSnapshot,
      partialAggregates: ArcpClaimsAggregateRow[] | undefined,
      resumable: boolean
    ) => {
      setArcpDateFilterColumn(restored.arcpDateFilterColumn);
      setDateRange({
        start: new Date(`${restored.startDateStr}T00:00:00`),
        end: new Date(`${restored.endDateStr}T00:00:00`),
        label: `${restored.startDateStr} → ${restored.endDateStr}`,
      });
      handleBranchesChange(restored.selectedBranch);
      setSelectedFranchisee(restored.selectedFranchisee);
      setSelectedCallTypes(restored.selectedCallTypes);
      setAppliedFilters(restored);
      if (partialAggregates?.length) {
        setRawAggregateRows(
          mergeArcpAggregateRows(partialAggregates, ARCP_MERGE_ACROSS_CHUNKS)
        );
      } else {
        setRawAggregateRows(null);
      }
      if (resumable) {
        runLoad(restored, false);
      }
    },
    [
      handleBranchesChange,
      runLoad,
      setDateRange,
      setSelectedCallTypes,
      setSelectedFranchisee,
    ]
  );

  useEffect(() => {
    if (!resourcesLoaded || !prefsReady || arcpBootstrapRef.current) return;
    arcpBootstrapRef.current = true;

    const dateColumn = arcpDateFilterColumn;

    void (async () => {
      try {
        const status = await chunkedAuth.getWithAuthRetry<ArcpLoadJobStatusResponse>(
          '/api/report/arcp-claims/load-status',
          { params: { kind: 'agg', latest: 'any' } }
        );

        if (status.jobId) {
          const restored = filtersFromLoadJobSnapshot(status.filters ?? {});
          const draftKey = appliedArcpFiltersKey({
            startDateStr,
            endDateStr,
            arcpDateFilterColumn: dateColumn,
            branchParam,
            franchiseeParam,
            callTypeParam,
            selectedBranch,
            selectedFranchisee,
            selectedCallTypes,
          });
          const matchesDraft = restored && appliedArcpFiltersKey(restored) === draftKey;
          const hasPartialData = (status.partialAggregates?.length ?? 0) > 0;

          if (matchesDraft && (status.resumable || hasPartialData)) {
            applyRestoredSession(restored, status.partialAggregates, Boolean(status.resumable));
            return;
          }
        }
      } catch {
        /* no prior session — load defaults below */
      }

      const nextFilters: AppliedArcpFilters = {
        startDateStr,
        endDateStr,
        arcpDateFilterColumn: dateColumn,
        branchParam,
        franchiseeParam,
        callTypeParam,
        selectedBranch: [...selectedBranch],
        selectedFranchisee: [...selectedFranchisee],
        selectedCallTypes: [...selectedCallTypes],
      };
      setAppliedFilters(nextFilters);
      runLoad(nextFilters, false);
    })();
  }, [
    resourcesLoaded,
    prefsReady,
    chunkedAuth,
    applyRestoredSession,
    runLoad,
    startDateStr,
    endDateStr,
    arcpDateFilterColumn,
    branchParam,
    franchiseeParam,
    callTypeParam,
    selectedBranch,
    selectedFranchisee,
    selectedCallTypes,
  ]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfViewerUrl) {
        URL.revokeObjectURL(pdfViewerUrl);
      }
    };
  }, [pdfViewerUrl]);

  const closePdfViewer = useCallback(() => {
    setPdfViewerOpen(false);
    setPdfViewerUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPdfFileName('');
  }, []);

  const handleExportCsv = useCallback(() => {
    const exportModel = displayModel ?? tableModel;
    if (
      !appliedFilters ||
      !exportModel ||
      (exportModel.rows.length === 0 && tallyDetailLevel !== 'totals')
    ) {
      return;
    }

    const fileName = `ARCP_Claims_Summary_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
    downloadArcpClaimsCsv(exportModel, fileName);
    feedback.actionSuccess('Summary CSV exported');
  }, [appliedFilters, displayModel, tableModel, tallyDetailLevel]);

  const downloadPreparedDetailCsv = useCallback(
    (rows: ArcpClaimsDetailRow[]) => {
      if (!appliedFilters || !tableModel) return;
      const prepared = prepareArcpDetailExportRows(rows, {
        dateFilterColumn: appliedFilters.arcpDateFilterColumn,
        includeTravel: includeTravelReimbursement,
      });
      if (prepared.length === 0) throw new Error('No detail rows to export');
      const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
      downloadArcpClaimsDetailCsv(prepared, fileName, { totals: tableModel.totals });
      feedback.actionSuccess(`Exported ${prepared.length.toLocaleString('en-IN')} detail lines`);
    },
    [appliedFilters, tableModel, includeTravelReimbursement]
  );

  const handleViewPdf = useCallback(async () => {
    if (!appliedFilters || !tableModel || !canExportPdf) return;

    const tallyForPdf =
      tableView === 'monthly' ? null : displayModel;
    const monthlyForPdf =
      tableView === 'summary' ? null : monthlyBreakdown;

    setExportingPdf(true);
    try {
      const fileName = buildArcpClaimsPdfFileName(
        appliedFilters.startDateStr,
        appliedFilters.endDateStr
      );
      const { blob } = await buildArcpClaimsPdfBlob(
        {
          meta: {
            startDate: appliedFilters.startDateStr,
            endDate: appliedFilters.endDateStr,
            dateBasisLabel,
            branchLabel,
            franchiseeLabel,
            callTypeLabel,
          },
          view: {
            tableView,
            tallyDetailLevel,
            includeTravelReimbursement,
          },
          tallyModel: tallyForPdf,
          monthlyModel: monthlyForPdf,
        },
        fileName
      );

      setPdfViewerUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(blob);
      });
      setPdfFileName(fileName);
      setPdfViewerOpen(true);
    } catch (err: unknown) {
      feedback.actionFailed(
        sanitizeUserFacingMessage(
          err instanceof Error ? err.message : 'Failed to generate PDF'
        )
      );
    } finally {
      setExportingPdf(false);
    }
  }, [
    appliedFilters,
    tableModel,
    canExportPdf,
    displayModel,
    monthlyBreakdown,
    tableView,
    tallyDetailLevel,
    includeTravelReimbursement,
    dateBasisLabel,
    branchLabel,
    franchiseeLabel,
    callTypeLabel,
  ]);

  const handleExportDetailCsv = useCallback(async () => {
    if (!appliedFilters || !tableModel || loading) return;

    const queryOpts = {
      startDate: appliedFilters.startDateStr,
      endDate: appliedFilters.endDateStr,
      dateFilterColumn: appliedFilters.arcpDateFilterColumn,
      callType: appliedFilters.callTypeParam,
      branch: appliedFilters.branchParam || undefined,
      franchisee: appliedFilters.franchiseeParam || undefined,
    };
    const exportPlan = resolveArcpClientDetailLoadPlan(queryOpts, loadEstimateHints);
    let detailChunkList = exportPlan.chunks;
    const useSingleDetailRequest = exportPlan.chunkCount <= 1;
    const detailPlanMessage = buildArcpDetailPlanMessage(
      exportPlan,
      appliedFilters.arcpDateFilterColumn
    );
    const detailExportOptions = {
      dateFilterColumn: appliedFilters.arcpDateFilterColumn,
      includeTravel: includeTravelReimbursement,
    };

    const reportDetailExportProgress = (
      done: number,
      etaMs: number,
      extra?: { failedCount?: number }
    ) => {
      setDetailExportRunningTotals({
        amountPayable: tableModel.totals.amountPayable,
        branchApproved: tableModel.totals.branchApproved,
        hoApproved: tableModel.totals.hoApproved,
      });
      setDetailExportStatus(
        toLoadStatus(
          { ...exportPlan, chunkCount: detailChunkList.length, chunks: detailChunkList },
          appliedFilters.arcpDateFilterColumn,
          done,
          etaMs,
          {
            planMessage: detailPlanMessage,
            rowsLoaded: runningDetailRows.length,
            failedCount: extra?.failedCount,
          }
        )
      );
    };

    setExportingDetail(true);
    setDetailExportRunningTotals(null);
    setDetailExportStatus(
      toLoadStatus(
        { ...exportPlan, chunkCount: detailChunkList.length, chunks: detailChunkList },
        appliedFilters.arcpDateFilterColumn,
        0,
        exportPlan.estimateMs,
        {
          planMessage: detailPlanMessage,
          rowsLoaded: 0,
        }
      )
    );

    const chunkTimings: number[] = [];
    let failedChunks = 0;
    let completedChunks = 0;
    const exportStartedAt = Date.now();

    const detailHeaders = await chunkedAuth.getAuthHeaders();
    const detailJobRes = await axios.post<ArcpLoadJobStartResponse>(
      '/api/report/arcp-claims/load-start',
      null,
      {
        headers: detailHeaders,
        params: { kind: 'detail', ...arcpFilterParams(appliedFilters) },
      }
    );
    const detailJob = detailJobRes.data;
    if (detailJob.error) throw new Error(detailJob.error);
    if (detailJob.chunks?.length) {
      detailChunkList = detailJob.chunks.map((c) => ({
        start: c.chunkStart,
        end: c.chunkEnd,
      }));
    }
    const detailJobId =
      detailJob.jobId && detailJob.jobsEnabled !== false ? detailJob.jobId : undefined;
    const detailChunkStatus = new Map(
      (detailJob.chunks ?? []).map((c) => [`${c.chunkStart}|${c.chunkEnd}`, c.status])
    );
    const detailCachedAtStart = detailJob.progress?.doneCount ?? 0;
    const detailChunkKey = (c: { start: string; end: string }) => `${c.start}|${c.end}`;
    const mergedDetailChunkKeys = new Set<string>();
    for (const c of detailJob.chunks ?? []) {
      if (c.status === 'done') {
        mergedDetailChunkKeys.add(detailChunkKey({ start: c.chunkStart, end: c.chunkEnd }));
      }
    }
    let runningDetailRows = mergeArcpDetailRows(detailJob.partialRows ?? []);
    failedChunks = detailJob.progress?.failedCount ?? 0;

    const countDetailChunksDone = () =>
      Math.min(
        detailChunkList.filter((c) => mergedDetailChunkKeys.has(detailChunkKey(c))).length,
        detailChunkList.length
      );

    const detailRequestParams = {
      ...arcpFilterParams(appliedFilters),
      ...(detailJobId ? { jobId: detailJobId } : {}),
    };

    try {
      if (useSingleDetailRequest) {
        const pendingDetail =
          (detailJob.progress?.pendingCount ?? 0) > 0 || failedChunks > 0;
        if (!pendingDetail) {
          if (runningDetailRows.length === 0) throw new Error('No detail rows to export');
          downloadPreparedDetailCsv(runningDetailRows);
          return;
        }

        const data = await chunkedAuth.getWithAuthRetry<{
          rows?: ArcpClaimsDetailRow[];
          meta?: { rowCount?: number; cachedChunks?: number };
          error?: string;
        }>('/api/report/arcp-claims/detail', {
          timeout: Math.max(exportPlan.estimateMs + 60_000, 300_000),
          params: detailRequestParams,
        });

        if (data.error) throw new Error(data.error);
        const fetched = mergeArcpDetailRows(data.rows ?? []);
        const rows =
          fetched.length > 0
            ? fetched
            : runningDetailRows.length > 0
              ? runningDetailRows
              : [];
        if (rows.length === 0) throw new Error('No detail rows to export');
        downloadPreparedDetailCsv(rows);
        return;
      }

      const detailChunksToFetch = detailJobId
        ? detailChunkList.filter((c) => detailChunkStatus.get(detailChunkKey(c)) !== 'done')
        : detailChunkList;

      await runPool(detailChunksToFetch, resolveArcpLoadConcurrency(queryOpts, exportPlan), async (chunk) => {
        const chunkStartedAt = Date.now();
        const key = detailChunkKey(chunk);

        try {
          const data = await chunkedAuth.getWithAuthRetry<{
            rows?: ArcpClaimsDetailRow[];
            meta?: { cachedChunks?: number };
            error?: string;
          }>(
            '/api/report/arcp-claims/detail',
            {
              timeout: 300000,
              params: {
                startDate: chunk.start,
                endDate: chunk.end,
                dateFilterColumn: appliedFilters.arcpDateFilterColumn,
                callType: appliedFilters.callTypeParam,
                ...(detailJobId ? { jobId: detailJobId } : {}),
                ...(appliedFilters.branchParam ? { branch: appliedFilters.branchParam } : {}),
                ...(appliedFilters.franchiseeParam
                  ? { franchisee: appliedFilters.franchiseeParam }
                  : {}),
              },
            },
            { chunkIndex: countDetailChunksDone() }
          );

          if (data.error) throw new Error(data.error);

          if (!mergedDetailChunkKeys.has(key)) {
            mergedDetailChunkKeys.add(key);
            runningDetailRows = mergeArcpDetailRows([
              ...runningDetailRows,
              ...(data.rows ?? []),
            ]);
          }
        } catch (chunkErr: unknown) {
          if (isChunkedFetchAbortError(chunkErr)) {
            return;
          }
          if (isChunkedFetchAuthError(chunkErr)) {
            throw chunkErr;
          }
          if (axios.isAxiosError(chunkErr) && chunkErr.response?.status === 401) {
            throw new Error('Session expired during export — please retry.');
          }
          failedChunks += 1;
        }

        chunkTimings.push(Math.max(Date.now() - chunkStartedAt, 1));
        const done = countDetailChunksDone();
        const elapsedMs = Date.now() - exportStartedAt;
        const etaMs =
          done > 0
            ? (elapsedMs / done) * Math.max(detailChunkList.length - done, 0)
            : exportPlan.estimateMs;

        reportDetailExportProgress(done, etaMs, {
          failedCount: failedChunks > 0 ? failedChunks : undefined,
        });
      });

      if (detailChunksToFetch.length === 0 && runningDetailRows.length > 0) {
        downloadPreparedDetailCsv(runningDetailRows);
        return;
      }

      if (failedChunks > 0) {
        throw new Error(
          `Export incomplete — ${failedChunks} of ${detailChunkList.length} period(s) failed to load. Narrow the date range or retry.`
        );
      }

      const rows = runningDetailRows;
      if (rows.length === 0) {
        throw new Error('No detail rows to export');
      }

      downloadPreparedDetailCsv(rows);
    } catch (err: unknown) {
      const message = isChunkedFetchNetworkError(err)
        ? 'Network error during export — sign in again if needed, then retry (localhost skips GoTrue token refresh).'
        : sanitizeUserFacingMessage(
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Failed to export detail CSV'
          );
      feedback.actionFailed(message);
    } finally {
      setExportingDetail(false);
      setDetailExportStatus(null);
      setDetailExportRunningTotals(null);
    }
  }, [
    appliedFilters,
    chunkedAuth,
    downloadPreparedDetailCsv,
    includeTravelReimbursement,
    loadEstimateHints,
    loading,
    tableModel,
  ]);

  const headerActions = (
    <ArcpClaimsHeaderActions
      onExportSummary={handleExportCsv}
      onViewPdf={() => void handleViewPdf()}
      onExportDetail={() => void handleExportDetailCsv()}
      exportSummaryDisabled={
        loading ||
        !appliedFilters ||
        !(displayModel ?? tableModel) ||
        (((displayModel ?? tableModel)?.rows.length ?? 0) === 0 &&
          tallyDetailLevel !== 'totals')
      }
      exportPdfDisabled={loading || exportingPdf || !canExportPdf}
      exportDetailDisabled={loading || exportingDetail || !appliedFilters || !tableModel}
      exportingPdf={exportingPdf}
      exportingDetail={exportingDetail}
    />
  );

  const toolbar = (
    <ArcpClaimsToolbar
      arcpDateFilterColumn={arcpDateFilterColumn}
      onDateFilterColumnChange={setArcpDateFilterColumn}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      callTypeOptions={callTypeOptions}
      selectedCallTypes={selectedCallTypes}
      onCallTypesChange={setSelectedCallTypes}
      onApply={handleApplyFilters}
      applyDisabled={loading || !resourcesLoaded}
      hasPendingFilterChanges={hasPendingFilterChanges}
      loading={loading}
      loadStatus={loadStatus}
      loadProgressLabel={appliedLoadPlan ? arcpChunkProgressLabel(appliedLoadPlan) : 'periods'}
    />
  );

  return (
    <PageShell
      title={
        <span className="inline-flex items-center gap-1">
          <GlossaryTerm term="ARCP" showIcon={false} />
          {' Claims'}
        </span>
      }
      subtitle={
        loading && !appliedFilters
          ? wideScopeLoad
            ? 'Loading all branches for this month…'
            : 'Loading your scope for this month…'
          : pageScopeSubtitle
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      actions={headerActions}
      toolbar={toolbar}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
    >
      <div className="flex shrink-0 flex-col">
      {pageAlert ? (
        <div className="px-3 pt-1">
          <PageAlert
            variant={pageAlert.variant}
            message={pageAlert.message}
            onDismiss={clearPageAlert}
          />
        </div>
      ) : null}

      {!loading && draftLoadPreview && (!appliedFilters || hasPendingFilterChanges) ? (
        <div className="px-3 pt-1">
          <ArcpClaimsLoadBanner status={draftLoadPreview} variant="preview" />
        </div>
      ) : null}

      {!loading &&
      wideScopeLoad &&
      appliedFilters &&
      !hasPendingFilterChanges &&
      draftLoadPlan.isLongLoad ? (
        <p className="px-3 pt-1 text-[10px] text-slate-500">
          All-branch loads are slower — narrow to a branch or franchisee to refresh faster.
        </p>
      ) : null}

      {appliedFilters &&
      (mergedAggregateRows.length > 0 ||
        (loading &&
          (summaryTotals.serviceLineCount > 0 ||
            summaryTotals.amountPayable > 0 ||
            summaryTotals.branchApproved > 0 ||
            summaryTotals.hoApproved > 0))) ? (
        <ArcpClaimsSummaryPanel
          totals={summaryTotals}
          tableView={tableView}
          onTableViewChange={setTableView}
          tallyGrouping={tallyGrouping}
          onTallyGroupingChange={setTallyGrouping}
          tallyDetailLevel={tallyDetailLevel}
          onTallyDetailLevelChange={setTallyDetailLevel}
          includeTravelReimbursement={includeTravelReimbursement}
          onIncludeTravelChange={setIncludeTravelReimbursement}
          categorySectionCount={categorySectionCount}
        />
      ) : null}

      {exportingDetail && detailExportStatus ? (
        <div className="px-3 pt-1">
          <ArcpClaimsLoadBanner
            status={detailExportStatus}
            variant="detail-export"
            runningTotals={detailExportRunningTotals}
          />
        </div>
      ) : null}

      {loading && loadStatus && !exportingDetail ? (
        <div className="px-3 pt-1">
          <ArcpClaimsLoadBanner
            status={loadStatus}
            runningTotals={
              summaryTotals.amountPayable > 0 ||
              summaryTotals.branchApproved > 0 ||
              summaryTotals.hoApproved > 0
                ? {
                    amountPayable: summaryTotals.amountPayable,
                    branchApproved: summaryTotals.branchApproved,
                    hoApproved: summaryTotals.hoApproved,
                  }
                : null
            }
          />
        </div>
      ) : null}
      </div>

      <PageScrollRegion>
      <div className="flex min-h-0 flex-1 flex-col">
      <AdminTableCard
        isEmpty={hasNoResults}
        empty={
          <>
            <p className="text-sm font-medium text-slate-600">No data available</p>
            <p className="text-[11px] text-slate-400">
              No claims match <span className="font-medium text-slate-500">{dateBasisLabel}</span>{' '}
              for {pageScopeSubtitle}. Try a different date basis or adjust your filters.
            </p>
          </>
        }
      >
        {!appliedFilters && loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            <p className="text-sm font-medium text-slate-600">
              {wideScopeLoad
                ? 'Loading ARCP tally for all branches this month…'
                : 'Loading ARCP tally for your scope…'}
            </p>
          </div>
        ) : !appliedFilters && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
            <p className="text-sm font-medium text-slate-600">Choose your filters, then click Apply Filter</p>
            <p className="text-[11px] text-slate-400">
              Date basis, range, branch, franchisee, and call type can all be set before loading.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-1">
            {tableView !== 'monthly' ? (
              <section>
                {tableView === 'both' ? (
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Service tally
                  </h3>
                ) : null}
                <ArcpClaimsTable
                  model={displayModel}
                  loading={loading && mergedAggregateRows.length === 0}
                  updating={loading && mergedAggregateRows.length > 0}
                />
              </section>
            ) : null}
            {tableView !== 'summary' ? (
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Monthly breakdown
                </h3>
                <p className="mb-2 text-[10px] text-slate-400">
                  Each month uses the active date basis (BM approval month when BM Call Approved is
                  selected).
                </p>
                <ArcpClaimsMonthlyTable
                  model={monthlyBreakdown}
                  loading={loading && (monthlyBreakdown?.rows.length ?? 0) === 0}
                  updating={loading && (monthlyBreakdown?.rows.length ?? 0) > 0}
                />
              </section>
            ) : null}
          </div>
        )}
      </AdminTableCard>
      </div>
      </PageScrollRegion>

      <ArcpClaimsPdfViewer
        open={pdfViewerOpen}
        pdfUrl={pdfViewerUrl}
        fileName={pdfFileName}
        onClose={closePdfViewer}
      />
    </PageShell>
  );
}
