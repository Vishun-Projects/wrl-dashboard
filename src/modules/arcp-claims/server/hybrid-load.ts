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
  emptyArcpChunkMeta,
  writeArcpChunkCache,
  buildArcpChunkCacheKey,
} from './chunk-cache';
import {
  queryArcpClaimsAggregates,
  queryArcpClaimsDetailRows,
} from '@/sql/arcp-claims/postgres';
import {
  deriveArcpGrandTotalsFromAggregates,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpGrandTotals,
} from '@/sql/arcp-claims/query';
import { getArcpReadiness } from '@/modules/arcp-claims/server/sync/coverage-query';
import { readArcpFromPostgres } from '@/lib/read-model/flags';

const CRM_QUERY_TIMEOUT_MS = Number(process.env.ARCP_CRM_LOAD_TIMEOUT_MS ?? 300_000) || 300_000;

export type ArcpDataSource = 'postgres' | 'crm';

/** @deprecated CRM gap-fill removed — always sync to hot; empty means not synced. */
export function arcpCrmFallbackOnEmptyEnabled(): boolean {
  return false;
}

async function enrichAggregatesForResponse(
  rows: ArcpClaimsAggregateRow[],
  opts?: { fromPostgres?: boolean }
): Promise<ArcpClaimsAggregateRow[]> {
  if (!opts?.fromPostgres || rows.length === 0) return rows;
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

/**
 * Postgres hot only when READ_ARCP_FROM=postgres.
 * Empty hot table / missing range → empty result (daemon sync owns data; no CRM fallback).
 */
export async function loadArcpClaimsAggregatesHybrid(
  opts: ArcpFetchOpts
): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  if (!readArcpFromPostgres()) {
    const { aggregates, chunkMeta } = await fetchArcpClaimsAggregates(opts, CRM_QUERY_TIMEOUT_MS);
    return {
      aggregates,
      source: 'crm',
      grandTotals: deriveArcpGrandTotalsFromAggregates(aggregates),
      chunkMeta,
    };
  }

  // Always read hot — empty means not synced yet (or no rows for filters).
  void (await getArcpReadiness());
  return loadArcpAggregatesPostgresOnly(opts);
}

export async function loadArcpClaimsDetailRowsHybrid(
  opts: ArcpFetchOpts
): Promise<{
  rows: ArcpClaimsDetailRow[];
  source: ArcpDataSource;
  chunkMeta: ArcpChunkLoadMeta;
}> {
  if (!readArcpFromPostgres()) {
    const { rows, chunkMeta } = await fetchArcpClaimsDetailRows(opts, CRM_QUERY_TIMEOUT_MS);
    return { rows, source: 'crm', chunkMeta };
  }

  void (await getArcpReadiness());
  const rows = await queryArcpClaimsDetailRows(opts);
  const lookups = await loadArcpCrmLabelLookups();
  const enriched = enrichArcpDetailRows(rows, lookups);
  await recordDetailChunkForJob(opts, enriched);
  return {
    rows: enriched,
    source: 'postgres',
    chunkMeta: emptyArcpChunkMeta(1),
  };
}
