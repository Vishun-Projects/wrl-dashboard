'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, RefreshCw, Download, FileText, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ArcpClaimsTable } from '@/components/ArcpClaimsTable';
import { ArcpClaimsMonthlyTable } from '@/components/ArcpClaimsMonthlyTable';
import {
  ArcpClaimsLoadBanner,
  formatArcpDurationMs,
  formatArcpFinishTime,
  type ArcpLoadStatus,
} from '@/components/ArcpClaimsLoadBanner';
import { ArcpClaimsPdfViewer } from '@/components/ArcpClaimsPdfViewer';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { RegisterBranchFranchiseeFilters } from '@/components/RegisterBranchFranchiseeFilters';
import { RegisterMultiSelect } from '@/components/RegisterMultiSelect';
import { PageShell } from '@/components/PageShell';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  ARCP_DATE_FILTER_OPTIONS,
  estimateArcpLoadPlan,
  estimateArcpDetailLoadPlan,
  mergeArcpAggregateRows,
  mergeArcpDetailRows,
  type ArcpClaimsAggregateRow,
  type ArcpDateFilterColumn,
  type ArcpClaimsDetailRow,
  type ArcpLoadPlan,
} from '@/lib/arcp-claims-query';
import {
  downloadArcpClaimsCsv,
  downloadArcpClaimsDetailCsv,
} from '@/lib/arcp-claims-export';
import {
  buildArcpClaimsPdfBlob,
  buildArcpClaimsPdfFileName,
} from '@/lib/arcp-claims-pdf';
import {
  buildArcpClaimsMonthlyBreakdown,
  buildArcpClaimsTableModel,
} from '@/lib/arcp-claims-table';
import {
  buildFranchiseeOptions,
  buildMainBranchOptions,
  joinFilterParam,
  toDateString,
} from '@/lib/report-filters';
import {
  createChunkedFetchAuth,
  isChunkedFetchAuthError,
} from '@/lib/supabase-chunked-fetch';
import { toast } from 'sonner';

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

function buildArcpPlanMessage(plan: ArcpLoadPlan, dateFilterColumn: ArcpDateFilterColumn): string {
  if (plan.chunkCount <= 1) {
    return `Loading ${plan.spanDays}-day tally from CRM.`;
  }

  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';

  if (dateFilterColumn === 'approve') {
    return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} weekly periods to stay within CRM time limits. The table updates as each period completes.`;
  }

  return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} monthly periods. The table updates as each period completes.`;
}

function buildArcpDetailPlanMessage(plan: ArcpLoadPlan, dateFilterColumn: ArcpDateFilterColumn): string {
  if (plan.chunkCount <= 1) {
    return `Fetching line-level detail for ${plan.spanDays} days from CRM.`;
  }

  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';
  const eta = formatArcpDurationMs(plan.estimateMs);

  return `${plan.spanDays}-day detail on ${basis} is exported in ${plan.chunkCount} periods (est. ${eta}). Each period is fetched separately from CRM.`;
}

