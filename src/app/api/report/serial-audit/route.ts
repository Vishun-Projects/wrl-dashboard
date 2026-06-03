import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { enrichCallRowForReport } from '@/lib/report-geo';
import {
  fetchSerialAuditCallsForSerials,
  flaggedSerialsFromListRows,
} from '@/lib/serial-audit-batch-fetch';
import {
  buildSerialAuditDetailRawSql,
  buildSerialAuditListRawSql,
} from '@/lib/trhcalls-query';

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

function buildListCacheKey(
  callType: string,
  repair: string,
  minRepeats: number,
  startDate: string | null,
  endDate: string | null,
  security: SecurityContext
): string {
  return `list_${startDate || 'all'}_${endDate || 'all'}_${callType}_${repair}_${minRepeats}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

function buildDetailCacheKey(
  serial: string,
  callType: string,
  repair: string,
  startDate: string | null,
  endDate: string | null,
  security: SecurityContext
): string {
  return `detail_${serial}_${startDate || 'all'}_${endDate || 'all'}_${callType}_${repair}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

async function fetchRepeatedSerialList(
  cacheKey: string,
  callType: string,
  repair: string,
  minRepeats: number,
  startDate: string | null,
  endDate: string | null,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const inflight = listInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async () => {
    const res = await postQuery({
      rawSql: buildSerialAuditListRawSql({
        minRepeats,
        callType,
        repair,
        isHod: security.isHod,
        assignedOffices: security.assignedOffices,
        startDate,
        endDate,
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
  callType: string,
  repair: string,
  startDate: string | null,
  endDate: string | null,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const inflight = detailInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async () => {
    const res = await postQuery({
      rawSql: buildSerialAuditDetailRawSql(serial, {
        callType,
        repair,
        isHod: security.isHod,
        assignedOffices: security.assignedOffices,
        startDate,
        endDate,
      }),
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
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id, { pagePermission: 'page_serial_audit' });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const callType = searchParams.get('callType') || 'All';
    const repair =
      searchParams.get('repair') || searchParams.get('complaint') || 'All';
    const serial = (searchParams.get('serial') || '').trim().toUpperCase();
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const bypassCache = searchParams.get('refresh') === 'true';
    const minRepeats = Math.max(2, Number(searchParams.get('minRepeats') || 2) || 2);
    const includeAnalysisCalls = searchParams.get('includeAnalysisCalls') === 'true';
    const riskThreshold = Math.max(1, Number(searchParams.get('riskThreshold') || 3) || 3);
    const now = Date.now();

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    if (serial) {
      const cacheKey = buildDetailCacheKey(serial, callType, repair, startDate, endDate, security);
      if (!bypassCache && detailCache.has(cacheKey)) {
        const cached = detailCache.get(cacheKey)!;
        if (now - cached.timestamp < DETAIL_CACHE_TTL) {
          return NextResponse.json({ calls: cached.data, serial, cached: true, scope: 'window' });
        }
      }

      const calls = await fetchSerialDetails(
        cacheKey,
        serial,
        callType,
        repair,
        startDate,
        endDate,
        security
      );
      detailCache.set(cacheKey, { data: calls, timestamp: now });
      return NextResponse.json({ calls, serial, cached: false, scope: 'window' });
    }

    const cacheKey = buildListCacheKey(callType, repair, minRepeats, startDate, endDate, security);
    if (!bypassCache && listCache.has(cacheKey)) {
      const cached = listCache.get(cacheKey)!;
      if (now - cached.timestamp < LIST_CACHE_TTL) {
        return NextResponse.json({ serials: cached.data, cached: true, scope: 'window' });
      }
    }

    const serials = await fetchRepeatedSerialList(
      cacheKey,
      callType,
      repair,
      minRepeats,
      startDate,
      endDate,
      security
    );
    listCache.set(cacheKey, { data: serials, timestamp: now });

    let analysisCalls: Record<string, unknown>[] | undefined;
    if (includeAnalysisCalls && startDate && endDate) {
      const flaggedSerials = flaggedSerialsFromListRows(serials, riskThreshold);
      analysisCalls =
        flaggedSerials.length > 0
          ? await fetchSerialAuditCallsForSerials(flaggedSerials, {
              callType,
              repair: 'All',
              isHod: security.isHod,
              assignedOffices: security.assignedOffices,
              startDate,
              endDate,
            })
          : [];
    }

    return NextResponse.json({ serials, analysisCalls, cached: false, scope: 'window' });
  } catch (err: unknown) {
    console.error('Serial Audit API Error:', err);
    const message = err instanceof Error ? err.message : 'Serial audit query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
