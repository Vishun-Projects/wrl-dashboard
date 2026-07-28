import {
  enrichArcpAggregateLabels,
  enrichArcpDetailRows,
  loadArcpCrmLabelLookups,
} from './crm-labels';
import {
  fetchArcpClaimsAggregates,
  fetchArcpClaimsDetailRows,
  type ArcpChunkLoadMeta,
  type ArcpFetchOpts,
} from './fetch';
import {
  buildArcpChunkCacheKey,
  emptyArcpChunkMeta,
  mergeArcpChunkMeta,
  writeArcpChunkCache,
} from './chunk-cache';
import {
  queryArcpClaimsAggregates,
  queryArcpClaimsDetailRows,
} from './postgres';
import {
  deriveArcpGrandTotalsFromAggregates,
  ARCP_MERGE_ACROSS_CHUNKS,
  arcpDateSpanDays,
  mergeArcpAggregateRows,
  mergeArcpDetailRows,
  planArcpLoadJobChunks,
  planArcpSummaryDateChunks,
  resolveArcpDateFilterColumn,
  resolveArcpLoadConcurrency,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
  type ArcpGrandTotals,
} from '../query';
import { getArcpPostgresCoverage } from '@/lib/read-model/arcp/coverage-server';
import {
  planArcpCoverageSegments,
  postgresCoversFullRange,
  type ArcpCoverageDateColumn,
} from '@/lib/read-model/arcp/coverage-shared';
import { getArcpReadiness } from '@/lib/read-model/arcp/readiness';
import { readArcpFromPostgres } from '@/lib/read-model/flags';
import { runPool } from '@/lib/utils/run-pool';

const CRM_QUERY_TIMEOUT_MS = Number(process.env.ARCP_CRM_LOAD_TIMEOUT_MS ?? 300_000) || 300_000;

export type ArcpDataSource = 'postgres' | 'crm' | 'crm_fallback';

/** When true, gaps outside Postgres coverage load live from CRM. Off by default in postgres mode. */
export function arcpCrmFallbackOnEmptyEnabled(): boolean {
  if (readArcpFromPostgres()) {
    return process.env.ARCP_CRM_FALLBACK_ON_EMPTY === 'true';
  }
  return process.env.ARCP_CRM_FALLBACK_ON_EMPTY !== 'false';
}

async function loadArcpAggregatesPostgresOnly(opts: ArcpFetchOpts): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  const aggregates = await enrichAggregatesForResponse(await queryArcpClaimsAggregates(opts), {
    fromPostgres: true,
  });
  await recordAggChunkForJob(opts, aggregates);
  const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
  return {
    aggregates,
    source: 'postgres',
    grandTotals,
    chunkMeta: { cachedChunks: 0, fetchedChunks: 1, totalChunks: 1 },
  };
}

function toCoverageDateColumn(
  column: ReturnType<typeof resolveArcpDateFilterColumn>
): ArcpCoverageDateColumn {
  return column;
}



async function enrichAggregatesForResponse(
  rows: ArcpClaimsAggregateRow[],
  options?: { fromPostgres?: boolean }
): Promise<ArcpClaimsAggregateRow[]> {
  if (rows.length === 0) return rows;
  if (options?.fromPostgres || readArcpFromPostgres()) {
    return rows;
  }
  const lookups = await loadArcpCrmLabelLookups();
  return enrichArcpAggregateLabels(rows, lookups);
}

async function recordAggChunkForJob(
  opts: ArcpFetchOpts,
  rows: ArcpClaimsAggregateRow[]
): Promise<void> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!opts.jobId || !startDate || !endDate) return;

  const cacheKey = buildArcpChunkCacheKey(opts, { start: startDate, end: endDate }, 'agg');
  try {
    await writeArcpChunkCache(cacheKey, 'agg', rows);
  } catch (err) {
    console.warn('[ARCP] job chunk cache write skipped:', err);
  }
  const { markChunkDone } = await import('./load-job');
  await markChunkDone(opts.jobId, startDate, endDate);
}

async function recordDetailChunkForJob(
  opts: ArcpFetchOpts,
  rows: ArcpClaimsDetailRow[]
): Promise<void> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!opts.jobId || !startDate || !endDate) return;

  const cacheKey = buildArcpChunkCacheKey(opts, { start: startDate, end: endDate }, 'detail');
  try {
    await writeArcpChunkCache(cacheKey, 'detail', rows);
    const { markChunkDone } = await import('./load-job');
    await markChunkDone(opts.jobId, startDate, endDate);
  } catch (err) {
    const { markChunkFailed } = await import('./load-job');
    await markChunkFailed(
      opts.jobId,
      startDate,
      endDate,
      err instanceof Error ? err.message : 'Detail chunk cache write failed'
    );
    throw err;
  }
}

