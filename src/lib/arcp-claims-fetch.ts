import { isCrmOutOfMemoryError, isCrmSqlTimeoutError, postQuery } from '@/lib/db-proxy';
import {
  arcpDateSpanDays,
  buildArcpClaimsDetailSql,
  buildArcpClaimsGrandTotalSql,
  buildArcpClaimsRawSql,
  mergeArcpAggregateRows,
  parseArcpAggregateRows,
  parseArcpDetailRows,
  parseArcpGrandTotals,
  planArcpSummaryDateChunks,
  isArcpApproveDateColumn,
  resolveArcpDateFilterColumn,
  resolveArcpLoadConcurrency,
  splitArcpDateRange,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
  type ArcpGrandTotals,
} from '@/lib/arcp-claims-query';
import { runPool } from '@/lib/run-pool';

export { isCrmSqlTimeoutError } from '@/lib/db-proxy';

/** Report CRM fallback only — never used by read-model backfill. */
function crmUiOpts(opts: ArcpClaimsQueryOpts): ArcpClaimsQueryOpts {
  return { ...opts, crmUiFast: true };
}

import {
  ARCP_NCODE_SHARD_INITIAL,
  ARCP_NCODE_SHARD_MAX,
} from '@/lib/read-model/arcp/constants';

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
    const byUcn = new Map<string, ArcpClaimsDetailRow>();
    for (const row of [...left, ...right]) {
      const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
      if (!byUcn.has(key)) byUcn.set(key, row);
    }
    return Array.from(byUcn.values());
  }
}

async function fetchArcpDetailDenseWindow(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const byUcn = new Map<string, ArcpClaimsDetailRow>();
  for (let i = 0; i < ARCP_NCODE_SHARD_INITIAL; i++) {
    for (const row of await fetchArcpDetailChunkSharded(
      opts,
      chunk,
      timeoutMs,
      i,
      ARCP_NCODE_SHARD_INITIAL
    )) {
      const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
      if (!byUcn.has(key)) byUcn.set(key, row);
    }
  }
  return Array.from(byUcn.values());
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

    const byUcn = new Map<string, ArcpClaimsDetailRow>();
    for (const sub of subChunks) {
      for (const row of await fetchArcpDetailChunkResilient(opts, sub, timeoutMs)) {
        const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
        if (!byUcn.has(key)) byUcn.set(key, row);
      }
    }
    return Array.from(byUcn.values());
  }
}

export async function fetchArcpClaimsGrandTotals(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpGrandTotals> {
  const res = await postQuery({
    rawSql: buildArcpClaimsGrandTotalSql(crmUiOpts(opts)),
    timeoutMs,
  });
  const row = ((res.data || []) as Record<string, unknown>[])[0] ?? {};
  return parseArcpGrandTotals(row);
}

export async function fetchArcpClaimsAggregates(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  const chunks = planArcpSummaryDateChunks(crmUiOpts(opts));
  const concurrency = chunks.length > 1 ? resolveArcpLoadConcurrency(crmUiOpts(opts)) : 1;

  const chunkResults = await runPool(chunks, concurrency, (chunk) =>
    fetchArcpAggregateChunkResilient(opts, chunk, timeoutMs)
  );

  const merged = chunkResults.flat();
  return chunks.length <= 1 ? merged : mergeArcpAggregateRows(merged);
}

export async function fetchArcpClaimsDetailRows(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const chunks = planArcpSummaryDateChunks(crmUiOpts(opts));
  const concurrency = chunks.length > 1 ? resolveArcpLoadConcurrency(crmUiOpts(opts)) : 1;
  const byUcn = new Map<string, ArcpClaimsDetailRow>();

  const chunkRowLists = await runPool(chunks, concurrency, (chunk) =>
    fetchArcpDetailChunkResilient(opts, chunk, timeoutMs)
  );

  for (const rows of chunkRowLists) {
    for (const row of rows) {
      const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
      if (!byUcn.has(key)) byUcn.set(key, row);
    }
  }

  return Array.from(byUcn.values());
}

export { isCrmOutOfMemoryError };
