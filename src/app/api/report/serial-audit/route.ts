import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { postQuery } from '@/lib/db/proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { enrichCallRowForReport } from '@/lib/geo/pincode-geo';
import {
  fetchSerialAuditCallsForSerials,
  flaggedSerialsFromListRows,
} from '@/features/serial-audit/server/batch-fetch';
import { resolveSerialAuditSqlOpts } from '@/features/serial-audit/server/sql-scope';
import {
  buildSerialAuditDetailRawSql,
  buildSerialAuditListRawSql,
} from '@/lib/trhcalls/query';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

const LIST_CACHE_TTL = 30 * 60 * 1000;
const DETAIL_CACHE_TTL = 15 * 60 * 1000;
const SERIAL_AUDIT_LIST_TIMEOUT_MS = 300000;

const listCache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
const detailCache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
const listInflight = new Map<string, Promise<Record<string, unknown>[]>>();
const detailInflight = new Map<string, Promise<Record<string, unknown>[]>>();

type SecurityContext = { isHod: boolean; assignedOffices: string[]; forbidden?: boolean };

function mapDetailRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) => enrichCallRowForReport(row));
}

function sortSerialList(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort(
    (a, b) => Number(b.complaint_count || 0) - Number(a.complaint_count || 0)
  );
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

function buildListCacheKey(
  scope: SerialAuditScopeParams,
  minRepeats: number,
  security: SecurityContext
): string {
  return `list_${scope.startDate || 'all'}_${scope.endDate || 'all'}_${scope.callType}_${scope.repair}_${scope.branch}_${scope.franchisee}_${minRepeats}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

function buildDetailCacheKey(
  serial: string,
  scope: SerialAuditScopeParams,
  security: SecurityContext
): string {
  return `detail_${serial}_${scope.startDate || 'all'}_${scope.endDate || 'all'}_${scope.callType}_${scope.repair}_${scope.branch}_${scope.franchisee}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

async function fetchRepeatedSerialList(
  cacheKey: string,
  scope: SerialAuditScopeParams,
  minRepeats: number,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const inflight = listInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async () => {
    const sqlOpts = await sqlOptsFromScope(scope, security);
    const res = await postQuery({
      rawSql: buildSerialAuditListRawSql({
        minRepeats,
        ...sqlOpts,
      }),
      timeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
    });
    return sortSerialList((res.data || []) as Record<string, unknown>[]);
  })();

  listInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    listInflight.delete(cacheKey);
  }
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
    const includeAnalysisCalls = searchParams.get('includeAnalysisCalls') === 'true';
    const riskThreshold = Math.max(1, Number(searchParams.get('riskThreshold') || 3) || 3);
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

    const cacheKey = buildListCacheKey(scope, minRepeats, security);
    if (!bypassCache && listCache.has(cacheKey)) {
      const cached = listCache.get(cacheKey)!;
      if (now - cached.timestamp < LIST_CACHE_TTL) {
        return NextResponse.json({ serials: cached.data, cached: true, scope: 'window' });
      }
    }

    const serials = await fetchRepeatedSerialList(cacheKey, scope, minRepeats, security);
    listCache.set(cacheKey, { data: serials, timestamp: now });

    let analysisCalls: Record<string, unknown>[] | undefined;
    let analysisSerialsRequested: number | undefined;
    let analysisSerialsFetched: number | undefined;
    if (includeAnalysisCalls && scope.startDate && scope.endDate) {
      const flaggedTotal = serials.filter(
        (row) => Number(row.complaint_count) >= riskThreshold
      ).length;
      const flaggedSerials = flaggedSerialsFromListRows(serials, riskThreshold);
      analysisSerialsRequested = flaggedTotal;
      analysisSerialsFetched = flaggedSerials.length;
      const sqlOpts = await sqlOptsFromScope(scope, security);
      analysisCalls =
        flaggedSerials.length > 0
          ? await fetchSerialAuditCallsForSerials(flaggedSerials, {
              ...sqlOpts,
              repair: scope.repair,
              involvementRepairs: true,
              queryTimeoutMs: SERIAL_AUDIT_LIST_TIMEOUT_MS,
            })
          : [];
    }

    return NextResponse.json({
      serials,
      analysisCalls,
      analysisSerialsRequested,
      analysisSerialsFetched,
      cached: false,
      scope: 'window',
    });
  } catch (err: unknown) {
    console.error('Serial Audit API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
