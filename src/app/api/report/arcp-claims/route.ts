import { NextRequest, NextResponse } from 'next/server';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/features/arcp/server/fetch';
import { loadArcpClaimsAggregatesHybrid as loadArcpClaimsAggregates } from '@/features/arcp/server/hybrid-load';
import {
  ARCP_CHUNK_CACHE_VERSION,
  clearArcpChunkCaches,
  clearArcpChunkDiskCache,
  type ArcpChunkLoadMeta,
} from '@/features/arcp/server/chunk-cache';
import { clearArcpLoadJobs } from '@/features/arcp/server/load-job';
import { authenticateArcpClaimsRequest } from '@/features/arcp/server/route-auth';
import { safeErrorMessage } from '@/lib/api/safe-error';
import {
  deriveArcpGrandTotalsFromAggregates,
  resolveArcpDateFilterColumn,
  type ArcpGrandTotals,
} from '@/features/arcp/services/query';
import { buildArcpClaimsTableModel } from '@/features/arcp/services/table';

export const maxDuration = 300;

const CACHE_TTL = 15 * 60 * 1000;
const AGG_CACHE_TTL = Number(process.env.ARCP_AGG_CACHE_TTL_MS ?? 60 * 60 * 1000) || 60 * 60 * 1000;

type AggCacheEntry = {
  aggregates: Awaited<ReturnType<typeof loadArcpClaimsAggregates>>['aggregates'];
  grandTotals: ArcpGrandTotals;
  source: string;
  timestamp: number;
  chunkMeta: ArcpChunkLoadMeta;
};

const aggCache = new Map<string, AggCacheEntry>();
const aggInflight = new Map<string, Promise<AggCacheEntry>>();

/** Bump when tally totals logic changes — invalidates in-memory aggregate cache. */
const AGG_CACHE_VERSION = ARCP_CHUNK_CACHE_VERSION;

export function clearArcpClaimsRouteCaches(userId?: string): void {
  aggCache.clear();
  aggInflight.clear();
  cache.clear();
  inflight.clear();
  clearArcpChunkCaches();
  void clearArcpChunkDiskCache();
  void clearArcpLoadJobs(userId);
}

type CacheEntry = {
  payload: ReturnType<typeof buildArcpClaimsTableModel> & {
    meta: {
      startDate: string | null;
      endDate: string | null;
      dateFilterColumn: string;
    };
  };
  timestamp: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry['payload']>>();

function buildCacheKey(params: {
  startDate: string | null;
  endDate: string | null;
  dateFilterColumn: string;
  branch: string | null;
  franchisee: string | null;
  callType: string | null;
  isHod: boolean;
  assignedOffices: string[];
}): string {
  return [
    params.startDate || 'all',
    params.endDate || 'all',
    params.dateFilterColumn,
    params.branch || 'All',
    params.franchisee || 'All',
    params.callType || 'All',
    params.isHod ? 'hod' : params.assignedOffices.join('-'),
  ].join('|');
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get('refresh') === 'true';
    /** Hard bypass of per-period chunk cache (CRM refetch every period). */
    const forceRefresh = searchParams.get('force') === 'true';
    const aggregatesOnly = searchParams.get('aggregatesOnly') === 'true';
    const jobId = searchParams.get('jobId');

    const auth = await authenticateArcpClaimsRequest(req, {
      bypassChunkCache: forceRefresh,
      jobId,
      kind: 'agg',
    });
    if (auth instanceof NextResponse) return auth;

    const {
      startDate,
      endDate,
      branch,
      franchisee,
      callType,
      isHod,
      assignedOffices,
    } = auth.opts;
    const dateFilterColumn = resolveArcpDateFilterColumn(auth.opts.dateFilterColumn);

    const cacheKey = buildCacheKey({
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      dateFilterColumn,
      branch: branch ?? null,
      franchisee: franchisee ?? null,
      callType: callType ?? null,
      isHod: isHod ?? false,
      assignedOffices: assignedOffices ?? [],
    });
    const aggKey = `${AGG_CACHE_VERSION}|${cacheKey}|agg`;

    const queryOpts = {
      ...auth.opts,
      bypassChunkCache: forceRefresh,
      jobId: jobId || undefined,
      loadJobKind: 'agg' as const,
    };

    if (aggregatesOnly) {
      const now = Date.now();
      if (!refresh) {
        const hit = aggCache.get(aggKey);
        if (hit && now - hit.timestamp < AGG_CACHE_TTL) {
          const grandTotals = deriveArcpGrandTotalsFromAggregates(hit.aggregates);
          return NextResponse.json({
            aggregates: hit.aggregates,
            meta: { source: hit.source, grandTotals, cached: true },
          });
        }
      }

      let aggRun = aggInflight.get(aggKey);
      if (!aggRun) {
        aggRun = (async () => {
          const { aggregates, source, chunkMeta } = await loadArcpClaimsAggregates(queryOpts);
          const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
          const entry: AggCacheEntry = {
            aggregates,
            grandTotals,
            source,
            timestamp: Date.now(),
            chunkMeta,
          };
          aggCache.set(aggKey, entry);
          return entry;
        })();
        aggInflight.set(aggKey, aggRun);
      }

      try {
        const { aggregates, source, grandTotals, chunkMeta } = await aggRun;
        return NextResponse.json({
          aggregates,
          meta: {
            source,
            grandTotals,
            cachedChunks: chunkMeta.cachedChunks,
            fetchedChunks: chunkMeta.fetchedChunks,
            totalChunks: chunkMeta.totalChunks,
            cached: chunkMeta.cachedChunks > 0,
            jobId: jobId || undefined,
            chunkStatus: chunkMeta.cachedChunks > 0 ? 'cached' : 'fetched',
          },
        });
      } finally {
        aggInflight.delete(aggKey);
      }
    }

    const now = Date.now();
    if (!refresh) {
      const cached = cache.get(cacheKey);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        return NextResponse.json(cached.payload);
      }
    }

    let run = inflight.get(cacheKey);
    if (!run) {
      const newRun = (async () => {
        const { aggregates, source } = await loadArcpClaimsAggregates(queryOpts);
        const model = buildArcpClaimsTableModel(aggregates);

        return {
          ...model,
          meta: {
            startDate: startDate ?? null,
            endDate: endDate ?? null,
            dateFilterColumn,
            source,
          },
        };
      })();
      inflight.set(cacheKey, newRun);
      run = newRun;
    }

    try {
      const payload = await run;
      cache.set(cacheKey, { payload, timestamp: Date.now() });
      return NextResponse.json(payload);
    } finally {
      inflight.delete(cacheKey);
    }
  } catch (err: unknown) {
    console.error('[ARCP Claims] fetch error:', err);
    if (isCrmOutOfMemoryError(err)) {
      return NextResponse.json(
        {
          error:
            'Query returned too much data. Narrow the date range or add branch/franchisee filters.',
        },
        { status: 507 }
      );
    }
    if (isCrmSqlTimeoutError(err)) {
      return NextResponse.json(
        {
          error:
            'Request timed out while loading part of the date range. Please retry — heavy periods are split automatically.',
        },
        { status: 504 }
      );
    }
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    console.error('[arcp-claims]', err);
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load ARCP claims') },
      { status: statusCode ?? 500 }
    );
  }
}
