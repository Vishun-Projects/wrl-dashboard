import { isCrmOutOfMemoryError, isCrmSqlTimeoutError, postQuery } from '@/lib/db/proxy';
import {
  arcpDateSpanDays,
  buildArcpClaimsDetailSql,
  buildArcpClaimsGrandTotalSql,
  buildArcpClaimsRawSql,
  ARCP_MERGE_ACROSS_CHUNKS,
  mergeArcpAggregateRows,
  parseArcpAggregateRows,
  arcpDetailLineKey,
  parseArcpDetailRows,
  parseArcpGrandTotals,
  planArcpLoadJobChunks,
  planArcpSummaryDateChunks,
  isArcpApproveDateColumn,
  resolveArcpDateFilterColumn,
  resolveArcpChunkGranularity,
  resolveArcpLoadConcurrency,
  splitArcpDateRange,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
  type ArcpGrandTotals,
} from '@/sql/arcp-claims/query';
import { readArcpFromPostgres } from '@/lib/read-model/flags';
import {
  queryArcpClaimsAggregates,
  queryArcpClaimsDetailRows,
  queryArcpClaimsGrandTotals,
} from '@/sql/arcp-claims/postgres';
import { runPool } from '@/lib/utils/run-pool';
import {
  buildArcpChunkCacheKey,
  getOrRunChunkInflight,
  resolveArcpChunkCache,
  writeArcpChunkCache,
  type ArcpChunkLoadMeta,
} from '@/modules/arcp-claims/server/chunk-cache';

export { isCrmSqlTimeoutError } from '@/lib/db/proxy';
export type { ArcpChunkLoadMeta } from '@/modules/arcp-claims/server/chunk-cache';

export type ArcpFetchOpts = ArcpClaimsQueryOpts & {
  /** When true, skip reading chunk cache (still writes on success). */
  bypassChunkCache?: boolean;
  /** Postgres load job — chunk status updated on success/failure. */
  jobId?: string;
  loadJobKind?: 'agg' | 'detail';
};

/** Report CRM fallback only — never used by read-model backfill. */
function crmUiOpts(opts: ArcpClaimsQueryOpts): ArcpClaimsQueryOpts {
  return { ...opts, crmUiFast: true };
}

import {
  ARCP_NCODE_SHARD_INITIAL,
  ARCP_NCODE_SHARD_MAX,
} from '@/modules/arcp-claims/server/sync/crm-fetch';

function isRetryableCrmLoadError(err: unknown): boolean {
  return isCrmSqlTimeoutError(err) || isCrmOutOfMemoryError(err);
}

async function fetchArcpAggregateChunk(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  const res = await postQuery({
    rawSql: buildArcpClaimsRawSql({
      ...crmUiOpts(opts),
      startDate: chunk.start,
      endDate: chunk.end,
    }),
    timeoutMs,
  });
  return parseArcpAggregateRows((res.data || []) as Record<string, unknown>[]);
}