async function loadArcpAggregatesCoverageAware(
  opts: ArcpFetchOpts
): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!startDate || !endDate) {
    const rows = await enrichAggregatesForResponse(await queryArcpClaimsAggregates(opts), {
      fromPostgres: true,
    });
    const grandTotals = deriveArcpGrandTotalsFromAggregates(rows);
    return {
      aggregates: rows,
      source: 'postgres',
      grandTotals,
      chunkMeta: emptyArcpChunkMeta(0),
    };
  }

  if (readArcpFromPostgres()) {
    return loadArcpAggregatesPostgresOnly(opts);
  }

  const coverage = await getArcpPostgresCoverage();
  const dateColumn = toCoverageDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn));

  if (postgresCoversFullRange(startDate, endDate, coverage, dateColumn)) {
    const aggregates = await enrichAggregatesForResponse(await queryArcpClaimsAggregates(opts), {
      fromPostgres: true,
    });
    await recordAggChunkForJob(opts, aggregates);
    const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
    return {
      aggregates,
      source: 'postgres',
      grandTotals,
      chunkMeta: { cachedChunks: 0, fetchedChunks: 1, totalChunks: 1 },
    };
  }

  const segments = planArcpCoverageSegments(startDate, endDate, coverage, dateColumn);

  const merged: ArcpClaimsAggregateRow[] = [];
  const chunkMetaParts: ArcpChunkLoadMeta[] = [];
  let usedPostgres = false;
  let usedCrm = false;

  for (const segment of segments) {
    const segOpts: ArcpClaimsQueryOpts = {
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    };

    if (segment.mode === 'postgres') {
      const pgRows = await enrichAggregatesForResponse(await queryArcpClaimsAggregates(segOpts), {
        fromPostgres: true,
      });
      merged.push(...pgRows);
      usedPostgres = true;
      continue;
    }

    if (!arcpCrmFallbackOnEmptyEnabled()) continue;

    const estimateHints = { usePostgres: true, coverage };
    const crmChunks = planArcpSummaryDateChunks({ ...segOpts, crmUiFast: true }, estimateHints);
    for (const chunk of crmChunks) {
      const chunkOpts: ArcpClaimsQueryOpts = {
        ...segOpts,
        startDate: chunk.start,
        endDate: chunk.end,
        crmUiFast: true,
      };
      const { aggregates: chunkRows, chunkMeta } = await fetchArcpClaimsAggregatesFromCrm(
        chunkOpts,
        CRM_QUERY_TIMEOUT_MS
      );
      merged.push(...chunkRows);
      chunkMetaParts.push(chunkMeta);
    }
    usedCrm = true;
  }

  const aggregates = await enrichAggregatesForResponse(
    mergeArcpAggregateRows(merged, ARCP_MERGE_ACROSS_CHUNKS)
  );
  const source: ArcpDataSource =
    usedPostgres && usedCrm ? 'crm_fallback' : usedCrm ? 'crm_fallback' : 'postgres';

  const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
  return {
    aggregates,
    source,
    grandTotals,
    chunkMeta: mergeArcpChunkMeta(chunkMetaParts),
  };
}

async function loadArcpDetailCoverageAware(
  opts: ArcpFetchOpts
): Promise<{
  rows: ArcpClaimsDetailRow[];
  source: ArcpDataSource;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!startDate || !endDate) {
    const rows = await queryArcpClaimsDetailRows(opts);
    return { rows, source: 'postgres', chunkMeta: emptyArcpChunkMeta(0) };
  }

  if (readArcpFromPostgres()) {
    const coverage = await getArcpPostgresCoverage();
    const hints = { usePostgres: true as const, coverage };
    // Must match startOrResumeLoadJob / planArcpLoadJobChunks(detail) or markChunkDone
    // never hits weekly job rows and the export UI stays at 0%.
    const chunks = opts.jobId
      ? planArcpLoadJobChunks(opts, hints, { kind: 'detail' })
      : planArcpSummaryDateChunks(opts, hints);
    if (!opts.jobId || chunks.length <= 1) {
      const rows = await queryArcpClaimsDetailRows(opts);
      if (opts.jobId) {
        await recordDetailChunkForJob(opts, rows);
      }
      return {
        rows,
        source: 'postgres',
        chunkMeta: { cachedChunks: 0, fetchedChunks: 1, totalChunks: 1 },
      };
    }

    const mergedParts = await runPool(
      chunks,
      resolveArcpLoadConcurrency(opts, {
        chunkCount: chunks.length,
        spanDays: arcpDateSpanDays(startDate, endDate) ?? 0,
        chunkGranularity: 'week',
        usePostgres: true,
      }),
      async (chunk) => {
        const chunkOpts: ArcpFetchOpts = { ...opts, startDate: chunk.start, endDate: chunk.end };
        const chunkRows = await queryArcpClaimsDetailRows(chunkOpts);
        await recordDetailChunkForJob(chunkOpts, chunkRows);
        return chunkRows;
      }
    );

    return {
      rows: mergeArcpDetailRows(mergedParts.flat()),
      source: 'postgres',
      chunkMeta: { cachedChunks: 0, fetchedChunks: chunks.length, totalChunks: chunks.length },
    };
  }

  const coverage = await getArcpPostgresCoverage();
  const dateColumn = toCoverageDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn));
  const segments = planArcpCoverageSegments(startDate, endDate, coverage, dateColumn);

  const merged: ArcpClaimsDetailRow[] = [];
  const chunkMetaParts: ArcpChunkLoadMeta[] = [];
  let usedPostgres = false;
  let usedCrm = false;

  for (const segment of segments) {
    const segOpts: ArcpFetchOpts = {
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    };

    if (segment.mode === 'postgres') {
      merged.push(...(await queryArcpClaimsDetailRows(segOpts)));
      usedPostgres = true;
      continue;
    }

    if (!arcpCrmFallbackOnEmptyEnabled()) continue;

    const estimateHints = { usePostgres: true, coverage };
    const crmChunks = planArcpSummaryDateChunks(segOpts, estimateHints);
    for (const chunk of crmChunks) {
      const { rows: chunkRows, chunkMeta } = await fetchArcpClaimsDetailRowsFromCrm(
        { ...segOpts, startDate: chunk.start, endDate: chunk.end },
        CRM_QUERY_TIMEOUT_MS
      );
      merged.push(...chunkRows);
      chunkMetaParts.push(chunkMeta);
    }
    usedCrm = true;
  }

  const mergedRows = mergeArcpDetailRows(merged);
  const source: ArcpDataSource =
    usedPostgres && usedCrm ? 'crm_fallback' : usedCrm ? 'crm_fallback' : 'postgres';
  const chunkMeta = mergeArcpChunkMeta(chunkMetaParts);

  if (mergedRows.length === 0) return { rows: mergedRows, source, chunkMeta };

  const lookups = await loadArcpCrmLabelLookups();
  return { rows: enrichArcpDetailRows(mergedRows, lookups), source, chunkMeta };
}

