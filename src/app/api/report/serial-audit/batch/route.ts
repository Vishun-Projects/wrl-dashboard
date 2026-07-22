import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { fetchSerialAuditCallsForSerials } from '@/features/serial-audit/lib/server/batch-fetch';
import { resolveSerialAuditSqlOpts } from '@/features/serial-audit/lib/server/sql-scope';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

/** Matches Serial Audit table page size — one batched CRM query per visible page. */
export const SERIAL_AUDIT_PAGE_BATCH_MAX = 25;

const BATCH_CACHE_TTL = 10 * 60 * 1000;
const batchCache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
const batchInflight = new Map<string, Promise<Record<string, unknown>[]>>();

type BatchQuery = {
  callType: string;
  repair: string;
  branch: string;
  franchisee: string;
  startDate: string;
  endDate: string;
  serials: string[];
};

function normalizeSerials(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  return [...new Set(parts.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
}

function buildBatchCacheKey(
  query: BatchQuery,
  security: { isHod: boolean; assignedOffices: string[] }
): string {
  const serialPart = [...query.serials].sort().join(',');
  return `page_batch_${query.startDate}_${query.endDate}_${query.callType}_${query.repair}_${query.branch}_${query.franchisee}_${serialPart}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

async function fetchPageBatchCalls(
  query: BatchQuery,
  security: { isHod: boolean; assignedOffices: string[] }
): Promise<Record<string, unknown>[]> {
  const serials = query.serials.slice(0, SERIAL_AUDIT_PAGE_BATCH_MAX);
  const sqlOpts = await resolveSerialAuditSqlOpts({
    callType: query.callType,
    repair: query.repair,
    branch: query.branch,
    franchisee: query.franchisee,
    startDate: query.startDate,
    endDate: query.endDate,
    isHod: security.isHod,
    assignedOffices: security.assignedOffices,
  });
  return fetchSerialAuditCallsForSerials(serials, sqlOpts);
}

async function handleBatchRequest(query: BatchQuery) {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const security = await resolveReportSecurity(user.id, { pageId: 'serial_audit' });
  if (security.forbidden) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!query.startDate || !query.endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 });
  }

  if (query.serials.length === 0) {
    return NextResponse.json({ calls: [], serials: [], cached: false });
  }

  if (query.serials.length > SERIAL_AUDIT_PAGE_BATCH_MAX) {
    return NextResponse.json(
      { error: `At most ${SERIAL_AUDIT_PAGE_BATCH_MAX} serials per batch request` },
      { status: 400 }
    );
  }

  const cacheKey = buildBatchCacheKey(query, security);
  const now = Date.now();
  const cached = batchCache.get(cacheKey);
  if (cached && now - cached.timestamp < BATCH_CACHE_TTL) {
    return NextResponse.json({
      calls: cached.data,
      serials: query.serials,
      cached: true,
    });
  }

  let inflight = batchInflight.get(cacheKey);
  if (!inflight) {
    inflight = fetchPageBatchCalls(query, security);
    batchInflight.set(cacheKey, inflight);
  }

  try {
    const calls = await inflight;
    batchCache.set(cacheKey, { data: calls, timestamp: now });
    return NextResponse.json({ calls, serials: query.serials, cached: false });
  } finally {
    batchInflight.delete(cacheKey);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return handleBatchRequest({
      callType: String(body.callType || 'All'),
      repair: String(body.repair || body.complaint || 'All'),
      branch: String(body.branch || ''),
      franchisee: String(body.franchisee || ''),
      startDate: String(body.startDate || ''),
      endDate: String(body.endDate || ''),
      serials: normalizeSerials(body.serials as string[] | string | undefined),
    });
  } catch (err: unknown) {
    console.error('Serial Audit batch API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
