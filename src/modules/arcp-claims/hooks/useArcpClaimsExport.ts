'use client';

import { useCallback, useState } from 'react';
import axios from 'axios';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type ChunkedFetchAuth } from '@/lib/supabase/chunked-fetch';
import { type ArcpPostgresCoverage } from '@/modules/arcp-claims/server/sync/coverage-shared';
import { type ArcpLoadStatus, type ArcpRunningTotals } from '@/modules/arcp-claims/components/ArcpClaimsLoadBanner';
import { type ArcpAppliedFiltersSnapshot, arcpFilterParams, arcpQueryOptsFromFilters } from '@/modules/arcp-claims/services/applied-filters';
import { type ArcpClaimsTableModel, type ArcpMonthlyBreakdownModel, type ArcpTallyDetailLevel } from '@/modules/arcp-claims/services/table';
import { feedback } from '@/lib/ui/feedback';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';
import { fetchReadModelStatus } from '@/lib/read-model/trigger-sync-client';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { cookieAuthRequestConfig } from '@/lib/api/cookie-auth';
import { downloadArcpClaimsCsv } from '@/modules/arcp-claims/services/export';
import {
  buildArcpClaimsPdfBlob,
  buildArcpClaimsPdfFileName,
  type ArcpClaimsPdfTableView,
} from '@/modules/arcp-claims/services/pdf';
import {
  toLoadStatus,
  buildArcpDetailPlanMessage,
  triggerDetailExportDownload,
} from './load-helpers';
import { isChunkedFetchNetworkError } from '@/lib/supabase/chunked-fetch';
import { resolveArcpClientDetailLoadPlan } from '@/sql/arcp-claims/query';

const ARCP_JOB_POLL_MS = 2500;

export interface UseArcpClaimsExportProps {
  supabase: SupabaseClient;
  chunkedAuth: ChunkedFetchAuth;
  setPageWarning: (msg: string) => void;
}