async function fetchArcpClaimsAggregatesFromCrm(
  opts: ArcpFetchOpts,
  timeoutMs: number
): Promise<{ aggregates: ArcpClaimsAggregateRow[]; chunkMeta: ArcpChunkLoadMeta }> {
  const [lookups, result] = await Promise.all([
    loadArcpCrmLabelLookups(),
    fetchArcpClaimsAggregates(opts, timeoutMs),
  ]);
  return {
    aggregates: enrichArcpAggregateLabels(result.aggregates, lookups),
    chunkMeta: result.chunkMeta,
  };
}

async function fetchArcpClaimsDetailRowsFromCrm(
  opts: ArcpFetchOpts,
  timeoutMs: number
): Promise<{ rows: ArcpClaimsDetailRow[]; chunkMeta: ArcpChunkLoadMeta }> {
  const [lookups, result] = await Promise.all([
    loadArcpCrmLabelLookups(),
    fetchArcpClaimsDetailRows(opts, timeoutMs),
  ]);
  return {
    rows: enrichArcpDetailRows(result.rows, lookups),
    chunkMeta: result.chunkMeta,
  };
}

export async function loadArcpClaimsAggregatesHybrid(
  opts: ArcpFetchOpts
): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  if (!readArcpFromPostgres()) {
    const { aggregates, chunkMeta } = await fetchArcpClaimsAggregatesFromCrm(
      opts,
      CRM_QUERY_TIMEOUT_MS
    );
    return {
      aggregates,
      source: 'crm',
      grandTotals: deriveArcpGrandTotalsFromAggregates(aggregates),
      chunkMeta,
    };
  }

  const readiness = await getArcpReadiness();
  if (!readiness.ready || readiness.rowCount === 0) {
    if (!arcpCrmFallbackOnEmptyEnabled()) {
      const err = new Error(readiness.reason ?? 'ARCP claims data is not ready yet');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }
    const { aggregates, chunkMeta } = await fetchArcpClaimsAggregatesFromCrm(
      opts,
      CRM_QUERY_TIMEOUT_MS
    );
    return {
      aggregates,
      source: 'crm_fallback',
      grandTotals: deriveArcpGrandTotalsFromAggregates(aggregates),
      chunkMeta,
    };
  }

  return loadArcpAggregatesCoverageAware(opts);
}

export async function loadArcpClaimsDetailRowsHybrid(
  opts: ArcpFetchOpts
): Promise<{
  rows: ArcpClaimsDetailRow[];
  source: ArcpDataSource;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  if (!readArcpFromPostgres()) {
    const { rows, chunkMeta } = await fetchArcpClaimsDetailRowsFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return { rows, source: 'crm', chunkMeta };
  }

  const readiness = await getArcpReadiness();
  if (!readiness.ready || readiness.rowCount === 0) {
    if (!arcpCrmFallbackOnEmptyEnabled()) {
      const err = new Error(readiness.reason ?? 'ARCP claims data is not ready yet');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }
    const { rows, chunkMeta } = await fetchArcpClaimsDetailRowsFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return { rows, source: 'crm_fallback', chunkMeta };
  }

  return loadArcpDetailCoverageAware(opts);
}
