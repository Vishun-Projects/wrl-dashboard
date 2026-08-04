import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { postQuery } from '@/lib/db/proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { enrichCallRowForReport } from '@/lib/geo/pincode-geo';
import {
  fetchSerialAuditCallsForSerials,
  flaggedSerialsFromListRows,
} from '@/modules/serial-audit/server/batch-fetch';
import { resolveSerialAuditSqlOpts } from '@/sql/serial-audit/sql-scope';
import {
  buildSerialAuditDetailRawSql,
  buildSerialAuditListRawSql,
  buildSerialAuditWindowListCountRawSql,
} from '@/sql/trhcalls/query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

const DETAIL_CACHE_TTL = 15 * 60 * 1000;
const SERIAL_AUDIT_LIST_TIMEOUT_MS = 300000;
export const SERIAL_AUDIT_LIST_PAGE_SIZE = 25;
const SERIAL_AUDIT_EXPORT_MAX = 10_000;

const detailCache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
const detailInflight = new Map<string, Promise<Record<string, unknown>[]>>();
const pageInflight = new Map<
  string,
  Promise<{ serials: Record<string, unknown>[]; total: number }>
>();

type SecurityContext = { isHod: boolean; assignedOffices: string[]; forbidden?: boolean };

function mapDetailRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) => enrichCallRowForReport(row));
}

type SerialAuditScopeParams = {
  callType: string;
  repair: string;
  branch: string;
  franchisee: string;
  startDate: string | null;
  endDate: string | null;
};

function scopeFromSearchParams(searchParams: URLSearchParams): SerialAuditScopeParams {
  return {
    callType: searchParams.get('callType') || 'All',
    repair: searchParams.get('repair') || searchParams.get('complaint') || 'All',
    branch: searchParams.get('branch') || '',
    franchisee: searchParams.get('franchisee') || '',
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
  };
}

async function sqlOptsFromScope(scope: SerialAuditScopeParams, security: SecurityContext) {
  return resolveSerialAuditSqlOpts({
    callType: scope.callType,
    repair: scope.repair,
    branch: scope.branch,
    franchisee: scope.franchisee,
    startDate: scope.startDate,
    endDate: scope.endDate,
    isHod: security.isHod,
    assignedOffices: security.assignedOffices,
  });
}

