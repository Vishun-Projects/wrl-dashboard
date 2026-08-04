'use client';

import { useCallback, useRef, useState } from 'react';
import axios from 'axios';
import { type SupabaseClient } from '@supabase/supabase-js';
import { type ChunkedFetchAuth } from '@/lib/supabase/chunked-fetch';
import { type ArcpPostgresCoverage } from '@/modules/arcp-claims/server/sync/coverage-shared';
import {
  type ArcpClaimsAggregateRow,
  resolveArcpClientLoadPlan,
  shouldUseClientSideArcpChunks,
  resolveArcpLoadConcurrency,
  mergeArcpChunkAggregateRows,
} from '@/sql/arcp-claims/query';
import { runPool } from '@/lib/utils/run-pool';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';
import { fetchReadModelStatus } from '@/lib/read-model/trigger-sync-client';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { cookieAuthRequestConfig } from '@/lib/api/cookie-auth';
import {
  type ArcpAppliedFiltersSnapshot as AppliedArcpFiltersSnapshot,
  appliedArcpFiltersKey,
  arcpFilterParams,
  arcpQueryOptsFromFilters,
} from '@/modules/arcp-claims/services/applied-filters';
import {
  toLoadStatus,
  buildArcpJobResumeMessage,
  buildArcpPartialFailureMessage,
  fetchArcpAggregateChunk,
  processArcpJobStart,
  resolveArcpChunksToFetch,
  calculateArcpEta,
  type ArcpJobStartResponse,
} from './load-helpers';
import { type ArcpLoadStatus } from '@/modules/arcp-claims/components/ArcpClaimsLoadBanner';
import {
  isChunkedFetchAbortError,
  isChunkedFetchAuthError,
} from '@/lib/supabase/chunked-fetch';

const ARCP_JOB_POLL_MS = 2500;
const ARCP_JOB_POLL_MAX_MS = 30_000;

export interface UseArcpClaimsFetchProps {
  supabase: SupabaseClient;
  chunkedAuth: ChunkedFetchAuth;
  loadEstimateHints: { usePostgres: boolean; coverage: ArcpPostgresCoverage | null };
  setArcpCoverage: (coverage: ArcpPostgresCoverage | null) => void;
  setPageError: (msg: string) => void;
  setPageWarning: (msg: string) => void;
  clearPageAlert: () => void;
}

