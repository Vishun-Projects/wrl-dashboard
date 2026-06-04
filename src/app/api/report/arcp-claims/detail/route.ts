import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { prisma } from '@/lib/db/prisma';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/lib/arcp-claims/server/fetch';
import { loadArcpClaimsDetailRows } from '@/lib/arcp-claims/server/detail-load';
import { resolveArcpDateFilterColumn } from '@/lib/arcp-claims/query';
import { hasPagePermission } from '@/lib/auth/page-access';
import { buildArcpChunkCacheKey } from '@/lib/arcp-claims/server/chunk-cache';

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await (prisma as any).getUserPermissions(user.id);
    if (!hasPagePermission(permissions, 'page_arcp_claims')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const dateFilterColumn = resolveArcpDateFilterColumn(searchParams.get('dateFilterColumn'));
    const branch = searchParams.get('branch');
    const franchisee = searchParams.get('franchisee');
    const callType = searchParams.get('callType');
    const refresh = searchParams.get('refresh') === 'true';
    const forceRefresh = searchParams.get('force') === 'true';

    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('office_ids, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = (profile?.office_ids || []).map(String);
    const isHod =
      permissions.includes('view_all_offices') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(
        profile?.role || ''
      );

    const routeKey = buildDetailRouteKey({
      startDate,
      endDate,
      dateFilterColumn,
      branch,
      franchisee,
      callType,
      isHod,
      assignedOffices,
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
          startDate,
          endDate,
          dateFilterColumn,
          branch,
          franchisee,
          callType,
          isHod,
          assignedOffices,
          bypassChunkCache: forceRefresh,
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
