import { NextRequest, NextResponse } from 'next/server';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/features/arcp/lib/server/fetch';
import { loadArcpClaimsDetailRows } from '@/features/arcp/lib/server/detail-load';
import { buildArcpChunkCacheKey } from '@/features/arcp/lib/server/chunk-cache';
import { resolveArcpDateFilterColumn } from '@/features/arcp/lib/query';
import { authenticateArcpClaimsRequest } from '@/features/arcp/lib/server/route-auth';

export const maxDuration = 300;

const DETAIL_ROUTE_CACHE_TTL =
  Number(process.env.ARCP_AGG_CACHE_TTL_MS ?? 60 * 60 * 1000) || 60 * 60 * 1000;

type DetailCacheEntry = {
  rows: Awaited<ReturnType<typeof loadArcpClaimsDetailRows>>['rows'];
  source: string;
  chunkMeta: Awaited<ReturnType<typeof loadArcpClaimsDetailRows>>['chunkMeta'];
  timestamp: number;
};

const detailCache = new Map<string, DetailCacheEntry>();
const detailInflight = new Map<string, Promise<DetailCacheEntry>>();

function buildDetailRouteKey(params: {
  startDate: string | null;
  endDate: string | null;
  dateFilterColumn: string;
  branch: string | null;
  franchisee: string | null;
  callType: string | null;
  isHod: boolean;
  assignedOffices: string[];
}): string {
  return buildArcpChunkCacheKey(
    {
      startDate: params.startDate,
      endDate: params.endDate,
      dateFilterColumn: params.dateFilterColumn,
      branch: params.branch,
      franchisee: params.franchisee,
      callType: params.callType,
      isHod: params.isHod,
      assignedOffices: params.assignedOffices,
    },
    {
      start: params.startDate || 'all',
      end: params.endDate || 'all',
    },
    'detail'
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get('refresh') === 'true';
    const forceRefresh = searchParams.get('force') === 'true';
    const jobId = searchParams.get('jobId');

    const auth = await authenticateArcpClaimsRequest(req, {
      bypassChunkCache: forceRefresh,
      jobId,
      kind: 'detail',
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

    const routeKey = buildDetailRouteKey({
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      dateFilterColumn,
      branch: branch ?? null,
      franchisee: franchisee ?? null,
      callType: callType ?? null,
      isHod: isHod ?? false,
      assignedOffices: assignedOffices ?? [],
    });

    const now = Date.now();
    if (!refresh) {
      const hit = detailCache.get(routeKey);
      if (hit && now - hit.timestamp < DETAIL_ROUTE_CACHE_TTL) {
        return NextResponse.json({
          rows: hit.rows,
          meta: {
            startDate,
            endDate,
            dateFilterColumn,
            rowCount: hit.rows.length,
            source: hit.source,
            cachedChunks: hit.chunkMeta.cachedChunks,
            fetchedChunks: hit.chunkMeta.fetchedChunks,
            totalChunks: hit.chunkMeta.totalChunks,
            cached: true,
          },
        });
      }
    }

    let run = detailInflight.get(routeKey);
    if (!run) {
      run = (async () => {
        const { rows, source, chunkMeta } = await loadArcpClaimsDetailRows({
          ...auth.opts,
          bypassChunkCache: forceRefresh,
          jobId: jobId || undefined,
          loadJobKind: 'detail',
        });
        return {
          rows,
          source,
          chunkMeta,
          timestamp: Date.now(),
        };
      })();
      detailInflight.set(routeKey, run);
    }

    try {
      const entry = await run;
      detailCache.set(routeKey, entry);
      return NextResponse.json({
        rows: entry.rows,
        meta: {
          startDate,
          endDate,
          dateFilterColumn,
          rowCount: entry.rows.length,
          source: entry.source,
          cachedChunks: entry.chunkMeta.cachedChunks,
          fetchedChunks: entry.chunkMeta.fetchedChunks,
          totalChunks: entry.chunkMeta.totalChunks,
          cached: entry.chunkMeta.cachedChunks > 0,
          jobId: jobId || undefined,
          chunkStatus: entry.chunkMeta.cachedChunks > 0 ? 'cached' : 'fetched',
        },
      });
    } finally {
      detailInflight.delete(routeKey);
    }
  } catch (err: unknown) {
    console.error('[ARCP Claims Detail] fetch error:', err);
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
            'Request timed out while loading part of the date range. Please retry.',
        },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to load ARCP claim detail';
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    return NextResponse.json({ error: message }, { status: statusCode ?? 500 });
  }
}
