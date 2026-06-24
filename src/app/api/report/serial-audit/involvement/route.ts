import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import {
  fetchSerialAuditCallsForSerials,
  MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS,
} from '@/lib/serial-audit/server/batch-fetch';
import { resolveSerialAuditSqlOpts } from '@/lib/serial-audit/server/sql-scope';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

const INVOLVEMENT_CACHE_TTL = 15 * 60 * 1000;
const involvementCache = new Map<
  string,
  { data: Record<string, unknown>[]; timestamp: number }
>();
const involvementInflight = new Map<string, Promise<Record<string, unknown>[]>>();

type InvolvementQuery = {
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

function buildInvolvementCacheKey(
  query: InvolvementQuery,
  security: { isHod: boolean; assignedOffices: string[] }
): string {
  return `involvement_${query.startDate}_${query.endDate}_${query.callType}_${query.repair}_${query.branch}_${query.franchisee}_${query.serials.join('-')}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
}

async function fetchInvolvementCallsBatched(
  query: InvolvementQuery,
  security: { isHod: boolean; assignedOffices: string[] }
): Promise<Record<string, unknown>[]> {
  const serials = query.serials.slice(0, MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS);
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
  return fetchSerialAuditCallsForSerials(serials, {
    ...sqlOpts,
    involvementRepairs: true,
  });
}

async function handleInvolvementRequest(query: InvolvementQuery) {
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

  const cacheKey = buildInvolvementCacheKey(query, security);
  const now = Date.now();
  const cached = involvementCache.get(cacheKey);
  if (cached && now - cached.timestamp < INVOLVEMENT_CACHE_TTL) {
    return NextResponse.json({
      calls: cached.data,
      serials: query.serials,
      cached: true,
    });
  }

  let inflight = involvementInflight.get(cacheKey);
  if (!inflight) {
    inflight = fetchInvolvementCallsBatched(query, security);
    involvementInflight.set(cacheKey, inflight);
  }

  try {
    const calls = await inflight;
    involvementCache.set(cacheKey, { data: calls, timestamp: now });
    return NextResponse.json({ calls, serials: query.serials, cached: false });
  } finally {
    involvementInflight.delete(cacheKey);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    return handleInvolvementRequest({
      callType: searchParams.get('callType') || 'All',
      repair: searchParams.get('repair') || searchParams.get('complaint') || 'All',
      branch: searchParams.get('branch') || '',
      franchisee: searchParams.get('franchisee') || '',
      startDate: searchParams.get('startDate') || '',
      endDate: searchParams.get('endDate') || '',
      serials: normalizeSerials(searchParams.get('serials')),
    });
  } catch (err: unknown) {
    console.error('Serial Audit involvement API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    return handleInvolvementRequest({
      callType: String(body.callType || 'All'),
      repair: String(body.repair || body.complaint || 'All'),
      branch: String(body.branch || ''),
      franchisee: String(body.franchisee || ''),
      startDate: String(body.startDate || ''),
      endDate: String(body.endDate || ''),
      serials: normalizeSerials(body.serials as string[] | string | undefined),
    });
  } catch (err: unknown) {
    console.error('Serial Audit involvement API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