export function useArcpClaimsExport({
  supabase,
  chunkedAuth,
  setPageWarning,
}: UseArcpClaimsExportProps) {
  const [exportingDetail, setExportingDetail] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState('');
  const [detailExportStatus, setDetailExportStatus] = useState<ArcpLoadStatus | null>(null);
  const [detailExportRunningTotals, setDetailExportRunningTotals] = useState<ArcpRunningTotals | null>(null);

  const closePdfViewer = useCallback(() => {
    setPdfViewerOpen(false);
    setPdfViewerUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPdfFileName('');
  }, []);

  const handleExportCsv = useCallback(async (
    appliedFilters: ArcpAppliedFiltersSnapshot | null,
    displayModel: ArcpClaimsTableModel | null,
    tableModel: ArcpClaimsTableModel | null,
    tallyDetailLevel: ArcpTallyDetailLevel
  ) => {
    const exportModel = displayModel ?? tableModel;
    if (!appliedFilters || !exportModel || (exportModel.rows.length === 0 && tallyDetailLevel !== 'totals')) {
      feedback.actionFailed('Nothing to export for the current filters');
      return;
    }
    const fileName = `ARCP_Claims_Summary_${appliedFilters.startDateStr}_${appliedFilters.endDateStr}.csv`;
    try {
      await downloadArcpClaimsCsv(exportModel, fileName);
      feedback.actionSuccess(`Downloading ${fileName}`);
    } catch {
      feedback.actionFailed('CSV export failed');
    }
  }, []);

  const handleViewPdf = useCallback(async (
    appliedFilters: ArcpAppliedFiltersSnapshot | null,
    tableModel: ArcpClaimsTableModel | null,
    displayModel: ArcpClaimsTableModel | null,
    monthlyBreakdown: ArcpMonthlyBreakdownModel | null,
    tableView: ArcpClaimsPdfTableView,
    tallyDetailLevel: ArcpTallyDetailLevel,
    includeTravelReimbursement: boolean,
    canExportPdf: boolean,
    labels: { dateBasisLabel: string; branchLabel: string; franchiseeLabel: string; callTypeLabel: string }
  ) => {
    if (!appliedFilters || !tableModel || !canExportPdf) return;

    const tallyForPdf = tableView === 'monthly' ? null : displayModel;
    const monthlyForPdf = tableView === 'summary' ? null : monthlyBreakdown;

    setExportingPdf(true);
    try {
      const fileName = buildArcpClaimsPdfFileName(appliedFilters.startDateStr, appliedFilters.endDateStr);
      const { blob } = await buildArcpClaimsPdfBlob(
        {
          meta: {
            startDate: appliedFilters.startDateStr,
            endDate: appliedFilters.endDateStr,
            dateBasisLabel: labels.dateBasisLabel,
            branchLabel: labels.branchLabel,
            franchiseeLabel: labels.franchiseeLabel,
            callTypeLabel: labels.callTypeLabel,
          },
          view: { tableView, tallyDetailLevel, includeTravelReimbursement },
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
        sanitizeUserFacingMessage(err instanceof Error ? err.message : 'Failed to generate PDF')
      );
    } finally {
      setExportingPdf(false);
    }
  }, []);

  const handleExportDetailCsv = useCallback(async (
    appliedFilters: ArcpAppliedFiltersSnapshot | null,
    tableModel: ArcpClaimsTableModel | null,
    includeTravelReimbursement: boolean,
    summaryTotals: { serviceLineCount: number; travelLineCount: number },
    arcpCoverage: ArcpPostgresCoverage | null,
    setArcpCoverage: (coverage: ArcpPostgresCoverage | null) => void,
    loading: boolean
  ) => {
    if (!appliedFilters || !tableModel || loading) return;

    let exportFilters = appliedFilters;
    let activeCoverage = arcpCoverage;
    if (readArcpFromPostgresClient() && !activeCoverage) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const progress = await fetchReadModelStatus(session?.access_token);
        if (progress.arcp) {
          activeCoverage = progress.arcp;
          setArcpCoverage(progress.arcp);
        }
      } catch { /* ignore */ }
    }

    if (
      appliedFilters.arcpDateFilterColumn === 'bm_approved_at' &&
      activeCoverage?.bmApprovedAt.max &&
      appliedFilters.endDateStr > activeCoverage.bmApprovedAt.max
    ) {
      if (appliedFilters.startDateStr > activeCoverage.bmApprovedAt.max) {
        feedback.actionFailed(
          `BM Approved coverage currently ends at ${activeCoverage.bmApprovedAt.max}. Choose an earlier date range.`
        );
        return;
      }
      exportFilters = { ...appliedFilters, endDateStr: activeCoverage.bmApprovedAt.max };
      setPageWarning(`BM Approved coverage currently ends at ${activeCoverage.bmApprovedAt.max}. Exporting the covered range only.`);
    }

    const queryOpts = arcpQueryOptsFromFilters(exportFilters);
    const exportPlan = resolveArcpClientDetailLoadPlan(queryOpts, {
      usePostgres: readArcpFromPostgresClient(),
      coverage: activeCoverage,
    });
    let detailChunkList = exportPlan.chunks;
    const estimatedDetailRows = summaryTotals.serviceLineCount + (includeTravelReimbursement ? summaryTotals.travelLineCount : 0);
    const detailPlanMessage = buildArcpDetailPlanMessage(exportPlan, exportFilters.arcpDateFilterColumn, estimatedDetailRows > 0 ? estimatedDetailRows : undefined);

    const reportDetailExportProgress = (
      done: number,
      etaMs: number,
      extra?: {
        failedCount?: number;
        processedCount?: number;
        rowsLoaded?: number;
        rowsProgressMode?: 'actual' | 'estimated';
        phaseLabel?: string | null;
      }
    ) => {
      setDetailExportRunningTotals({
        amountPayable: tableModel.totals.amountPayable,
        branchApproved: tableModel.totals.branchApproved,
        hoApproved: tableModel.totals.hoApproved,
      });
      setDetailExportStatus(
        toLoadStatus(
          { ...exportPlan, chunkCount: detailChunkList.length, chunks: detailChunkList },
          exportFilters.arcpDateFilterColumn,
          done,
          etaMs,
          {
            planMessage: detailPlanMessage,
            failedCount: extra?.failedCount,
            processedCount: extra?.processedCount,
            rowsLoaded: extra?.rowsLoaded ?? 0,
            totalRows: estimatedDetailRows > 0 ? estimatedDetailRows : undefined,
            rowsProgressMode: extra?.rowsProgressMode,
            rowDriven: true,
            phaseLabel: extra?.phaseLabel,
          }
        )
      );
    };

    setExportingDetail(true);
    setDetailExportRunningTotals(null);
    setDetailExportStatus(
      toLoadStatus(
        { ...exportPlan, chunkCount: detailChunkList.length, chunks: detailChunkList },
        exportFilters.arcpDateFilterColumn,
        0,
        exportPlan.estimateMs,
        {
          planMessage: detailPlanMessage,
          rowsLoaded: 0,
          totalRows: estimatedDetailRows > 0 ? estimatedDetailRows : undefined,
          rowsProgressMode: estimatedDetailRows > 0 ? 'estimated' : 'actual',
          rowDriven: true,
          phaseLabel: 'Starting export…',
        }
      )
    );

    const exportStartedAt = Date.now();
    let downloaded = false;
    const postgresDirectExport = readArcpFromPostgresClient();

    try {
      if (postgresDirectExport) {
        const directEstimateMs = estimatedDetailRows > 0 ? Math.max(15_000, Math.ceil(estimatedDetailRows / 1500) * 1000) : Math.max(exportPlan.estimateMs, 30_000);
        const estimatedBytes = estimatedDetailRows > 0 ? Math.max(estimatedDetailRows * 180, 1) : null;
        let phase: 'querying' | 'receiving' | 'saving' = 'querying';

        const tick = () => {
          if (phase !== 'querying') return;
          const elapsed = Date.now() - exportStartedAt;
          const ratio = Math.min(0.35, elapsed / directEstimateMs);
          const rowsGuess = estimatedDetailRows > 0 ? Math.min(estimatedDetailRows, Math.round(ratio * estimatedDetailRows)) : 0;
          reportDetailExportProgress(0, Math.max(directEstimateMs - elapsed, 0), {
            processedCount: 1,
            rowsLoaded: Math.max(rowsGuess, estimatedDetailRows > 0 ? 1 : 0),
            rowsProgressMode: 'estimated',
            phaseLabel: 'Querying database…',
          });
        };
        tick();
        const progressTimer = window.setInterval(tick, 400);

        try {
          await triggerDetailExportDownload(exportFilters, includeTravelReimbursement, undefined, (update) => {
            phase = update.phase;
            if (update.phase === 'querying') {
              tick();
              return;
            }
            if (update.phase === 'saving') {
              reportDetailExportProgress(0, 0, {
                processedCount: 1,
                rowsLoaded: estimatedDetailRows > 0 ? estimatedDetailRows : undefined,
                rowsProgressMode: 'actual',
                phaseLabel: 'Saving to Downloads…',
              });
              return;
            }
            const byteTotal = update.totalBytes ?? estimatedBytes;
            const byteRatio = byteTotal && byteTotal > 0 ? Math.min(1, update.receivedBytes / byteTotal) : 0;
            const rowsGuess = estimatedDetailRows > 0 ? Math.min(estimatedDetailRows, Math.round(estimatedDetailRows * (0.35 + byteRatio * 0.6))) : 0;
            const mb = update.receivedBytes / (1024 * 1024);
            reportDetailExportProgress(0, Math.max(directEstimateMs * (1 - byteRatio) * 0.65, 0), {
              processedCount: 1,
              rowsLoaded: rowsGuess,
              rowsProgressMode: 'estimated',
              phaseLabel: mb >= 0.1 ? `Receiving CSV… ${mb.toFixed(1)} MB` : 'Receiving CSV…',
            });
          });
          downloaded = true;
          reportDetailExportProgress(0, 0, {
            processedCount: 1,
            rowsLoaded: estimatedDetailRows > 0 ? estimatedDetailRows : undefined,
            rowsProgressMode: 'actual',
            phaseLabel: 'Done',
          });
        } finally {
          window.clearInterval(progressTimer);
        }
        return;
      }

      const detailJobRes = await axios.post<{ error?: string; chunks?: Array<{ chunkStart: string; chunkEnd: string }>; jobId?: string | null; jobsEnabled?: boolean; progress?: { doneCount: number; failedCount: number; pendingCount: number; totalChunks?: number }; partialRows?: unknown[] }>(
        '/api/report/arcp-claims/load-start',
        null,
        { ...cookieAuthRequestConfig, params: { kind: 'detail', ...arcpFilterParams(exportFilters) } }
      );
      const detailJob = detailJobRes.data;
      if (detailJob.error) throw new Error(detailJob.error);
      if (detailJob.chunks?.length) {
        detailChunkList = detailJob.chunks.map((c) => ({ start: c.chunkStart, end: c.chunkEnd }));
      }

      const detailJobId = detailJob.jobId && detailJob.jobsEnabled !== false ? detailJob.jobId : undefined;
      const initialDone = detailJob.progress?.doneCount ?? 0;
      const initialFailed = detailJob.progress?.failedCount ?? 0;
      const initialProcessed = Math.min(detailChunkList.length, initialDone + initialFailed);

      const updateFromProgress = (
        progress?: { totalChunks?: number; doneCount: number; failedCount: number; pendingCount?: number },
        fallbackFailedCount?: number,
        rowsLoaded?: number
      ) => {
        const done = Math.min(progress?.doneCount ?? initialDone, detailChunkList.length);
        const failed = progress?.failedCount ?? fallbackFailedCount ?? initialFailed;
        const processed = Math.min(detailChunkList.length, progress?.totalChunks ? done + failed : initialProcessed);
        const elapsedMs = Date.now() - exportStartedAt;
        const etaMs = processed > 0 ? (elapsedMs / processed) * Math.max(detailChunkList.length - processed, 0) : Math.max(exportPlan.estimateMs - elapsedMs, 0);
        const hasActualRows = typeof rowsLoaded === 'number' && rowsLoaded > 0;
        const softRows = processed === 0 && estimatedDetailRows > 0 ? Math.max(1, Math.min(Math.round(estimatedDetailRows * 0.2), Math.round((elapsedMs / Math.max(exportPlan.estimateMs, 1)) * estimatedDetailRows * 0.35))) : 0;
        const estimatedRowsLoaded = estimatedDetailRows > 0 ? Math.min(estimatedDetailRows, Math.max(hasActualRows ? rowsLoaded : 0, softRows, Math.round((processed / Math.max(detailChunkList.length, 1)) * estimatedDetailRows))) : undefined;

        reportDetailExportProgress(done, etaMs, {
          failedCount: failed > 0 ? failed : undefined,
          processedCount: Math.max(processed, processed === 0 && softRows > 0 ? 1 : processed),
          rowsLoaded: hasActualRows ? rowsLoaded : estimatedRowsLoaded,
          rowsProgressMode: hasActualRows ? 'actual' : 'estimated',
          phaseLabel: processed === 0 ? 'Loading first section…' : `Loaded ${processed} of ${detailChunkList.length} sections`,
        });
      };

      const finishDownload = async () => {
        if (downloaded) return;
        downloaded = true;
        const estimatedBytes = estimatedDetailRows > 0 ? Math.max(estimatedDetailRows * 180, 1) : null;
        await triggerDetailExportDownload(exportFilters, includeTravelReimbursement, detailJobId, (update) => {
          if (update.phase === 'querying') {
            reportDetailExportProgress(detailChunkList.length, 0, {
              processedCount: detailChunkList.length,
              rowsLoaded: estimatedDetailRows > 0 ? Math.round(estimatedDetailRows * 0.9) : undefined,
              rowsProgressMode: 'estimated',
              phaseLabel: 'Preparing CSV…',
            });
            return;
          }
          if (update.phase === 'saving') {
            reportDetailExportProgress(detailChunkList.length, 0, {
              processedCount: detailChunkList.length,
              rowsLoaded: estimatedDetailRows > 0 ? estimatedDetailRows : undefined,
              rowsProgressMode: 'actual',
              phaseLabel: 'Saving to Downloads…',
            });
            return;
          }
          const byteTotal = update.totalBytes ?? estimatedBytes;
          const byteRatio = byteTotal && byteTotal > 0 ? Math.min(1, update.receivedBytes / byteTotal) : 0;
          const mb = update.receivedBytes / (1024 * 1024);
          reportDetailExportProgress(detailChunkList.length, 0, {
            processedCount: detailChunkList.length,
            rowsLoaded: estimatedDetailRows > 0 ? Math.min(estimatedDetailRows, Math.round(estimatedDetailRows * (0.9 + byteRatio * 0.1))) : undefined,
            rowsProgressMode: 'estimated',
            phaseLabel: mb >= 0.1 ? `Receiving CSV… ${mb.toFixed(1)} MB` : 'Receiving CSV…',
          });
        });
      };

      const syncDetailJob = async () => {
        if (!detailJobId) return null;
        try {
          const status = await chunkedAuth.getWithAuthRetry<{ progress?: { totalChunks?: number; doneCount: number; failedCount: number }; rowCount?: number; resumable?: boolean }>(
            '/api/report/arcp-claims/load-status',
            { params: { kind: 'detail', jobId: detailJobId, progressOnly: 'true' } }
          );
          updateFromProgress(status.progress, undefined, status.rowCount);
          return status;
        } catch {
          return null;
        }
      };

      updateFromProgress(detailJob.progress, initialFailed, detailJob.partialRows?.length);

      if (!detailJobId) {
        await finishDownload();
        return;
      }

      if ((detailJob.progress?.pendingCount ?? 0) === 0) {
        if ((detailJob.progress?.failedCount ?? 0) > 0) {
          throw new Error(`Export incomplete — ${detailJob.progress?.failedCount ?? 0} of ${detailChunkList.length} sections failed to load. Narrow the date range or retry.`);
        }
        await finishDownload();
        return;
      }

      while (!downloaded) {
        const status = await syncDetailJob();
        if (!status) {
          updateFromProgress(undefined, initialFailed);
          await new Promise((resolve) => window.setTimeout(resolve, ARCP_JOB_POLL_MS));
          continue;
        }
        if (status.resumable === false) {
          if ((status.progress?.failedCount ?? 0) > 0) {
            throw new Error(`Export incomplete — ${status.progress?.failedCount ?? 0} of ${detailChunkList.length} sections failed to load. Narrow the date range or retry.`);
          }
          await finishDownload();
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, ARCP_JOB_POLL_MS));
      }
    } catch (err: unknown) {
      const message = isChunkedFetchNetworkError(err)
        ? 'Network error during export — sign in again if needed, then retry (localhost skips GoTrue token refresh).'
        : sanitizeUserFacingMessage(
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error ? err.message : 'Failed to export detail CSV'
          );
      feedback.actionFailed(message);
    } finally {
      setExportingDetail(false);
      setDetailExportStatus(null);
      setDetailExportRunningTotals(null);
    }
  }, [supabase, chunkedAuth, setPageWarning]);

  return {
    exportingDetail,
    exportingPdf,
    pdfViewerOpen,
    pdfViewerUrl,
    pdfFileName,
    detailExportStatus,
    detailExportRunningTotals,
    closePdfViewer,
    handleExportCsv,
    handleViewPdf,
    handleExportDetailCsv,
  };
}