function toLoadStatus(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  done: number,
  etaMs: number,
  options?: { planMessage?: string; rowsLoaded?: number }
): ArcpLoadStatus {
  const total = plan.chunkCount;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const nextChunk = plan.chunks[done];

  return {
    done,
    total,
    percent,
    currentRange: nextChunk ? `${nextChunk.start} → ${nextChunk.end}` : null,
    etaRemainingLabel: done < total ? formatArcpDurationMs(etaMs) : null,
    etaFinishLabel: done < total ? formatArcpFinishTime(Date.now() + etaMs) : null,
    planMessage: options?.planMessage ?? buildArcpPlanMessage(plan, dateFilterColumn),
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
  const [tableView, setTableView] = useState<'summary' | 'monthly' | 'both'>('both');
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
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);

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

  const displayModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, {
      includeTravel: includeTravelReimbursement,
    });
  }, [mergedAggregateRows, includeTravelReimbursement]);

  const fullModel = useMemo(() => {
    if (mergedAggregateRows.length === 0) return null;
    return buildArcpClaimsTableModel(mergedAggregateRows, { includeTravel: true });
  }, [mergedAggregateRows]);

  const monthlyBreakdown = useMemo(() => {
    if (!rawAggregateRows || rawAggregateRows.length === 0) return null;
    return buildArcpClaimsMonthlyBreakdown(rawAggregateRows, {
      includeTravel: includeTravelReimbursement,
    });
  }, [rawAggregateRows, includeTravelReimbursement]);

  const draftLoadPlan = useMemo(
    () =>
      estimateArcpLoadPlan({
        startDate: startDateStr,
        endDate: endDateStr,
        dateFilterColumn: arcpDateFilterColumn,
        callType: callTypeParam,
        branch: branchParam || undefined,
        franchisee: franchiseeParam || undefined,
      }),
    [startDateStr, endDateStr, arcpDateFilterColumn, callTypeParam, branchParam, franchiseeParam]
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

      const queryOpts = {
        startDate: filters.startDateStr,
        endDate: filters.endDateStr,
        dateFilterColumn: filters.arcpDateFilterColumn,
        callType: filters.callTypeParam,
        branch: filters.branchParam || undefined,
        franchisee: filters.franchiseeParam || undefined,
      };
      const loadPlan = estimateArcpLoadPlan(queryOpts);
      const chunks = loadPlan.chunks;
      const chunkTimings: number[] = [];

      if (!isStale()) {
        setLoadStatus(toLoadStatus(loadPlan, filters.arcpDateFilterColumn, 0, loadPlan.estimateMs));
      }

      try {
        await chunkedAuth.refreshAuth();

        let rawAggregates: ArcpClaimsAggregateRow[] = [];
        let failedChunks = 0;

        for (let i = 0; i < chunks.length; i++) {
          if (isStale()) return;

          const chunk = chunks[i];
          const chunkStartedAt = Date.now();

          try {
            const data = await chunkedAuth.getWithAuthRetry<{
              aggregates?: ArcpClaimsAggregateRow[];
              error?: string;
            }>(
              '/api/report/arcp-claims',
              {
                timeout: 300000,
                signal,
                params: {
                  startDate: chunk.start,
                  endDate: chunk.end,
                  dateFilterColumn: filters.arcpDateFilterColumn,
                  callType: filters.callTypeParam,
                  aggregatesOnly: 'true',
                  ...(filters.branchParam ? { branch: filters.branchParam } : {}),
                  ...(filters.franchiseeParam ? { franchisee: filters.franchiseeParam } : {}),
                  ...(refresh && i === 0 ? { refresh: 'true' } : {}),
                },
              },
              { chunkIndex: i }
            );

            if (isStale()) return;
            if (data.error) throw new Error(data.error);

            const chunkRows = data.aggregates ?? [];
            rawAggregates = [...rawAggregates, ...chunkRows];

            if (!isStale()) {
              setRawAggregateRows([...rawAggregates]);
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
          const done = i + 1;
          const avgMs = chunkTimings.reduce((sum, ms) => sum + ms, 0) / chunkTimings.length;
          const etaMs = avgMs * Math.max(chunks.length - done, 0);

          if (!isStale()) {
            setLoadStatus(toLoadStatus(loadPlan, filters.arcpDateFilterColumn, done, etaMs));
          }
        }

        if (failedChunks > 0 && !isStale()) {
          const partialMessage =
            rawAggregates.length > 0
              ? `Loaded partial tally — ${failedChunks} of ${chunks.length} period(s) timed out. Narrow filters or retry.`
              : 'Failed to load ARCP claims — CRM timed out on all periods in this range.';
          if (rawAggregates.length === 0) {
            throw new Error(partialMessage);
          }
          setLoadError(partialMessage);
          toast.warning(partialMessage);
        }
      } catch (err: unknown) {
        if (isStale()) return;
        if (axios.isCancel(err) || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load ARCP claims';
        setLoadError(message);
        toast.error(message);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setLoadStatus(null);
        }
      }
    },
    [chunkedAuth]
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

    if (draftLoadPlan.isLongLoad) {
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
    if (!appliedFilters || !fullModel || fullModel.rows.length === 0) {
      toast.error('No data to preview');
      return;
    }

    setExportingPdf(true);
    try {
      const fileName = buildArcpClaimsPdfFileName(
        appliedFilters.startDateStr,
        appliedFilters.endDateStr
      );
      const { blob } = await buildArcpClaimsPdfBlob(
        fullModel,
        {
          startDate: appliedFilters.startDateStr,
          endDate: appliedFilters.endDateStr,
          dateBasisLabel,
          branchLabel,
          franchiseeLabel,
          callTypeLabel,
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
      const message = err instanceof Error ? err.message : 'Failed to generate PDF';
      toast.error(message);
    } finally {
      setExportingPdf(false);
    }
  }, [appliedFilters, fullModel, dateBasisLabel, branchLabel, franchiseeLabel, callTypeLabel]);

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
    const exportPlan = estimateArcpDetailLoadPlan(queryOpts);
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
    const rowMap = new Map<string, ArcpClaimsDetailRow>();
    let failedChunks = 0;

    try {
      await chunkedAuth.refreshAuth();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
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

          for (const row of data.rows ?? []) {
            const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
            if (!rowMap.has(key)) rowMap.set(key, row);
          }
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
        const done = i + 1;
        const avgMs = chunkTimings.reduce((sum, ms) => sum + ms, 0) / chunkTimings.length;
        const etaMs = avgMs * Math.max(chunks.length - done, 0);

        setDetailExportStatus(
          toLoadStatus(exportPlan, appliedFilters.arcpDateFilterColumn, done, etaMs, {
            planMessage: detailPlanMessage,
            rowsLoaded: rowMap.size,
          })
        );
      }

      const rows = mergeArcpDetailRows(Array.from(rowMap.values()));
      if (rows.length === 0) {
        throw new Error('No detail rows to export');
      }

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
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Failed to export detail CSV';
      toast.error(message);
    } finally {
      setExportingDetail(false);
      setDetailExportStatus(null);
    }
  }, [appliedFilters, chunkedAuth]);

  const toolbar = (
    <div className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-col gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <RegisterBranchFranchiseeFilters applyMode="instant" />
          <RegisterMultiSelect
            label="Call Type"
            emptyLabel="All Call Types"
            options={callTypeOptions}
            selected={selectedCallTypes}
            onChange={setSelectedCallTypes}
            applyMode="instant"
          />
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
            Apply Filter
          </button>
          <button
            type="button"
            onClick={() => {
              if (!appliedFilters) {
                handleApplyFilters();
                return;
              }
              runLoad(appliedFilters, true);
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
            disabled={loading || exportingPdf || !appliedFilters || !fullModel || fullModel.rows.length === 0}
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

      {loading && loadStatus ? (
        <ArcpClaimsLoadBanner status={loadStatus} runningTotals={displayModel?.totals ?? null} />
      ) : null}

      {exportingDetail && detailExportStatus ? (
        <ArcpClaimsLoadBanner status={detailExportStatus} variant="detail-export" />
      ) : null}

      {!loading && draftLoadPreview && (!appliedFilters || hasPendingFilterChanges) ? (
        <ArcpClaimsLoadBanner status={draftLoadPreview} variant="preview" />
      ) : null}

      {appliedFilters && (rawAggregateRows || loading) ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={includeTravelReimbursement}
              onChange={(event) => setIncludeTravelReimbursement(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Include travel reimbursement
          </label>
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[10px]">
            {(
              [
                ['summary', 'Service tally'],
                ['monthly', 'Monthly'],
                ['both', 'Both'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTableView(value)}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  tableView === value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">Client-side only — no extra fetch.</span>
        </div>
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
