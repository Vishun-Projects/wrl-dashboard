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
  resolveArcpClientDetailLoadPlan,
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
  appliedArcpFiltersKey,
  filtersFromLoadJobSnapshot,
  type ArcpAppliedFiltersSnapshot,
} from '@/lib/arcp-claims/applied-filters';

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

  if (dateFilterColumn === 'bm_approved_at') {
    const parallelNote =
      resolveArcpLoadConcurrency({ dateFilterColumn }) > 1
        ? ` (up to ${resolveArcpLoadConcurrency({ dateFilterColumn })} in parallel)`
        : '';
    const periodLabel =
      plan.chunkCount > 14 ? 'daily' : plan.chunkCount > 4 ? 'short' : 'weekly';
    return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} ${periodLabel} period(s)${parallelNote}. Est. ${eta}. Tally updates as each period completes.`;
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
        : total > 14
          ? 'loading next day'
          : 'loading next period'
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
  const resumeAttemptedRef = useRef(false);

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

  const draftQueryKey = useMemo(() => appliedArcpFiltersKey(draftFilters), [draftFilters]);
  const appliedQueryKey = useMemo(
    () => (appliedFilters ? appliedArcpFiltersKey(appliedFilters) : null),
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

      let jobId: string | undefined;
      let jobChunkStatus = new Map<string, ArcpLoadJobChunkRow['status']>();
      let cachedAtStart = 0;
      let pendingAtStart = chunks.length;
      let runningAggregates: ArcpClaimsAggregateRow[] = [];

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
      if (isStale()) return;
      const jobStart = jobStartRes.data;
      if (jobStart.error) throw new Error(jobStart.error);

      if (jobStart.jobId && jobStart.jobsEnabled !== false) {
        jobId = jobStart.jobId;
        jobChunkStatus = new Map(
          (jobStart.chunks ?? []).map((c) => [`${c.chunkStart}|${c.chunkEnd}`, c.status])
        );
        cachedAtStart = jobStart.progress?.doneCount ?? 0;
        pendingAtStart = jobStart.progress?.pendingCount ?? chunks.length;
        runningAggregates = mergeArcpAggregateRows(jobStart.partialAggregates ?? []);

        if (!isStale()) {
          setRawAggregateRows(runningAggregates);
          setLoadStatus(
            toLoadStatus(loadPlan, filters.arcpDateFilterColumn, cachedAtStart, loadPlan.estimateMs, {
              scopedFilters,
              planMessage: buildArcpJobResumeMessage(
                cachedAtStart,
                jobStart.progress?.totalChunks ?? chunks.length,
                pendingAtStart
              ),
              rowsLoaded: runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0) || undefined,
            })
          );
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

      try {
        let failedChunks = jobStart.progress?.failedCount ?? 0;
        let chunksToFetch = useClientChunks
          ? chunks.filter(
              (c) => jobChunkStatus.get(`${c.start}|${c.end}`) !== 'done'
            )
          : pendingAtStart > 0 || failedChunks > 0
            ? chunks
            : [];

        if (
          chunksToFetch.length === 0 &&
          runningAggregates.length === 0 &&
          chunks.length > 0
        ) {
          chunksToFetch = chunks;
          cachedAtStart = 0;
          pendingAtStart = chunks.length;
        }

        if (chunksToFetch.length === 0) {
          if (!isStale()) {
            setRawAggregateRows(runningAggregates);
          }
        } else if (!useClientChunks) {
          try {
            const data = await fetchAggregateChunk(chunks[0], 0);
            if (isStale()) return;
            if (data.error) throw new Error(data.error);
            runningAggregates = mergeArcpAggregateRows([
              ...runningAggregates,
              ...(data.aggregates ?? []),
            ]);
            if (!isStale()) {
              setRawAggregateRows(runningAggregates);
              setLoadStatus(
                toLoadStatus(loadPlan, filters.arcpDateFilterColumn, chunks.length, 0, {
                  scopedFilters,
                  rowsLoaded: runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0),
                })
              );
            }
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
          let completedChunks = cachedAtStart;

          await runPool(chunksToFetch, resolveArcpLoadConcurrency(queryOpts), async (chunk) => {
            if (isStale()) return;

            const chunkStartedAt = Date.now();

            try {
              const data = await fetchAggregateChunk(chunk, completedChunks);

              if (isStale()) return;
              if (data.error) throw new Error(data.error);

              runningAggregates = mergeArcpAggregateRows([
                ...runningAggregates,
                ...(data.aggregates ?? []),
              ]);
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
              done > cachedAtStart
                ? (elapsedMs / (done - cachedAtStart)) *
                  Math.max(chunks.length - done, 0)
                : loadPlan.estimateMs;

            if (!isStale()) {
              setRawAggregateRows(runningAggregates);
              const lineQty = runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0);
              setLoadStatus(
                toLoadStatus(loadPlan, filters.arcpDateFilterColumn, done, etaMs, {
                  scopedFilters,
                  rowsLoaded: lineQty > 0 ? lineQty : undefined,
                })
              );
            }
          });
        }

        if (!isStale()) {
          setRawAggregateRows(runningAggregates);
        }

        if (!isStale() && cachedAtStart > 0 && runningAggregates.length > 0) {
          toast.info(
            buildArcpJobResumeMessage(
              cachedAtStart,
              jobStart.progress?.totalChunks ?? chunks.length,
              pendingAtStart
            )
          );
        }

        if (failedChunks > 0 && !isStale()) {
          const partialMessage =
            runningAggregates.length > 0
              ? `Loaded partial tally — ${failedChunks} of ${chunks.length} period(s) timed out. Narrow filters or retry.`
              : 'Failed to load ARCP claims — all periods timed out for this range.';
          if (runningAggregates.length === 0) {
            throw new Error(partialMessage);
          }
          const userPartialMessage = sanitizeUserFacingMessage(partialMessage);
          setLoadError(userPartialMessage);
          toast.warning(userPartialMessage);
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
    draftLoadPlan,
  ]);

  useEffect(() => {
    if (!resourcesLoaded || resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;

    void (async () => {
      try {
        const status = await chunkedAuth.getWithAuthRetry<{
          jobId?: string;
          resumable?: boolean;
          filters?: Record<string, unknown>;
          partialAggregates?: ArcpClaimsAggregateRow[];
          progress?: {
            totalChunks: number;
            doneCount: number;
            pendingCount: number;
          };
          job?: null;
          error?: string;
        }>('/api/report/arcp-claims/load-status', {
          params: { kind: 'agg', latest: 'true' },
        });

        if (!status.jobId || !status.resumable) return;

        const restored = filtersFromLoadJobSnapshot(status.filters ?? {});
        if (!restored) return;

        setArcpDateFilterColumn(restored.arcpDateFilterColumn);
        setDateRange({
          start: new Date(`${restored.startDateStr}T00:00:00`),
          end: new Date(`${restored.endDateStr}T00:00:00`),
          label: `${restored.startDateStr} → ${restored.endDateStr}`,
        });
        setAppliedFilters(restored);
        if (status.partialAggregates?.length) {
          setRawAggregateRows(mergeArcpAggregateRows(status.partialAggregates));
        } else {
          setRawAggregateRows(null);
        }

        const done = status.progress?.doneCount ?? 0;
        const total = status.progress?.totalChunks ?? done;
        const pending = status.progress?.pendingCount ?? 0;
        const hasPartial = (status.partialAggregates?.length ?? 0) > 0;
        if (hasPartial || pending > 0) {
          toast.info(buildArcpJobResumeMessage(done, total, pending), { duration: 6000 });
        } else {
          toast.info('Resuming ARCP load…', { duration: 4000 });
        }
        runLoad(restored, false);
      } catch {
        /* no resumable job */
      }
    })();
  }, [resourcesLoaded, runLoad, chunkedAuth, setDateRange]);

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
    const exportPlan = resolveArcpClientDetailLoadPlan(queryOpts, loadEstimateHints);
    const chunks = exportPlan.chunks;
    const useSingleDetailRequest = exportPlan.chunkCount <= 1;
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
    const detailJobId =
      detailJob.jobId && detailJob.jobsEnabled !== false ? detailJob.jobId : undefined;
    const detailChunkStatus = new Map(
      (detailJob.chunks ?? []).map((c) => [`${c.chunkStart}|${c.chunkEnd}`, c.status])
    );
    const detailCachedAtStart = detailJob.progress?.doneCount ?? 0;
    let runningDetailRows = mergeArcpDetailRows(detailJob.partialRows ?? []);
    failedChunks = detailJob.progress?.failedCount ?? 0;

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
          const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
          downloadArcpClaimsDetailCsv(runningDetailRows, fileName);
          toast.success(
            `Exported ${runningDetailRows.length.toLocaleString('en-IN')} lines (${detailCachedAtStart} period(s) from server cache) — SUM(Raw BM Approved) is per-line from CRM`
          );
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
        const rows = mergeArcpDetailRows([...runningDetailRows, ...(data.rows ?? [])]);
        if (rows.length === 0) throw new Error('No detail rows to export');
        const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
        downloadArcpClaimsDetailCsv(rows, fileName);
        const cacheNote =
          detailCachedAtStart > 0 ? ` (${detailCachedAtStart} period(s) from server cache)` : '';
        toast.success(
          `Exported ${rows.length.toLocaleString('en-IN')} lines${cacheNote} — SUM(Raw BM Approved) is per-line from CRM`
        );
        return;
      }

      const detailChunksToFetch = detailJobId
        ? chunks.filter((c) => detailChunkStatus.get(`${c.start}|${c.end}`) !== 'done')
        : chunks;
      completedChunks = detailCachedAtStart;

      await runPool(detailChunksToFetch, resolveArcpLoadConcurrency(queryOpts), async (chunk) => {
        const chunkStartedAt = Date.now();

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
            { chunkIndex: completedChunks }
          );

          if (data.error) throw new Error(data.error);

          runningDetailRows = mergeArcpDetailRows([
            ...runningDetailRows,
            ...(data.rows ?? []),
          ]);
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
            rowsLoaded: runningDetailRows.length,
          })
        );
      });

      if (detailChunksToFetch.length === 0 && runningDetailRows.length > 0) {
        const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
        downloadArcpClaimsDetailCsv(runningDetailRows, fileName);
        toast.success(
          `Exported ${runningDetailRows.length.toLocaleString('en-IN')} lines (${detailCachedAtStart} period(s) from server cache) — SUM(Raw BM Approved) is per-line from CRM`
        );
        return;
      }

      if (failedChunks > 0) {
        throw new Error(
          `Export incomplete — ${failedChunks} of ${chunks.length} period(s) failed to load. Narrow the date range or retry.`
        );
      }

      const rows = runningDetailRows;
      if (rows.length === 0) {
        throw new Error('No detail rows to export');
      }

      const fileName = `ARCP_Claims_Detail_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
      downloadArcpClaimsDetailCsv(rows, fileName);
      const cacheNote =
        detailCachedAtStart > 0
          ? ` (${detailCachedAtStart.toLocaleString('en-IN')} of ${chunks.length} period(s) from server cache)`
          : '';
      toast.success(
        `Exported ${rows.length.toLocaleString('en-IN')} lines${cacheNote} — SUM(Raw BM Approved) is per-line from CRM`
      );
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
              toast.info('Retrying tally — completed periods load from server cache', {
                duration: 3000,
              });
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
            <strong>{dateBasisLabel}</strong> uses calls in trhcalls with{' '}
            <span className="font-medium">bapproval</span> and <span className="font-medium">editedon</span>{' '}
            in this range, then includes ARCP lines whose call reference (vucnno) matches those
            calls (vtrnno).
            Amount Payable, Branch Approved, and HO Approved come from the ARCP lines, not from
            trhcalls dates on the call log.
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

      {appliedFilters && mergedAggregateRows.length > 0 ? (
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
        <ArcpClaimsLoadBanner
          status={loadStatus}
          runningTotals={displayModel?.totals ?? null}
        />
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
                <ArcpClaimsTable
                  model={displayModel}
                  loading={loading}
                  loadProgress={
                    loading && loadStatus && loadStatus.total > 1
                      ? { done: loadStatus.done, total: loadStatus.total }
                      : null
                  }
                />
              </section>
            ) : null}
            {tableView !== 'summary' ? (
              <section className={tableView === 'both' ? 'shrink-0' : 'min-h-0 flex-1'}>
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
                />
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
