import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';
import {
  fetchArcpClaimsAggregates,
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/lib/arcp-claims-fetch';
import { resolveArcpDateFilterColumn } from '@/lib/arcp-claims-query';
import { buildArcpClaimsTableModel } from '@/lib/arcp-claims-table';

const CACHE_TTL = 15 * 60 * 1000;
const QUERY_TIMEOUT_MS = 180000;

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
    if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
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
    const aggregatesOnly = searchParams.get('aggregatesOnly') === 'true';

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

    const cacheKey = buildCacheKey({
      startDate,
      endDate,
      dateFilterColumn,
      branch,
      franchisee,
      callType,
      isHod,
      assignedOffices,
    });

    const queryOpts = {
      startDate,
      endDate,
      dateFilterColumn,
      branch,
      franchisee,
      callType,
      isHod,
      assignedOffices,
    };

    if (aggregatesOnly) {
      const aggregates = await fetchArcpClaimsAggregates(queryOpts, QUERY_TIMEOUT_MS);
      return NextResponse.json({ aggregates });
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
      run = (async () => {
        const aggregates = await fetchArcpClaimsAggregates(queryOpts, QUERY_TIMEOUT_MS);
        const model = buildArcpClaimsTableModel(aggregates);

        return {
          ...model,
          meta: {
            startDate,
            endDate,
            dateFilterColumn,
          },
        };
      })();

      inflight.set(cacheKey, run);
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
            'CRM query returned too much data. Narrow the date range or add branch/franchisee filters.',
        },
        { status: 507 }
      );
    }
    if (isCrmSqlTimeoutError(err)) {
      const message = err instanceof Error ? err.message : '';
      return NextResponse.json(
        {
          error:
            message.includes('CRM timed out loading ARCP tally for')
              ? message
              : 'CRM query timed out while loading part of the date range. Please retry — heavy periods are split automatically.',
        },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to load ARCP claims';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