function buildDetailCacheKey(
  serial: string,
  scope: SerialAuditScopeParams,
  security: SecurityContext
): string {
  return `detail_${serial}_${scope.startDate || 'all'}_${scope.endDate || 'all'}_${scope.callType}_${scope.repair}_${scope.branch}_${scope.franchisee}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

function buildPageInflightKey(
  scope: SerialAuditScopeParams,
  minRepeats: number,
  search: string,
  page: number,
  limit: number | null,
  security: SecurityContext,
  mode: 'page' | 'export' | 'analysis'
): string {
  return [
    mode,
    scope.startDate || 'all',
    scope.endDate || 'all',
    scope.callType,
    scope.repair,
    scope.branch,
    scope.franchisee,
    minRepeats,
    search,
    page,
    limit ?? 'all',
    security.isHod ? 'hod' : security.assignedOffices.join('-'),
  ].join('|');
}

async function fetchSerialDetails(
  cacheKey: string,
  serial: string,
  scope: SerialAuditScopeParams,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const inflight = detailInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async () => {
    const sqlOpts = await sqlOptsFromScope(scope, security);
    const res = await postQuery({
      rawSql: buildSerialAuditDetailRawSql(serial, sqlOpts),
      timeoutMs: 120000,
    });
    return mapDetailRows((res.data || []) as Record<string, unknown>[]);
  })();

  detailInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    detailInflight.delete(cacheKey);
  }
}

async function fetchRepeatedSerialPage(input: {
  scope: SerialAuditScopeParams;
  minRepeats: number;
  search: string;
  page: number;
  limit: number | null;
  security: SecurityContext;
  mode: 'page' | 'export' | 'analysis';
}): Promise<{ serials: Record<string, unknown>[]; total: number }> {
  const cacheKey = buildPageInflightKey(
    input.scope,
    input.minRepeats,
    input.search,
    input.page,
    input.limit,
    input.security,
    input.mode
  );
  const inflight = pageInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async () => {
    const sqlOpts = await sqlOptsFromScope(input.scope, input.security);
    const listOpts = {
      minRepeats: input.minRepeats,
      serialSearch: input.search || undefined,
      ...sqlOpts,
    };

    if (input.limit == null) {
      const res = await postQuery({
        rawSql: buildSerialAuditListRawSql({
          ...listOpts,
          ...(input.mode === 'export' ? { limit: SERIAL_AUDIT_EXPORT_MAX, offset: 0 } : {}),
        }),
        timeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
      });
      const serials = (res.data || []) as Record<string, unknown>[];
      return { serials, total: serials.length };
    }

    const offset = (input.page - 1) * input.limit;
    const [pageRes, countRes] = await Promise.all([
      postQuery({
        rawSql: buildSerialAuditListRawSql({
          ...listOpts,
          offset,
          limit: input.limit,
        }),
        timeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
      }),
      postQuery({
        rawSql: buildSerialAuditWindowListCountRawSql(listOpts),
        timeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
      }),
    ]);

    const serials = (pageRes.data || []) as Record<string, unknown>[];
    const total = Number((countRes.data?.[0] as { total?: unknown } | undefined)?.total ?? 0);
    return { serials, total: Number.isFinite(total) ? total : 0 };
  })();

  pageInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    pageInflight.delete(cacheKey);
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id, { pageId: 'serial_audit' });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const scope = scopeFromSearchParams(searchParams);
    const serial = (searchParams.get('serial') || '').trim().toUpperCase();
    const bypassCache = searchParams.get('refresh') === 'true';
    const minRepeats = Math.max(2, Number(searchParams.get('minRepeats') || 2) || 2);
    const search = (searchParams.get('search') || '').trim();
    const exportMode = searchParams.get('export') === '1' || searchParams.get('export') === 'true';
    const includeAnalysisCalls = searchParams.get('includeAnalysisCalls') === 'true';
    const riskThreshold = Math.max(1, Number(searchParams.get('riskThreshold') || 3) || 3);
    const page = Math.max(1, Math.floor(Number(searchParams.get('page') || 1) || 1));
    const limitRaw = Number(searchParams.get('limit') || SERIAL_AUDIT_LIST_PAGE_SIZE);
    const limit = Math.min(
      SERIAL_AUDIT_LIST_PAGE_SIZE,
      Math.max(1, Math.floor(Number.isFinite(limitRaw) ? limitRaw : SERIAL_AUDIT_LIST_PAGE_SIZE))
    );
    const now = Date.now();

    if (serial) {
      const allTime = searchParams.get('allTime') === 'true';
      const detailScope = allTime
        ? ('all-time' as const)
        : scope.startDate && scope.endDate
          ? ('window' as const)
          : ('all-time' as const);
      const detailScopeParams: SerialAuditScopeParams = allTime
        ? { ...scope, startDate: null, endDate: null }
        : scope;
      const cacheKey = buildDetailCacheKey(serial, detailScopeParams, security);
      if (!bypassCache && detailCache.has(cacheKey)) {
        const cached = detailCache.get(cacheKey)!;
        if (now - cached.timestamp < DETAIL_CACHE_TTL) {
          return NextResponse.json({ calls: cached.data, serial, cached: true, scope: detailScope });
        }
      }

      const calls = await fetchSerialDetails(cacheKey, serial, detailScopeParams, security);
      detailCache.set(cacheKey, { data: calls, timestamp: now });
      return NextResponse.json({ calls, serial, cached: false, scope: detailScope });
    }

    if (!scope.startDate || !scope.endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    // Full flagged list for analysis mode (UI uses paged list; this path still needs all rows).
    if (includeAnalysisCalls) {
      const { serials } = await fetchRepeatedSerialPage({
        scope,
        minRepeats,
        search,
        page: 1,
        limit: null,
        security,
        mode: 'analysis',
      });

      const flaggedTotal = serials.filter(
        (row) => Number(row.complaint_count) >= riskThreshold
      ).length;
      const flaggedSerials = flaggedSerialsFromListRows(serials, riskThreshold);
      const sqlOpts = await sqlOptsFromScope(scope, security);
      const analysisCalls =
        flaggedSerials.length > 0
          ? await fetchSerialAuditCallsForSerials(flaggedSerials, {
              ...sqlOpts,
              repair: scope.repair,
              involvementRepairs: true,
              queryTimeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
            })
          : [];

      return NextResponse.json({
        serials,
        total: serials.length,
        page: 1,
        limit: serials.length,
        analysisCalls,
        analysisSerialsRequested: flaggedTotal,
        analysisSerialsFetched: flaggedSerials.length,
        cached: false,
        scope: 'window',
      });
    }

    if (exportMode) {
      const { serials, total } = await fetchRepeatedSerialPage({
        scope,
        minRepeats,
        search,
        page: 1,
        limit: null,
        security,
        mode: 'export',
      });
      return NextResponse.json({
        serials,
        total,
        page: 1,
        limit: serials.length,
        cached: false,
        scope: 'window',
        export: true,
      });
    }

    const { serials, total } = await fetchRepeatedSerialPage({
      scope,
      minRepeats,
      search,
      page,
      limit,
      security,
      mode: 'page',
    });

    return NextResponse.json({
      serials,
      total,
      page,
      limit,
      cached: false,
      scope: 'window',
    });
  } catch (err: unknown) {
    console.error('Serial Audit API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