async function fetchArcpAggregateChunkSharded(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number,
  shardIndex: number,
  shardCount: number
): Promise<ArcpClaimsAggregateRow[]> {
  try {
    return await fetchArcpAggregateChunk(
      { ...opts, ncodeShard: { index: shardIndex, count: shardCount } },
      chunk,
      timeoutMs
    );
  } catch (err) {
    if (!isRetryableCrmLoadError(err)) throw err;
    if (shardCount >= ARCP_NCODE_SHARD_MAX) {
      throw new Error(
        `[ARCP Claims] CRM failed on ${chunk.start}..${chunk.end} after ${shardCount} ncode shards: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const doubled = shardCount * 2;
    /* retry with more shards */
    const left = await fetchArcpAggregateChunkSharded(opts, chunk, timeoutMs, shardIndex, doubled);
    const right = await fetchArcpAggregateChunkSharded(
      opts,
      chunk,
      timeoutMs,
      shardIndex + shardCount,
      doubled
    );
    return mergeArcpAggregateRows([...left, ...right]);
  }
}

async function fetchArcpAggregateDenseWindow(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  /* dense-window shard retry */
  const merged: ArcpClaimsAggregateRow[] = [];
  for (let i = 0; i < ARCP_NCODE_SHARD_INITIAL; i++) {
    merged.push(
      ...(await fetchArcpAggregateChunkSharded(opts, chunk, timeoutMs, i, ARCP_NCODE_SHARD_INITIAL))
    );
  }
  return mergeArcpAggregateRows(merged);
}

/** On CRM timeout/OOM, split the window into smaller slices and retry (never skip a day). */
async function fetchArcpAggregateChunkResilient(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  try {
    return await fetchArcpAggregateChunk(opts, chunk, timeoutMs);
  } catch (err) {
    if (!isRetryableCrmLoadError(err)) throw err;

    const span = arcpDateSpanDays(chunk.start, chunk.end);
    if (span == null || span <= 1) {
      return fetchArcpAggregateDenseWindow(opts, chunk, timeoutMs);
    }

    const isApprove = isArcpApproveDateColumn(
      resolveArcpDateFilterColumn(opts.dateFilterColumn)
    );
    const nextStep = isApprove ? 1 : span > 14 ? 7 : span > 7 ? 3 : 1;
    const subChunks = splitArcpDateRange(chunk.start, chunk.end, nextStep);
    if (subChunks.length <= 1) {
      return fetchArcpAggregateDenseWindow(opts, chunk, timeoutMs);
    }

    /* split window and retry */

    const merged: ArcpClaimsAggregateRow[] = [];
    for (const sub of subChunks) {
      merged.push(...(await fetchArcpAggregateChunkResilient(opts, sub, timeoutMs)));
    }
    return mergeArcpAggregateRows(merged);
  }
}

async function fetchArcpDetailChunk(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const res = await postQuery({
    rawSql: buildArcpClaimsDetailSql({
      ...crmUiOpts(opts),
      startDate: chunk.start,
      endDate: chunk.end,
    }),
    timeoutMs,
  });
  return parseArcpDetailRows((res.data || []) as Record<string, unknown>[]);
}

async function fetchArcpDetailChunkSharded(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number,
  shardIndex: number,
  shardCount: number
): Promise<ArcpClaimsDetailRow[]> {
  try {
    return await fetchArcpDetailChunk(
      { ...opts, ncodeShard: { index: shardIndex, count: shardCount } },
      chunk,
      timeoutMs
    );
  } catch (err) {
    if (!isRetryableCrmLoadError(err)) throw err;
    if (shardCount >= ARCP_NCODE_SHARD_MAX) {
      throw new Error(
        `[ARCP Claims] CRM detail failed on ${chunk.start}..${chunk.end} after ${shardCount} ncode shards: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const doubled = shardCount * 2;
    const left = await fetchArcpDetailChunkSharded(opts, chunk, timeoutMs, shardIndex, doubled);
    const right = await fetchArcpDetailChunkSharded(
      opts,
      chunk,
      timeoutMs,
      shardIndex + shardCount,
      doubled
    );
    const byLine = new Map<string, ArcpClaimsDetailRow>();
    for (const row of [...left, ...right]) {
      const key = arcpDetailLineKey(row);
      if (!byLine.has(key)) byLine.set(key, row);
    }
    return Array.from(byLine.values());
  }
}

async function fetchArcpDetailDenseWindow(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const byLine = new Map<string, ArcpClaimsDetailRow>();
  for (let i = 0; i < ARCP_NCODE_SHARD_INITIAL; i++) {
    for (const row of await fetchArcpDetailChunkSharded(
      opts,
      chunk,
      timeoutMs,
      i,
      ARCP_NCODE_SHARD_INITIAL
    )) {
      const key = arcpDetailLineKey(row);
      if (!byLine.has(key)) byLine.set(key, row);
    }
  }
  return Array.from(byLine.values());
}

async function fetchArcpDetailChunkResilient(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  try {
    return await fetchArcpDetailChunk(opts, chunk, timeoutMs);
  } catch (err) {
    if (!isRetryableCrmLoadError(err)) throw err;

    const span = arcpDateSpanDays(chunk.start, chunk.end);
    if (span == null || span <= 1) {
      return fetchArcpDetailDenseWindow(opts, chunk, timeoutMs);
    }

    const nextStep = span > 14 ? 7 : span > 7 ? 3 : 1;
    const subChunks = splitArcpDateRange(chunk.start, chunk.end, nextStep);
    if (subChunks.length <= 1) {
      return fetchArcpDetailDenseWindow(opts, chunk, timeoutMs);
    }

    const byLine = new Map<string, ArcpClaimsDetailRow>();
    for (const sub of subChunks) {
      for (const row of await fetchArcpDetailChunkResilient(opts, sub, timeoutMs)) {
        const key = arcpDetailLineKey(row);
        if (!byLine.has(key)) byLine.set(key, row);
      }
    }
    return Array.from(byLine.values());
  }
}

export async function fetchArcpClaimsGrandTotals(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpGrandTotals> {
  if (readArcpFromPostgres()) {
    return queryArcpClaimsGrandTotals(opts);
  }
  const res = await postQuery({
    rawSql: buildArcpClaimsGrandTotalSql(crmUiOpts(opts)),
    timeoutMs,
  });
  const row = ((res.data || []) as Record<string, unknown>[])[0] ?? {};
  return parseArcpGrandTotals(row);
}

async function loadAggregateChunkCached(
  opts: ArcpFetchOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<{ rows: ArcpClaimsAggregateRow[]; fromCache: boolean }> {
  const cacheKey = buildArcpChunkCacheKey(opts, chunk, 'agg');
  const trackJob = opts.jobId && (!opts.loadJobKind || opts.loadJobKind === 'agg');

  try {
    const hit = await resolveArcpChunkCache(cacheKey, 'agg', {
      bypass: opts.bypassChunkCache,
    });
    if (hit && hit.payload.kind === 'agg') {
      if (trackJob) {
        const { markChunkDone } = await import('@/modules/arcp-claims/server/load-job');
        await markChunkDone(opts.jobId!, chunk.start, chunk.end);
      }
      return { rows: hit.payload.rows, fromCache: true };
    }

    const payload = await getOrRunChunkInflight(cacheKey, async () => {
      const rows = readArcpFromPostgres()
        ? await queryArcpClaimsAggregates({
            ...opts,
            startDate: chunk.start,
            endDate: chunk.end,
          })
        : await fetchArcpAggregateChunkResilient(opts, chunk, timeoutMs);
      await writeArcpChunkCache(cacheKey, 'agg', rows);
      return { kind: 'agg' as const, rows };
    });
    if (trackJob) {
      const { markChunkDone } = await import('@/modules/arcp-claims/server/load-job');
      await markChunkDone(opts.jobId!, chunk.start, chunk.end);
    }
    return { rows: payload.rows, fromCache: false };
  } catch (err) {
    if (trackJob) {
      const { markChunkFailed } = await import('@/modules/arcp-claims/server/load-job');
      const message = err instanceof Error ? err.message : 'Chunk load failed';
      await markChunkFailed(opts.jobId!, chunk.start, chunk.end, message);
    }
    throw err;
  }
}

async function loadDetailChunkCached(
  opts: ArcpFetchOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<{ rows: ArcpClaimsDetailRow[]; fromCache: boolean }> {
  const cacheKey = buildArcpChunkCacheKey(opts, chunk, 'detail');
  const trackJob = opts.jobId && (!opts.loadJobKind || opts.loadJobKind === 'detail');

  try {
    const hit = await resolveArcpChunkCache(cacheKey, 'detail', {
      bypass: opts.bypassChunkCache,
    });
    if (hit && hit.payload.kind === 'detail') {
      if (trackJob) {
        const { markChunkDone } = await import('@/modules/arcp-claims/server/load-job');
        await markChunkDone(opts.jobId!, chunk.start, chunk.end);
      }
      return { rows: hit.payload.rows, fromCache: true };
    }

    const payload = await getOrRunChunkInflight(cacheKey, async () => {
      const rows = readArcpFromPostgres()
        ? await queryArcpClaimsDetailRows({
            ...opts,
            startDate: chunk.start,
            endDate: chunk.end,
          })
        : await fetchArcpDetailChunkResilient(opts, chunk, timeoutMs);
      await writeArcpChunkCache(cacheKey, 'detail', rows);
      return { kind: 'detail' as const, rows };
    });
    if (trackJob) {
      const { markChunkDone } = await import('@/modules/arcp-claims/server/load-job');
      await markChunkDone(opts.jobId!, chunk.start, chunk.end);
    }
    return { rows: payload.rows, fromCache: false };
  } catch (err) {
    if (trackJob) {
      const { markChunkFailed } = await import('@/modules/arcp-claims/server/load-job');
      const message = err instanceof Error ? err.message : 'Chunk load failed';
      await markChunkFailed(opts.jobId!, chunk.start, chunk.end, message);
    }
    throw err;
  }
}

export async function fetchArcpClaimsAggregates(
  opts: ArcpFetchOpts,
  timeoutMs: number
): Promise<{ aggregates: ArcpClaimsAggregateRow[]; chunkMeta: ArcpChunkLoadMeta }> {
  if (readArcpFromPostgres()) {
    const aggregates = await queryArcpClaimsAggregates(opts);
    return {
      aggregates,
      chunkMeta: { cachedChunks: 0, fetchedChunks: 1, totalChunks: 1 },
    };
  }

  const uiOpts = crmUiOpts(opts);
  const chunks = planArcpSummaryDateChunks(uiOpts);
  const span = arcpDateSpanDays(uiOpts.startDate ?? null, uiOpts.endDate ?? null) ?? 0;
  const chunkGranularity = resolveArcpChunkGranularity(span);
  const concurrency =
    chunks.length > 1
      ? resolveArcpLoadConcurrency(uiOpts, {
          chunkCount: chunks.length,
          spanDays: span,
          chunkGranularity,
          crmChunkCount: chunks.length,
          usePostgres: readArcpFromPostgres(),
        })
      : 1;

  const chunkResults = await runPool(chunks, concurrency, (chunk) =>
    loadAggregateChunkCached(opts, chunk, timeoutMs)
  );

  let cachedChunks = 0;
  let fetchedChunks = 0;
  for (const part of chunkResults) {
    if (part.fromCache) cachedChunks += 1;
    else fetchedChunks += 1;
  }

  const merged = chunkResults.map((p) => p.rows).flat();
  const aggregates =
    chunks.length <= 1 ? merged : mergeArcpAggregateRows(merged, ARCP_MERGE_ACROSS_CHUNKS);
  return {
    aggregates,
    chunkMeta: {
      cachedChunks,
      fetchedChunks,
      totalChunks: chunks.length,
    },
  };
}

export async function fetchArcpClaimsDetailRows(
  opts: ArcpFetchOpts,
  timeoutMs: number
): Promise<{ rows: ArcpClaimsDetailRow[]; chunkMeta: ArcpChunkLoadMeta }> {
  if (readArcpFromPostgres()) {
    const rows = await queryArcpClaimsDetailRows(opts);
    return {
      rows,
      chunkMeta: { cachedChunks: 0, fetchedChunks: 1, totalChunks: 1 },
    };
  }

  const uiOpts = crmUiOpts(opts);
  const trackDetailJob = Boolean(opts.jobId && (!opts.loadJobKind || opts.loadJobKind === 'detail'));
  // Job rows are weekly for long detail exports — summary months would never mark done.
  const chunks = trackDetailJob
    ? planArcpLoadJobChunks(uiOpts, undefined, { kind: 'detail' })
    : planArcpSummaryDateChunks(uiOpts);
  const span = arcpDateSpanDays(uiOpts.startDate ?? null, uiOpts.endDate ?? null) ?? 0;
  const chunkGranularity = resolveArcpChunkGranularity(span);
  const concurrency =
    chunks.length > 1
      ? resolveArcpLoadConcurrency(uiOpts, {
          chunkCount: chunks.length,
          spanDays: span,
          chunkGranularity,
          crmChunkCount: chunks.length,
          usePostgres: readArcpFromPostgres(),
        })
      : 1;
  const byLine = new Map<string, ArcpClaimsDetailRow>();

  const chunkParts = await runPool(chunks, concurrency, (chunk) =>
    loadDetailChunkCached(opts, chunk, timeoutMs)
  );

  let cachedChunks = 0;
  let fetchedChunks = 0;
  for (const part of chunkParts) {
    if (part.fromCache) cachedChunks += 1;
    else fetchedChunks += 1;
  }

  for (const { rows } of chunkParts) {
    for (const row of rows) {
      const key = arcpDetailLineKey(row);
      if (!byLine.has(key)) byLine.set(key, row);
    }
  }

  return {
    rows: Array.from(byLine.values()),
    chunkMeta: {
      cachedChunks,
      fetchedChunks,
      totalChunks: chunks.length,
    },
  };
}

export { isCrmOutOfMemoryError };