export function useArcpClaimsFetch({
  supabase,
  chunkedAuth,
  loadEstimateHints,
  setArcpCoverage,
  setPageError,
  setPageWarning,
  clearPageAlert,
}: UseArcpClaimsFetchProps) {
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<ArcpLoadStatus | null>(null);
  const [rawAggregateRows, setRawAggregateRows] = useState<ArcpClaimsAggregateRow[] | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const inFlightLoadKeyRef = useRef<string | null>(null);

  const loadData = useCallback(
    async (
      filters: AppliedArcpFiltersSnapshot,
      refresh = false,
      signal?: AbortSignal,
      generation = 0
    ) => {
      setLoading(true);
      clearPageAlert();

      const isStale = () => generation !== loadGenerationRef.current || signal?.aborted;
      const loadStartedAt = Date.now();
      const queryOpts = arcpQueryOptsFromFilters(filters);
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
          const { data: { session } } = await supabase.auth.getSession();
          const progress = await fetchReadModelStatus(session?.access_token);
          if (progress.arcp) {
            activeHints = { usePostgres: true, coverage: progress.arcp };
            if (!isStale()) setArcpCoverage(progress.arcp);
          }
        } catch { /* ignored */ }
      }

      const loadPlan = resolveArcpClientLoadPlan(queryOpts, activeHints);
      const useClientChunks = shouldUseClientSideArcpChunks(queryOpts, activeHints);
      let chunkList = loadPlan.chunks;
      const chunkKey = (c: { start: string; end: string }) => `${c.start}|${c.end}`;

      let jobId: string | undefined;
      let cachedAtStart = 0;
      let pendingAtStart = chunkList.length;
      let runningAggregates: ArcpClaimsAggregateRow[] = [];
      let jobPollTimer: ReturnType<typeof setTimeout> | null = null;
      let jobPollInFlight = false;
      let jobPollDelayMs = ARCP_JOB_POLL_MS;
      let maxProcessedSeen = 0;
      let pollFailedCount = 0;
      const mergedChunkKeys = new Set<string>();

      const countMergedChunks = () =>
        Math.min(chunkList.filter((c) => mergedChunkKeys.has(chunkKey(c))).length, chunkList.length);

      const applyInitialAggregates = (rows: ArcpClaimsAggregateRow[]) => {
        runningAggregates = rows;
        if (rows.length > 0 && !isStale()) setRawAggregateRows(rows);
      };

      const mergeChunkAggregates = (
        chunk: { start: string; end: string },
        chunkRows: ArcpClaimsAggregateRow[]
      ) => {
        if (chunkRows.length === 0 || isStale()) return;
        const key = chunkKey(chunk);
        if (mergedChunkKeys.has(key)) return;
        mergedChunkKeys.add(key);
        runningAggregates = mergeArcpChunkAggregateRows(runningAggregates, chunk, chunkRows, {
          replaceMonths: loadPlan.chunkGranularity === 'month',
        });
        setRawAggregateRows(runningAggregates.length > 0 ? runningAggregates : null);
      };

      const updateLoadProgress = (
        loaded: number,
        etaMs: number,
        extra?: { failedCount?: number; processedCount?: number }
      ) => {
        const failed = extra?.failedCount ?? pollFailedCount;
        const processed = Math.min(chunkList.length, extra?.processedCount ?? loaded + failed);
        if (isStale() || processed < maxProcessedSeen) return;
        maxProcessedSeen = processed;
        if (extra?.failedCount != null) pollFailedCount = extra.failedCount;
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

      const syncFromJob = async () => {
        if (!jobId || isStale() || signal?.aborted) return null;
        try {
          const status = await chunkedAuth.getWithAuthRetry<{
            resumable?: boolean;
            progress?: { totalChunks: number; doneCount: number; failedCount: number };
          }>(
            '/api/report/arcp-claims/load-status',
            { signal, params: { kind: 'agg', jobId, progressOnly: 'true' } }
          );
          if (isStale()) return null;

          if (status.progress && status.progress.totalChunks > 0) {
            const failed = status.progress.failedCount;
            const done = countMergedChunks();
            const processed = Math.min(chunkList.length, done + failed);
            const elapsedMs = Date.now() - loadStartedAt;
            const etaMs = calculateArcpEta(processed, cachedAtStart, elapsedMs, chunkList.length, loadPlan.estimateMs);
            updateLoadProgress(done, etaMs, { failedCount: failed, processedCount: processed });
          }

          if (!status.resumable) stopJobPoll();
          return status;
        } catch {
          return null;
        }
      };

      const startJobPoll = () => {
        if (!jobId || jobPollTimer) return;
        const tick = () => {
          if (isStale() || signal?.aborted || !jobId) return;
          if (jobPollInFlight) {
            jobPollTimer = setTimeout(tick, jobPollDelayMs);
            return;
          }
          jobPollInFlight = true;
          void syncFromJob().finally(() => {
            jobPollInFlight = false;
            jobPollDelayMs = Math.min(jobPollDelayMs * 2, ARCP_JOB_POLL_MAX_MS);
            jobPollTimer = setTimeout(tick, jobPollDelayMs);
          });
        };
        void syncFromJob();
        jobPollTimer = setTimeout(tick, jobPollDelayMs);
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
        const jobStartRes = await axios.post<ArcpJobStartResponse>(
          '/api/report/arcp-claims/load-start',
          null,
          { ...cookieAuthRequestConfig, signal, params: { kind: 'agg', ...arcpFilterParams(filters) } }
        );
        if (isStale()) {
          applyInitialAggregates(runningAggregates);
          return;
        }

        const jobParsed = processArcpJobStart(jobStartRes.data, chunkList, chunkKey);
        chunkList = jobParsed.nextChunkList;
        jobId = jobParsed.jobId;
        cachedAtStart = jobParsed.cachedAtStart;
        pendingAtStart = jobParsed.pendingAtStart;
        runningAggregates = jobParsed.runningAggregates;

        for (const key of jobParsed.doneChunkKeys) {
          mergedChunkKeys.add(key);
        }

        if (jobId) {
          if (!isStale()) {
            const loadedChunks = countMergedChunks();
            maxProcessedSeen = Math.min(chunkList.length, loadedChunks + (jobStartRes.data.progress?.failedCount ?? 0));
            failedChunks = Math.min(jobStartRes.data.progress?.failedCount ?? 0, chunkList.length);
            applyInitialAggregates(runningAggregates);
            setLoadStatus(
              toLoadStatus(
                { ...loadPlan, chunkCount: chunkList.length, chunks: chunkList },
                filters.arcpDateFilterColumn,
                loadedChunks,
                loadPlan.estimateMs,
                {
                  scopedFilters,
                  planMessage: buildArcpJobResumeMessage(loadedChunks, chunkList.length, pendingAtStart),
                  rowsLoaded: runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0) || undefined,
                  failedCount: failedChunks > 0 ? failedChunks : undefined,
                  processedCount: maxProcessedSeen,
                }
              )
            );
            startJobPoll();
          } else {
            applyInitialAggregates(runningAggregates);
          }
        } else if (!isStale()) {
          setLoadStatus(
            toLoadStatus(loadPlan, filters.arcpDateFilterColumn, 0, loadPlan.estimateMs, { scopedFilters })
          );
        }

        const chunkResolution = resolveArcpChunksToFetch(
          chunkList,
          mergedChunkKeys,
          chunkKey,
          useClientChunks,
          pendingAtStart,
          failedChunks,
          cachedAtStart,
          runningAggregates.length
        );

        const chunksToFetch = chunkResolution.chunksToFetch;
        cachedAtStart = chunkResolution.cachedAtStart;
        pendingAtStart = chunkResolution.pendingAtStart;

        if (chunksToFetch.length === 0) {
          applyInitialAggregates(runningAggregates);
        } else {
          const concurrency = useClientChunks
            ? resolveArcpLoadConcurrency(queryOpts, { ...loadPlan, usePostgres: activeHints?.usePostgres })
            : 1;

          await runPool(
            chunksToFetch,
            concurrency,
            async (chunk) => {
              if (isStale()) return;
              try {
                const data = await fetchArcpAggregateChunk(
                  chunkedAuth,
                  chunk,
                  countMergedChunks(),
                  filters,
                  useClientChunks,
                  loadPlan,
                  jobId,
                  refresh,
                  signal
                );
                if (isStale()) return;
                if (data.error) throw new Error(data.error);
                mergeChunkAggregates(chunk, data.aggregates ?? []);
              } catch (chunkErr: unknown) {
                if (isChunkedFetchAbortError(chunkErr, signal)) return;
                if (isChunkedFetchAuthError(chunkErr)) throw chunkErr;
                failedChunks += 1;
              }

              const done = countMergedChunks();
              const processedCount = Math.min(chunkList.length, done + failedChunks);
              const elapsedMs = Date.now() - loadStartedAt;
              const etaMs = calculateArcpEta(processedCount, cachedAtStart, elapsedMs, chunkList.length, loadPlan.estimateMs);

              if (!isStale()) {
                updateLoadProgress(done, etaMs, { failedCount: failedChunks, processedCount });
              }
            }
          );
        }

        if (failedChunks > 0 && !isStale()) {
          const hasRows = runningAggregates.length > 0;
          const partialMessage = buildArcpPartialFailureMessage(failedChunks, chunkList.length, hasRows);
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
                rowsLoaded: hasRows ? runningAggregates.reduce((s, r) => s + Number(r.qty ?? 0), 0) : undefined,
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
            : err instanceof Error ? err.message : 'Failed to load ARCP claims'
        );
        setPageError(message);
      } finally {
        stopJobPoll();
        if (generation === loadGenerationRef.current) {
          if (runningAggregates.length === 0) setRawAggregateRows(null);
          setLoading(false);
          if (failedChunks === 0) setLoadStatus(null);
        }
      }
    },
    [chunkedAuth, loadEstimateHints, supabase, clearPageAlert, setArcpCoverage, setPageError, setPageWarning]
  );

  const runLoad = useCallback(
    (filters: AppliedArcpFiltersSnapshot, refresh = false) => {
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
        if (inFlightLoadKeyRef.current === key) inFlightLoadKeyRef.current = null;
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
      });

      return controller;
    },
    [loadData]
  );

  const abortActiveLoad = useCallback(() => {
    loadAbortRef.current?.abort();
  }, []);

  return {
    loading,
    setLoading,
    loadStatus,
    setLoadStatus,
    rawAggregateRows,
    setRawAggregateRows,
    runLoad,
    abortActiveLoad,
  };
}
