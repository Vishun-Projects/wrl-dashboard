'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, RefreshCw, Download, FileText, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ArcpClaimsTable } from '@/components/arcp-claims/ArcpClaimsTable';
import {
  ArcpClaimsSummaryPanel,
  type ArcpTableViewMode,
} from '@/components/arcp-claims/ArcpClaimsSummaryPanel';
import { ArcpClaimsMonthlyTable } from '@/components/arcp-claims/ArcpClaimsMonthlyTable';
import {
  ArcpClaimsLoadBanner,
  formatArcpDurationMs,
  formatArcpFinishTime,
  type ArcpLoadStatus,
} from '@/components/arcp-claims/ArcpClaimsLoadBanner';
import { ArcpClaimsPdfViewer } from '@/components/arcp-claims/ArcpClaimsPdfViewer';
import { DateRangeSelector } from '@/components/register/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/components/register/RegisterBranchFranchiseeFilters';
import { RegisterMultiSelect } from '@/components/register/RegisterMultiSelect';
import { PageShell } from '@/components/layout/PageShell';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  ARCP_DATE_FILTER_OPTIONS,
  estimateArcpLoadPlan,
  resolveArcpClientLoadPlan,
  shouldUseClientSideArcpChunks,
  resolveArcpLoadConcurrency,
  estimateArcpDetailLoadPlan,
  deriveArcpGrandTotalsFromAggregates,
  mergeArcpAggregateRows,
  mergeArcpDetailRows,
  isArcpApproveDateColumn,
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
} from '@/lib/arcp-claims/table';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  joinFilterParam,
  toDateString,
} from '@/lib/report/filters';
import {
  createChunkedFetchAuth,
  isChunkedFetchAuthError,
} from '@/lib/supabase/chunked-fetch';
import { toast } from 'sonner';
import {
  logArcpFiltersApplied,
  logArcpLoadResult,
  logArcpTableModel,
  logArcpUiVsCsvTotals,
  logArcpDetailExportTotals,
} from '@/lib/arcp-claims/browser-debug';

type AppliedArcpFilters = {
  startDateStr: string;
  endDateStr: string;
  arcpDateFilterColumn: ArcpDateFilterColumn;
  branchParam: string;
  franchiseeParam: string;
  callTypeParam: string;
  selectedBranch: string[];
  selectedFranchisee: string[];
  selectedCallTypes: string[];
};

