import {
  ARCP_DATE_FILTER_OPTIONS,
  resolveArcpLoadConcurrency,
  arcpChunkPeriodLabel,
  type ArcpLoadPlan,
  type ArcpDateFilterColumn,
  type ArcpClaimsAggregateRow,
  mergeArcpAggregateRows,
  ARCP_MERGE_ACROSS_CHUNKS,
} from '@/sql/arcp-claims/query';
import { type ChunkedFetchAuth } from '@/lib/supabase/chunked-fetch';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';
import {
  type ArcpLoadStatus,
  formatArcpDurationMs,
  formatArcpFinishTime,
} from '@/modules/arcp-claims/components/ArcpClaimsLoadBanner';
import { type ArcpAppliedFiltersSnapshot, arcpFilterParams } from '@/modules/arcp-claims/services/applied-filters';
import { buildArcpClaimsDetailCsvFileName } from '@/modules/arcp-claims/services/export';
import { triggerBlobDownload } from '@/modules/mis/download';
import { feedback } from '@/lib/ui/feedback';

export function arcpChunkProgressLabel(plan: ArcpLoadPlan): string {
  return arcpChunkPeriodLabel(plan.chunkGranularity);
}

export function arcpChunkLoadingHint(plan: ArcpLoadPlan): string {
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

export function buildArcpJobResumeMessage(done: number, total: number, pending: number): string {
  if (done <= 0) return 'Resuming ARCP load from server progress';
  return `${done}/${total} periods cached on server — fetching ${pending} remaining`;
}

export function buildArcpPartialFailureMessage(
  failedChunks: number,
  totalChunks: number,
  hasRows: boolean
): string {
  if (hasRows) {
    return `Loaded partial tally — ${failedChunks} of ${totalChunks} period(s) timed out. Change filters to retry failed periods.`;
  }
  return `${failedChunks} of ${totalChunks} period(s) timed out. Change filters to retry — completed periods are kept on the server.`;
}

export function buildArcpPlanMessage(
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
  const periodCountLabel = plan.chunkCount === 1 ? periodLabel : `${periodLabel}s`;
  const parallelNote =
    resolveArcpLoadConcurrency({ dateFilterColumn }, plan) > 1
      ? ` (up to ${resolveArcpLoadConcurrency({ dateFilterColumn }, plan)} in parallel)`
      : '';

  return `${plan.spanDays}-day range on ${basis} loads in ${plan.chunkCount} ${periodCountLabel}${parallelNote}. Est. ${eta}. Tally updates as each completes.`;
}

export function buildArcpDetailPlanMessage(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  totalRows?: number
): string {
  const basis =
    ARCP_DATE_FILTER_OPTIONS.find((option) => option.value === dateFilterColumn)?.label ??
    'Call Date';
  const eta = formatArcpDurationMs(plan.estimateMs);
  const rowsLabel =
    totalRows != null && totalRows > 0
      ? `${totalRows.toLocaleString('en-IN')} rows`
      : 'line-level detail';
  return `Exporting ${rowsLabel} for ${plan.spanDays}-day ${basis} range (est. ${eta}).`;
}

export function toLoadStatus(
  plan: ArcpLoadPlan,
  dateFilterColumn: ArcpDateFilterColumn,
  loadedCount: number,
  etaMs: number,
  options?: {
    planMessage?: string;
    rowsLoaded?: number;
    totalRows?: number;
    rowsProgressMode?: 'actual' | 'estimated';
    scopedFilters?: boolean;
    failedCount?: number;
    processedCount?: number;
    /** When true, progress bar/percent are driven by rows, never periods. */
    rowDriven?: boolean;
    /** Short phase shown beside the row counter (e.g. Receiving CSV). */
    phaseLabel?: string | null;
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
  const totalRows = options?.totalRows;
  const rowsLoaded = options?.rowsLoaded ?? 0;
  const rowDriven = Boolean(options?.rowDriven || (totalRows != null && totalRows > 0));
  const percent = rowDriven
    ? totalRows && totalRows > 0
      ? Math.min(100, Math.round((rowsLoaded / totalRows) * 100))
      : 0
    : total > 0
      ? Math.round((processed / total) * 100)
      : 0;
  const concurrency = resolveArcpLoadConcurrency({ dateFilterColumn }, plan);
  const inFlight = rowDriven
    ? totalRows != null && rowsLoaded < totalRows
    : processed < total && total > 1;

  return {
    done: rowDriven ? rowsLoaded : done,
    total: rowDriven ? totalRows ?? 0 : total,
    percent,
    failedCount,
    currentRange:
      options?.phaseLabel !== undefined
        ? options.phaseLabel
        : rowDriven
          ? null
          : inFlight
            ? concurrency > 1
              ? `up to ${concurrency} in parallel`
              : arcpChunkLoadingHint(plan)
            : null,
    etaRemainingLabel: inFlight ? formatArcpDurationMs(etaMs) : null,
    etaFinishLabel: inFlight ? formatArcpFinishTime(Date.now() + etaMs) : null,
    planMessage:
      options?.planMessage ??
      buildArcpPlanMessage(
        plan,
        dateFilterColumn,
        readArcpFromPostgresClient(),
        options?.scopedFilters
      ),
    rowsLoaded: options?.rowsLoaded,
    totalRows: options?.totalRows,
  };
}

export async function triggerDetailExportDownload(
  filters: ArcpAppliedFiltersSnapshot,
  includeTravelReimbursement: boolean,
  detailJobId?: string,
  onProgress?: (update: {
    phase: 'querying' | 'receiving' | 'saving';
    receivedBytes: number;
    totalBytes: number | null;
  }) => void
) {
  const url = new URL('/api/report/arcp-claims/detail/export', window.location.origin);
  for (const [key, value] of Object.entries(arcpFilterParams(filters))) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('includeTravel', includeTravelReimbursement ? 'true' : 'false');
  if (detailJobId) url.searchParams.set('jobId', detailJobId);

  const fileName = buildArcpClaimsDetailCsvFileName(filters.startDateStr, filters.endDateStr);
  onProgress?.({ phase: 'querying', receivedBytes: 0, totalBytes: null });

  const response = await fetch(url.toString(), { credentials: 'same-origin' });
  if (!response.ok) {
    let message = `Failed to export detail CSV (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const declaredLength = Number(response.headers.get('Content-Length') || 0);
  const totalBytes = declaredLength > 0 ? declaredLength : null;
  let blob: Blob;

  if (!response.body) {
    blob = await response.blob();
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        onProgress?.({ phase: 'receiving', receivedBytes, totalBytes });
      }
    }
    blob = new Blob(chunks as BlobPart[], { type: 'text/csv;charset=utf-8' });
  }

  onProgress?.({ phase: 'saving', receivedBytes: blob.size, totalBytes: totalBytes ?? blob.size });
  await triggerBlobDownload(blob, fileName);
  feedback.actionSuccess(`Saved ${fileName} to Downloads`);
}

export async function fetchArcpAggregateChunk(
  chunkedAuth: ChunkedFetchAuth,
  chunk: { start: string; end: string },
  chunkIndex: number,
  filters: ArcpAppliedFiltersSnapshot,
  useClientChunks: boolean,
  loadPlan: ArcpLoadPlan,
  jobId?: string,
  refresh?: boolean,
  signal?: AbortSignal
) {
  const isBmApprove = filters.arcpDateFilterColumn === 'bm_approved_at';
  const chunkTimeoutMs = useClientChunks
    ? isBmApprove ? 180_000 : 300_000
    : isBmApprove
      ? Math.max(loadPlan.estimateMs + 120_000, 300_000)
      : loadPlan.crmChunkCount > 0
        ? Math.max(loadPlan.estimateMs + 60_000, 300_000)
        : Math.max(loadPlan.estimateMs + 30_000, 120_000);

  return chunkedAuth.getWithAuthRetry<{ aggregates?: ArcpClaimsAggregateRow[]; error?: string }>(
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
}

export interface ArcpJobStartResponse {
  error?: string;
  chunks?: Array<{ chunkStart: string; chunkEnd: string; status: 'pending' | 'done' | 'failed' }>;
  jobId?: string | null;
  jobsEnabled?: boolean;
  progress?: { doneCount: number; pendingCount: number; failedCount: number };
  partialAggregates?: ArcpClaimsAggregateRow[];
}

export function processArcpJobStart(
  jobStart: ArcpJobStartResponse,
  chunkList: Array<{ start: string; end: string }>,
  chunkKey: (c: { start: string; end: string }) => string
) {
  if (jobStart.error) throw new Error(jobStart.error);
  let nextChunkList = chunkList;
  if (jobStart.chunks?.length) {
    nextChunkList = jobStart.chunks.map((c) => ({ start: c.chunkStart, end: c.chunkEnd }));
  }
  const jobId = jobStart.jobId && jobStart.jobsEnabled !== false ? jobStart.jobId : undefined;
  const cachedAtStart = jobStart.progress?.doneCount ?? 0;
  const pendingAtStart = jobStart.progress?.pendingCount ?? nextChunkList.length;
  const runningAggregates = mergeArcpAggregateRows(
    jobStart.partialAggregates ?? [],
    ARCP_MERGE_ACROSS_CHUNKS
  );
  const doneChunkKeys = new Set<string>();
  for (const c of jobStart.chunks ?? []) {
    if (c.status === 'done') {
      doneChunkKeys.add(chunkKey({ start: c.chunkStart, end: c.chunkEnd }));
    }
  }
  return {
    nextChunkList,
    jobId,
    cachedAtStart,
    pendingAtStart,
    runningAggregates,
    doneChunkKeys,
  };
}

export function resolveArcpChunksToFetch(
  chunkList: Array<{ start: string; end: string }>,
  doneChunkKeysAtStart: Set<string>,
  chunkKey: (c: { start: string; end: string }) => string,
  useClientChunks: boolean,
  pendingAtStart: number,
  failedChunks: number,
  cachedAtStart: number,
  runningAggregatesLength: number
) {
  let chunksToFetch: Array<{ start: string; end: string }> = useClientChunks
    ? chunkList.filter((c) => !doneChunkKeysAtStart.has(chunkKey(c)))
    : pendingAtStart > 0 || failedChunks > 0
      ? chunkList
      : [];

  if (cachedAtStart >= chunkList.length && chunkList.length > 0 && runningAggregatesLength > 0) {
    chunksToFetch = [];
  }

  let nextCachedAtStart = cachedAtStart;
  let nextPendingAtStart = pendingAtStart;

  if (chunksToFetch.length === 0 && runningAggregatesLength === 0 && chunkList.length > 0 && cachedAtStart < chunkList.length) {
    chunksToFetch = chunkList.filter((c) => !doneChunkKeysAtStart.has(chunkKey(c)));
    if (chunksToFetch.length === 0) chunksToFetch = chunkList;
    nextCachedAtStart = 0;
    nextPendingAtStart = chunksToFetch.length;
  }

  return {
    chunksToFetch,
    cachedAtStart: nextCachedAtStart,
    pendingAtStart: nextPendingAtStart,
  };
}

export function calculateArcpEta(
  processed: number,
  cachedAtStart: number,
  elapsedMs: number,
  chunkListLength: number,
  estimateMs: number
): number {
  return processed > cachedAtStart
    ? (elapsedMs / Math.max(processed - cachedAtStart, 1)) * Math.max(chunkListLength - processed, 0)
    : estimateMs;
}