function appliedFiltersKey(filters: AppliedArcpFilters): string {
  return JSON.stringify({
    startDateStr: filters.startDateStr,
    endDateStr: filters.endDateStr,
    arcpDateFilterColumn: filters.arcpDateFilterColumn,
    branchParam: filters.branchParam,
    franchiseeParam: filters.franchiseeParam,
    callTypeParam: filters.callTypeParam,
  });
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

  if (
    dateFilterColumn === 'bm_approved_at' ||
    dateFilterColumn === 'ho_approved_at'
  ) {
    const parallelNote =
      resolveArcpLoadConcurrency({ dateFilterColumn }) > 1
        ? ` (up to ${resolveArcpLoadConcurrency({ dateFilterColumn })} in parallel)`
        : '';
    return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} weekly period(s)${parallelNote}. Est. ${eta}.`;
  }

  return `Loading ${plan.chunkCount} period(s) on ${basis} (est. ${eta}).`;
}

function buildArcpDetailPlanMessage(plan: ArcpLoadPlan, dateFilterColumn: ArcpDateFilterColumn): string {
  if (plan.chunkCount <= 1) {
    return `Fetching line-level detail for ${plan.spanDays} days.`;
  }

  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';
  const eta = formatArcpDurationMs(plan.estimateMs);

  return `${plan.spanDays}-day detail on ${basis} exports in ${plan.chunkCount} periods (est. ${eta}).`;
}

function toLoadStatus(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  done: number,
  etaMs: number,
  options?: { planMessage?: string; rowsLoaded?: number; scopedFilters?: boolean }
): ArcpLoadStatus {
  const total = plan.chunkCount;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const concurrency = resolveArcpLoadConcurrency({ dateFilterColumn });
  const inFlight = done < total && total > 1;

  return {
    done,
    total,
    percent,
    currentRange: inFlight
      ? concurrency > 1
        ? `up to ${concurrency} periods in parallel`
        : 'loading next weekly period'
      : null,
    etaRemainingLabel: done < total ? formatArcpDurationMs(etaMs) : null,
    etaFinishLabel: done < total ? formatArcpFinishTime(Date.now() + etaMs) : null,
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
  } = useReportFilters();

  const [arcpDateFilterColumn, setArcpDateFilterColumn] =
    useState<ArcpDateFilterColumn>('dcalllogdatetime');
  const [rawAggregateRows, setRawAggregateRows] = useState<ArcpClaimsAggregateRow[] | null>(null);
  const [includeTravelReimbursement, setIncludeTravelReimbursement] = useState(true);
  const [tableView, setTableView] = useState<ArcpTableViewMode>('both');
  const [tallyDetailLevel, setTallyDetailLevel] = useState<ArcpTallyDetailLevel>('full');
  const [loading, setLoading] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<ArcpLoadStatus | null>(null);
  const [detailExportStatus, setDetailExportStatus] = useState<ArcpLoadStatus | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<AppliedArcpFilters | null>(null);
  const [arcpCoverage, setArcpCoverage] = useState<ArcpPostgresCoverage | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);

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

  const draftQueryKey = useMemo(() => appliedFiltersKey(draftFilters), [draftFilters]);
  const appliedQueryKey = useMemo(
    () => (appliedFilters ? appliedFiltersKey(appliedFilters) : null),
    [appliedFilters]
  );
  const hasPendingFilterChanges = appliedQueryKey !== draftQueryKey;

  const mergedAggregateRows = useMemo(
    () => (rawAggregateRows ? mergeArcpAggregateRows(rawAggregateRows) : []),
    [rawAggregateRows]
  );

  const arcpLabelLookups = useMemo(() => {
    const callTypeLabelsByCode: Record<string, string> = {};
    for (const option of callTypeOptions) {
      if (option.value && option.label) {
        callTypeLabelsByCode[String(option.value)] = option.label;
      }
    }
    return { callTypeLabelsByCode };
  }, [callTypeOptions]);

  const tableModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: includeTravelReimbursement,
      ...arcpLabelLookups,
    });
  }, [mergedAggregateRows, includeTravelReimbursement, arcpLabelLookups]);

  const fullModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: true,
      ...arcpLabelLookups,
    });
  }, [mergedAggregateRows, arcpLabelLookups]);

  /** Same totals as Summary CSV export (fullModel), not a separate SQL grand-total query. */
  const summaryTotals = useMemo(() => {
    const lineCounts = deriveArcpGrandTotalsFromAggregates(mergedAggregateRows);
    const exportTotals = fullModel?.totals ?? tableModel?.totals;
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
    if (!appliedFilters || !displayModel) return;
    logArcpTableModel(
      {
        startDateStr: appliedFilters.startDateStr,
        endDateStr: appliedFilters.endDateStr,
        arcpDateFilterColumn: appliedFilters.arcpDateFilterColumn,
        branchParam: appliedFilters.branchParam,
        franchiseeParam: appliedFilters.franchiseeParam,
        callTypeParam: appliedFilters.callTypeParam,
      },
      displayModel
    );
  }, [appliedFilters, displayModel]);

  useEffect(() => {
    if (loading || !appliedFilters || mergedAggregateRows.length === 0) return;
    const { serviceLineCount, amountPayable, branchApproved, hoApproved } = summaryTotals;
    if (serviceLineCount > 0 && amountPayable === 0 && branchApproved === 0 && hoApproved === 0) {
      toast.warning(
        'Rows loaded but Amount Payable / Branch / HO are all zero for this date basis. Try a wider range or Call Date filter.',
        { duration: 8000 }
      );
    }
  }, [loading, appliedFilters, mergedAggregateRows.length, summaryTotals]);

  const monthlyBreakdown = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsMonthlyBreakdown(mergedAggregateRows, {
      includeTravel: includeTravelReimbursement,
    });
  }, [mergedAggregateRows, includeTravelReimbursement]);

  useEffect(() => {
    if (loading || !appliedFilters || mergedAggregateRows.length === 0 || !fullModel) return;

    let mergedAmount = 0;
    let mergedBranch = 0;
    let mergedHo = 0;
    let mergedQty = 0;
    let mergedTravelBranch = 0;
    for (const row of mergedAggregateRows) {
      mergedQty += Number(row.qty) || 0;
      mergedAmount += Number(row.amount_payable) || 0;
      mergedBranch += Number(row.branch_approved) || 0;
      mergedHo += Number(row.ho_approved) || 0;
      if (Number(row.is_travel) === 1) {
        mergedTravelBranch += Number(row.branch_approved) || 0;
      }
    }
    let uiTravelBranch = 0;
    for (const r of fullModel.rows) {
      if (r.kind === 'travel') uiTravelBranch += r.branchApproved;
    }

    logArcpUiVsCsvTotals({
      includeTravelReimbursement,
      rawAggregateCount: rawAggregateRows?.length ?? 0,
      mergedAggregateCount: mergedAggregateRows.length,
      mergedRowsSum: {
        amountPayable: mergedAmount,
        branchApproved: mergedBranch,
        hoApproved: mergedHo,
        qty: mergedQty,
      },
      tableModelFromRows: {
        amountPayable: tableModel?.totals.amountPayable ?? 0,
        branchApproved: tableModel?.totals.branchApproved ?? 0,
        hoApproved: tableModel?.totals.hoApproved ?? 0,
        qty: tableModel?.totals.qty ?? 0,
      },
      tableModelDisplayed: {
        amountPayable: tableModel?.totals.amountPayable ?? 0,
        branchApproved: tableModel?.totals.branchApproved ?? 0,
        hoApproved: tableModel?.totals.hoApproved ?? 0,
        qty: tableModel?.totals.qty ?? 0,
      },
      fullModelCsv: {
        amountPayable: fullModel.totals.amountPayable,
        branchApproved: fullModel.totals.branchApproved,
        hoApproved: fullModel.totals.hoApproved,
        qty: fullModel.totals.qty,
      },
      summaryPanel: {
        amountPayable: summaryTotals.amountPayable,
        branchApproved: summaryTotals.branchApproved,
        hoApproved: summaryTotals.hoApproved,
      },
      grandTotalsApi: null,
      monthlyFromRaw: null,
      monthlyFromMerged: monthlyBreakdown
        ? { amountPayable: monthlyBreakdown.totals.amountPayable }
        : null,
      totalsOverriddenByGrandTotals: false,
      uiTravelBranchApproved: uiTravelBranch,
      mergedTravelBranchApproved: mergedTravelBranch,
    });
  }, [
    loading,
    appliedFilters,
    mergedAggregateRows,
    rawAggregateRows,
    fullModel,
    tableModel,
    summaryTotals,
    includeTravelReimbursement,
    monthlyBreakdown,
  ]);

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

  const draftLoadPreview = useMemo((): ArcpLoadStatus | null => {
    if (!draftLoadPlan.isLongLoad || loading) return null;
    return toLoadStatus(draftLoadPlan, arcpDateFilterColumn, 0, draftLoadPlan.estimateMs);
  }, [draftLoadPlan, arcpDateFilterColumn, loading]);

  const loadData = useCallback(
    async (
      filters: AppliedArcpFilters,
      refresh = false,
      signal?: AbortSignal,
      generation = 0
    ) => {
      setLoading(true);
      setLoadError(null);

      const isStale = () => generation !== loadGenerationRef.current || signal?.aborted;
      const loadStartedAt = Date.now();

      logArcpFiltersApplied(
        {
          startDateStr: filters.startDateStr,
          endDateStr: filters.endDateStr,
          arcpDateFilterColumn: filters.arcpDateFilterColumn,
          branchParam: filters.branchParam,
          franchiseeParam: filters.franchiseeParam,
          callTypeParam: filters.callTypeParam,
        },
        refresh ? 'refresh' : 'apply'
      );

      const queryOpts = {
        startDate: filters.startDateStr,
        endDate: filters.endDateStr,
        dateFilterColumn: filters.arcpDateFilterColumn,
        callType: filters.callTypeParam,
        branch: filters.branchParam || undefined,
        franchisee: filters.franchiseeParam || undefined,
      };
      const loadPlan = resolveArcpClientLoadPlan(queryOpts, loadEstimateHints);
      const useClientChunks = shouldUseClientSideArcpChunks(queryOpts, loadEstimateHints);
      const scopedFilters = Boolean(filters.branchParam || filters.franchiseeParam);
      const chunks = loadPlan.chunks;
      const chunkTimings: number[] = [];

      if (!isStale()) {
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
        const chunkTimeoutMs = useClientChunks
          ? filters.arcpDateFilterColumn === 'bm_approved_at' ||
            filters.arcpDateFilterColumn === 'ho_approved_at'
            ? 120_000
            : 300_000
          : loadPlan.crmChunkCount > 0
            ? Math.max(loadPlan.estimateMs + 60_000, 300_000)
            : Math.max(loadPlan.estimateMs + 30_000, 90_000);

        return chunkedAuth.getWithAuthRetry<{
          aggregates?: ArcpClaimsAggregateRow[];
          meta?: { source?: string; cached?: boolean };
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
              ...(filters.branchParam ? { branch: filters.branchParam } : {}),
              ...(filters.franchiseeParam ? { franchisee: filters.franchiseeParam } : {}),
              ...(refresh ? { refresh: 'true' } : {}),
            },
          },
          { chunkIndex }
        );
      };

      try {
        const partialAggregates: (ArcpClaimsAggregateRow[] | undefined)[] = new Array(chunks.length);
        let failedChunks = 0;
        let completedChunks = 0;
        let usedCrmFallback = false;

        if (!useClientChunks) {
          try {
            const data = await fetchAggregateChunk(chunks[0], 0);
            if (isStale()) return;
            if (data.error) throw new Error(data.error);
            if (data.meta?.source === 'crm_fallback') usedCrmFallback = true;
            const rawAggregates = mergeArcpAggregateRows(data.aggregates ?? []);
            if (!isStale()) {
              setRawAggregateRows(rawAggregates);
              setLoadStatus(
                toLoadStatus(loadPlan, filters.arcpDateFilterColumn, 1, 0, {
                  scopedFilters,
                  rowsLoaded: rawAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0),
                })
              );
            }
            logArcpLoadResult(
              {
                startDateStr: filters.startDateStr,
                endDateStr: filters.endDateStr,
                arcpDateFilterColumn: filters.arcpDateFilterColumn,
                branchParam: filters.branchParam,
                franchiseeParam: filters.franchiseeParam,
                callTypeParam: filters.callTypeParam,
              },
              rawAggregates,
              {
                durationMs: Date.now() - loadStartedAt,
                chunks: 1,
                failedChunks: 0,
                dataSource: usedCrmFallback ? 'crm_fallback' : 'postgres',
              }
            );
            /* no toast when supplemental periods were merged — avoid exposing data source */
          } catch (singleErr: unknown) {
            if (axios.isCancel(singleErr) || (singleErr instanceof DOMException && singleErr.name === 'AbortError')) {
              return;
            }
            if (isChunkedFetchAuthError(singleErr)) {
              throw singleErr;
            }
            const message = sanitizeUserFacingMessage(
              axios.isAxiosError(singleErr) && singleErr.response?.data?.error
                ? String(singleErr.response.data.error)
                : singleErr instanceof Error
                  ? singleErr.message
                  : 'Failed to load ARCP claims'
            );
            throw new Error(message);
          }
        } else {
        await runPool(chunks, resolveArcpLoadConcurrency(queryOpts), async (chunk, i) => {
          if (isStale()) return;

          const chunkStartedAt = Date.now();

          try {
            const data = await fetchAggregateChunk(chunk, i);

            if (isStale()) return;
            if (data.error) throw new Error(data.error);

            if (data.meta?.source === 'crm_fallback') usedCrmFallback = true;

            partialAggregates[i] = data.aggregates ?? [];
            if (!isStale()) {
              setRawAggregateRows(
                mergeArcpAggregateRows(
                  partialAggregates.filter((r): r is ArcpClaimsAggregateRow[] => r != null).flat()
                )
              );
            }
          } catch (chunkErr: unknown) {
            if (axios.isCancel(chunkErr) || (chunkErr instanceof DOMException && chunkErr.name === 'AbortError')) {
              return;
            }
            if (isChunkedFetchAuthError(chunkErr)) {
              throw chunkErr;
            }
            failedChunks += 1;
          }

          chunkTimings.push(Math.max(Date.now() - chunkStartedAt, 1));
          completedChunks += 1;
          const done = completedChunks;
          const elapsedMs = Date.now() - loadStartedAt;
          const etaMs =
            done > 0
              ? (elapsedMs / done) * Math.max(chunks.length - done, 0)
              : loadPlan.estimateMs;

          if (!isStale()) {
            setLoadStatus(toLoadStatus(loadPlan, filters.arcpDateFilterColumn, done, etaMs, {
              scopedFilters,
            }));
          }
        });

        const rawAggregates = mergeArcpAggregateRows(
          partialAggregates.filter((r): r is ArcpClaimsAggregateRow[] => r != null).flat()
        );

        if (!isStale()) {
          setRawAggregateRows(rawAggregates);
        }

        logArcpLoadResult(
          {
            startDateStr: filters.startDateStr,
            endDateStr: filters.endDateStr,
            arcpDateFilterColumn: filters.arcpDateFilterColumn,
            branchParam: filters.branchParam,
            franchiseeParam: filters.franchiseeParam,
            callTypeParam: filters.callTypeParam,
          },
          rawAggregates,
          {
            durationMs: Date.now() - loadStartedAt,
            chunks: chunks.length,
            failedChunks,
            dataSource: usedCrmFallback ? 'crm_fallback' : 'postgres',
          }
        );

        if (failedChunks > 0 && !isStale()) {
          const partialMessage =
            rawAggregates.length > 0
              ? `Loaded partial tally — ${failedChunks} of ${chunks.length} period(s) timed out. Narrow filters or retry.`
              : 'Failed to load ARCP claims — all periods timed out for this range.';
          if (rawAggregates.length === 0) {
            throw new Error(partialMessage);
          }
          setLoadError(partialMessage);
          toast.warning(partialMessage);
        }
        }
      } catch (err: unknown) {
        if (isStale()) return;
        if (axios.isCancel(err) || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const message = sanitizeUserFacingMessage(
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load ARCP claims'
        );
        setLoadError(message);
        toast.error(message);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setLoadStatus(null);
        }
      }
    },
    [chunkedAuth, loadEstimateHints]
  );

  const runLoad = useCallback(
    (filters: AppliedArcpFilters, refresh = false) => {
      loadAbortRef.current?.abort();
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      const controller = new AbortController();
      loadAbortRef.current = controller;

      void loadData(filters, refresh, controller.signal, generation).finally(() => {
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

    setAppliedFilters(nextFilters);
    setRawAggregateRows(null);

    if (readArcpFromPostgresClient()) {
      toast.info(buildArcpPlanMessage(draftLoadPlan, arcpDateFilterColumn, true), {
        duration: 7000,
      });
    } else if (draftLoadPlan.isLongLoad) {
      toast.info(
        `Loading ${draftLoadPlan.spanDays} days in ${draftLoadPlan.chunkCount} periods (${formatArcpDurationMs(draftLoadPlan.estimateMs)}). Progress updates below.`,
        { duration: 7000 }
      );
    }

    runLoad(nextFilters, true);
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
    draftLoadPlan,
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
    if (!appliedFilters || !fullModel || fullModel.rows.length === 0) {
      toast.error('No data to export');
      return;
    }

    const fileName = `ARCP_Claims_Summary_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
    downloadArcpClaimsCsv(fullModel, fileName);
    toast.success('Summary CSV exported');
  }, [appliedFilters, fullModel]);

  const handleViewPdf = useCallback(async () => {
    if (!appliedFilters || !tableModel || !canExportPdf) {
      toast.error('No data to preview');
      return;
    }

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
      toast.error(
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
    if (!appliedFilters) {
      toast.error('Apply filters before exporting detail');
      return;
    }

    const queryOpts = {
      startDate: appliedFilters.startDateStr,
      endDate: appliedFilters.endDateStr,
      dateFilterColumn: appliedFilters.arcpDateFilterColumn,
      callType: appliedFilters.callTypeParam,
      branch: appliedFilters.branchParam || undefined,
      franchisee: appliedFilters.franchiseeParam || undefined,
    };
    const exportPlan = estimateArcpDetailLoadPlan(queryOpts, loadEstimateHints);
    const chunks = exportPlan.chunks;
    const detailPlanMessage = buildArcpDetailPlanMessage(
      exportPlan,
      appliedFilters.arcpDateFilterColumn
    );

    if (exportPlan.isLongLoad) {
      toast.info(
        `Exporting detail in ${exportPlan.chunkCount} periods (${formatArcpDurationMs(exportPlan.estimateMs)}). Progress shown below.`,
        { duration: 8000 }
      );
    }

    setExportingDetail(true);
    setDetailExportStatus(
      toLoadStatus(exportPlan, appliedFilters.arcpDateFilterColumn, 0, exportPlan.estimateMs, {
        planMessage: detailPlanMessage,
        rowsLoaded: 0,
      })
    );

    const chunkTimings: number[] = [];
    const partialDetailRows: (ArcpClaimsDetailRow[] | undefined)[] = new Array(chunks.length);
    let failedChunks = 0;
    let completedChunks = 0;
    const exportStartedAt = Date.now();

    try {
      if (readArcpFromPostgresClient()) {
        const data = await chunkedAuth.getWithAuthRetry<{
          rows?: ArcpClaimsDetailRow[];
          meta?: { source?: string };
          error?: string;
        }>('/api/report/arcp-claims/detail', {
          timeout: Math.max(exportPlan.estimateMs + 60_000, 300_000),
          params: {
            startDate: appliedFilters.startDateStr,
            endDate: appliedFilters.endDateStr,
            dateFilterColumn: appliedFilters.arcpDateFilterColumn,
            callType: appliedFilters.callTypeParam,
            ...(appliedFilters.branchParam ? { branch: appliedFilters.branchParam } : {}),
            ...(appliedFilters.franchiseeParam
              ? { franchisee: appliedFilters.franchiseeParam }
              : {}),
          },
        });

        if (data.error) throw new Error(data.error);
        const rows = mergeArcpDetailRows(data.rows ?? []);
        if (rows.length === 0) throw new Error('No detail rows to export');
        logArcpDetailExportTotals(rows);
        /* no source toast on detail export */
        const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
        downloadArcpClaimsDetailCsv(rows, fileName);
        toast.success(`Exported ${rows.length.toLocaleString('en-IN')} detail rows`);
        return;
      }

      await runPool(chunks, resolveArcpLoadConcurrency(queryOpts), async (chunk, i) => {
        const chunkStartedAt = Date.now();

        try {
          const data = await chunkedAuth.getWithAuthRetry<{
            rows?: ArcpClaimsDetailRow[];
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
                ...(appliedFilters.branchParam ? { branch: appliedFilters.branchParam } : {}),
                ...(appliedFilters.franchiseeParam
                  ? { franchisee: appliedFilters.franchiseeParam }
                  : {}),
              },
            },
            { chunkIndex: i }
          );

          if (data.error) throw new Error(data.error);

          partialDetailRows[i] = data.rows ?? [];
        } catch (chunkErr: unknown) {
          if (isChunkedFetchAuthError(chunkErr)) {
            throw chunkErr;
          }
          if (axios.isAxiosError(chunkErr) && chunkErr.response?.status === 401) {
            throw new Error('Session expired during export — please retry.');
          }
          failedChunks += 1;
        }

        chunkTimings.push(Math.max(Date.now() - chunkStartedAt, 1));
        completedChunks += 1;
        const done = completedChunks;
        const elapsedMs = Date.now() - exportStartedAt;
        const etaMs =
          done > 0
            ? (elapsedMs / done) * Math.max(chunks.length - done, 0)
            : exportPlan.estimateMs;

        setDetailExportStatus(
          toLoadStatus(exportPlan, appliedFilters.arcpDateFilterColumn, done, etaMs, {
            planMessage: detailPlanMessage,
            rowsLoaded: mergeArcpDetailRows(
              partialDetailRows.filter((r): r is ArcpClaimsDetailRow[] => r != null).flat()
            ).length,
          })
        );
      });

      const rows = mergeArcpDetailRows(
        partialDetailRows.filter((r): r is ArcpClaimsDetailRow[] => r != null).flat()
      );
      if (rows.length === 0) {
        throw new Error('No detail rows to export');
      }

      logArcpDetailExportTotals(rows);
      const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
      downloadArcpClaimsDetailCsv(rows, fileName);

      if (failedChunks > 0) {
        toast.warning(
          `Detail CSV exported with ${rows.length.toLocaleString('en-IN')} rows — ${failedChunks} period(s) failed; data may be partial.`
        );
      } else {
        toast.success(`Detail CSV exported (${rows.length.toLocaleString('en-IN')} rows)`);
      }
    } catch (err: unknown) {
      toast.error(
        sanitizeUserFacingMessage(
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to export detail CSV'
        )
      );
    } finally {
      setExportingDetail(false);
      setDetailExportStatus(null);
    }
  }, [appliedFilters, chunkedAuth]);

  const approveHintColumn = appliedFilters?.arcpDateFilterColumn ?? arcpDateFilterColumn;
  const showApproveDateHint = isArcpApproveDateColumn(approveHintColumn) && !loading;

  const toolbar = (
    <div className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">Date basis</legend>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Date basis
            </span>
            {ARCP_DATE_FILTER_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-700"
              >
                <input
                  type="radio"
                  name="arcp-date-basis"
                  value={option.value}
                  checked={arcpDateFilterColumn === option.value}
                  onChange={() => setArcpDateFilterColumn(option.value)}
                  className="h-3.5 w-3.5 border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <DateRangeSelector
            value={dateRange.label}
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={setDateRange}
          />
        </div>

        <div className="report-toolbar-filters-row">
          <RegisterBranchFranchiseeFilters applyMode="confirm" layout="inline" />
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleApplyFilters}
            disabled={loading || !resourcesLoaded}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium shadow-sm disabled:opacity-50 ${
              hasPendingFilterChanges
                ? 'border border-slate-800 bg-slate-900 text-white hover:bg-slate-800'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              if (!appliedFilters) {
                handleApplyFilters();
                return;
              }
              runLoad(appliedFilters, true);
              toast.info('Reloading tally (server cache cleared)', { duration: 3000 });
            }}
            disabled={loading || !resourcesLoaded}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || !appliedFilters || !fullModel || fullModel.rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export Summary CSV
          </button>
          <button
            type="button"
            onClick={() => void handleViewPdf()}
            disabled={loading || exportingPdf || !canExportPdf}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            <FileText className={`h-3.5 w-3.5 ${exportingPdf ? 'animate-pulse' : ''}`} />
            {exportingPdf ? 'Opening PDF…' : 'View PDF'}
          </button>
          <button
            type="button"
            onClick={() => void handleExportDetailCsv()}
            disabled={loading || exportingDetail || !appliedFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className={`h-3.5 w-3.5 ${exportingDetail ? 'animate-pulse' : ''}`} />
            {exportingDetail ? 'Exporting Detail…' : 'Export Detail CSV'}
          </button>
        </div>
        </div>

        {showApproveDateHint ? (
          <aside
            className="min-w-0 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-snug text-amber-950 lg:max-w-[min(20rem,36%)] lg:self-center"
            aria-live="polite"
          >
            <strong>{dateBasisLabel}</strong> only includes lines whose{' '}
            {approveHintColumn === 'bm_approved_at' ? 'BM approval date' : 'HO approval date'} falls
            in this range — not when the call was logged or solved. Amount Payable, Branch Approved,
            and HO Approved still apply to those lines, but the row set is usually smaller than Call
            Date for the same calendar range.
          </aside>
        ) : null}
      </div>
    </div>
  );

  return (
    <PageShell
      title="ARCP Claims"
      subtitle={
        appliedFilters
          ? `${appliedFilters.startDateStr} → ${appliedFilters.endDateStr}`
          : 'Set filters and click Apply Filter'
      }
      icon={<FileSpreadsheet className="h-4 w-4" />}
      toolbar={toolbar}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 p-4"
    >
      {loadError ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {loadError}
        </div>
      ) : null}

      {appliedFilters && mergedAggregateRows.length > 0 && !loading ? (
        <ArcpClaimsSummaryPanel
          totals={summaryTotals}
          tableView={tableView}
          onTableViewChange={setTableView}
          tallyDetailLevel={tallyDetailLevel}
          onTallyDetailLevelChange={setTallyDetailLevel}
          includeTravelReimbursement={includeTravelReimbursement}
          onIncludeTravelChange={setIncludeTravelReimbursement}
          categorySectionCount={categorySectionCount}
        />
      ) : null}

      {loading && loadStatus ? (
        <ArcpClaimsLoadBanner status={loadStatus} runningTotals={displayModel?.totals ?? null} />
      ) : null}

      {exportingDetail && detailExportStatus ? (
        <ArcpClaimsLoadBanner status={detailExportStatus} variant="detail-export" />
      ) : null}

      {!loading && draftLoadPreview && (!appliedFilters || hasPendingFilterChanges) ? (
        <ArcpClaimsLoadBanner status={draftLoadPreview} variant="preview" />
      ) : null}

      <AdminTableCard isEmpty={false}>
        {!appliedFilters && !loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
            <p className="text-sm font-medium text-slate-600">Choose your filters, then click Apply Filter</p>
            <p className="text-[11px] text-slate-400">
              Date basis, range, branch, franchisee, and call type can all be set before loading.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-1">
            {tableView !== 'monthly' ? (
              <section className="min-h-0 flex-1">
                {tableView === 'both' ? (
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Service tally
                  </h3>
                ) : null}
                <ArcpClaimsTable model={displayModel} loading={loading} />
              </section>
            ) : null}
            {tableView !== 'summary' ? (
              <section className={tableView === 'both' ? 'shrink-0' : 'min-h-0 flex-1'}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Monthly breakdown
                </h3>
                <p className="mb-2 text-[10px] text-slate-400">
                  Each month uses the active date filter (HO approval month when HO Call Approved is
                  selected).
                </p>
                <ArcpClaimsMonthlyTable model={monthlyBreakdown} loading={loading} />
              </section>
            ) : null}
          </div>
        )}
      </AdminTableCard>

      <ArcpClaimsPdfViewer
        open={pdfViewerOpen}
        pdfUrl={pdfViewerUrl}
        fileName={pdfFileName}
        onClose={closePdfViewer}
      />
    </PageShell>
  );
}
