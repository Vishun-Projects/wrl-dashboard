import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';
import {
  appendCallTypeFilter,
  appendOfficeSecurityFilter,
  buildCorpusFieldsSql,
  buildCorpusTableName,
  CORPUS_MAX_ROWS,
  enrichTrhcallBranchFranchisee,
  MAX_CLIENT_CORPUS_DAYS,
  TRHCALLS_EXCLUDE_TRANSFERRED,
} from '@/lib/trhcalls-query';
import { applyPincodeGeo } from '@/lib/report-geo';
import { CORPUS_SERVER_CACHE_TTL_MS } from '@/lib/report-corpus';
import { readCorpusDiskCache, writeCorpusDiskCache } from '@/lib/corpus-server-cache';

const CORPUS_CACHE_TTL = CORPUS_SERVER_CACHE_TTL_MS;
const CORPUS_TIMEOUT_MS = 300000;
/** Fetch corpus in date slices so CRM DB connections do not reset on wide ranges. */
const CORPUS_CHUNK_DAYS = 14;
const CORPUS_CHUNK_TIMEOUT_MS = 120000;

const fullCache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
const fullInflight = new Map<string, Promise<Record<string, unknown>[]>>();

async function resolveCachedCorpus(
  cacheKey: string,
  bypassCache: boolean
): Promise<{ data: Record<string, unknown>[]; timestamp: number; stale: boolean; source: string } | null> {
  if (bypassCache) return null;

  const now = Date.now();
  const mem = fullCache.get(cacheKey);
  if (mem) {
    const fresh = now - mem.timestamp < CORPUS_CACHE_TTL;
    return { data: mem.data, timestamp: mem.timestamp, stale: !fresh, source: 'memory' };
  }

  const disk = await readCorpusDiskCache(cacheKey);
  if (!disk) return null;

  fullCache.set(cacheKey, { data: disk.calls, timestamp: disk.timestamp });
  const fresh = now - disk.timestamp < CORPUS_CACHE_TTL;
  return {
    data: disk.calls,
    timestamp: disk.timestamp,
    stale: !fresh,
    source: 'disk',
  };
}

function scheduleCorpusRefresh(
  cacheKey: string,
  startDate: string | null,
  endDate: string | null,
  callType: string,
  security: SecurityContext
): void {
  if (fullInflight.has(cacheKey)) return;

  const rangeClamp = clampCorpusDateRange(startDate, endDate);
  void fetchCorpusFull(
    cacheKey,
    rangeClamp.startDate,
    rangeClamp.endDate,
    callType,
    security
  ).catch((err) => {
    console.warn('Background corpus refresh failed:', err);
  });
}

type SecurityContext = { isHod: boolean; assignedOffices: string[] };

function clampCorpusDateRange(
  startDate: string | null,
  endDate: string | null
): {
  startDate: string | null;
  endDate: string | null;
  clamped: boolean;
  warning?: string;
} {
  if (!startDate || !endDate) return { startDate, endDate, clamped: false };
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { startDate, endDate, clamped: false };
  }
  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
    return { startDate, endDate, clamped: false };
  }
  const clampedStart = new Date(end);
  clampedStart.setDate(clampedStart.getDate() - (MAX_CLIENT_CORPUS_DAYS - 1));
  return {
    startDate: clampedStart.toISOString().slice(0, 10),
    endDate,
    clamped: true,
    warning: `Corpus limited to the most recent ${MAX_CLIENT_CORPUS_DAYS} days. Use Serial Audit for full history in wide ranges.`,
  };
}

async function resolveSecurity(userId: string): Promise<SecurityContext & { forbidden?: boolean }> {
  const permissions = await (prisma as any).getUserPermissions(userId);
  if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
    return { isHod: false, assignedOffices: [], forbidden: true };
  }

  const userProfileResult = await prisma.$queryRawUnsafe(
    'SELECT office_ids, role FROM public.app_users WHERE id = $1 LIMIT 1',
    userId
  );
  const profile = (userProfileResult as { office_ids?: string[]; role?: string }[])?.[0];
  const assignedOffices = profile?.office_ids || [];
  const isHod =
    permissions.includes('view_all_offices') ||
    ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(
      profile?.role || ''
    );

  return { isHod, assignedOffices };
}

function buildCorpusCondition(
  callType: string | null,
  security: SecurityContext
): string {
  let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
  condition = appendCallTypeFilter(condition, callType);
  condition = appendOfficeSecurityFilter(condition, security.isHod, security.assignedOffices);
  return condition;
}

function mapCorpusRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) =>
    enrichTrhcallBranchFranchisee({
      ...applyPincodeGeo(row),
      franchisee_code: row.franchisee_code ?? 'UNASSIGNED',
      franchisee_name: row.franchisee_name ?? 'Unallocated',
    })
  );
}

function corpusRowKey(row: Record<string, unknown>): string {
  const trn = row.vtrnno ?? row.UniqueCallNo;
  if (trn != null && String(trn).trim() !== '') return String(trn).trim();
  const id = row.ncode ?? row.id;
  return id != null ? String(id) : '';
}

function splitDateRange(
  startDate: string,
  endDate: string,
  chunkDays: number
): Array<{ start: string; end: string }> {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [{ start: startDate, end: endDate }];
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  if (spanDays <= chunkDays) {
    return [{ start: startDate, end: endDate }];
  }

  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor.getTime() + (chunkDays - 1) * dayMs);
    const effectiveEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      start: cursor.toISOString().slice(0, 10),
      end: effectiveEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(effectiveEnd.getTime() + dayMs);
  }
  return chunks;
}

async function fetchCorpusSlice(
  startDate: string | null,
  endDate: string | null,
  callType: string,
  security: SecurityContext,
  timeoutMs: number
): Promise<Record<string, unknown>[]> {
  const res = await postQuery({
    fields: buildCorpusFieldsSql(),
    tableName: buildCorpusTableName({ startDate, endDate }),
    condition: buildCorpusCondition(callType, security),
    orderBy: 'tc.dtrndate DESC',
    timeoutMs,
  });
  return mapCorpusRows((res.data || []) as Record<string, unknown>[]);
}

async function fetchCorpusFullMerged(
  startDate: string | null,
  endDate: string | null,
  callType: string,
  security: SecurityContext
): Promise<{ calls: Record<string, unknown>[]; truncated: boolean; partial: boolean }> {
  if (!startDate || !endDate) {
    const calls = await fetchCorpusSlice(startDate, endDate, callType, security, CORPUS_TIMEOUT_MS);
    const capped = calls.length > CORPUS_MAX_ROWS ? calls.slice(0, CORPUS_MAX_ROWS) : calls;
    return { calls: capped, truncated: calls.length >= CORPUS_MAX_ROWS, partial: false };
  }

  const chunks = splitDateRange(startDate, endDate, CORPUS_CHUNK_DAYS);
  if (chunks.length === 1) {
    const calls = await fetchCorpusSlice(startDate, endDate, callType, security, CORPUS_TIMEOUT_MS);
    const capped = calls.length > CORPUS_MAX_ROWS ? calls.slice(0, CORPUS_MAX_ROWS) : calls;
    return { calls: capped, truncated: calls.length >= CORPUS_MAX_ROWS, partial: false };
  }

  const merged = new Map<string, Record<string, unknown>>();
  let failedChunks = 0;

  for (const chunk of chunks) {
    try {
      const rows = await fetchCorpusSlice(
        chunk.start,
        chunk.end,
        callType,
        security,
        CORPUS_CHUNK_TIMEOUT_MS
      );
      for (const row of rows) {
        const key = corpusRowKey(row);
        if (key) merged.set(key, row);
      }
      if (merged.size >= CORPUS_MAX_ROWS) break;
    } catch (err) {
      failedChunks++;
      console.warn(`Corpus chunk ${chunk.start}–${chunk.end} failed:`, err);
    }
  }

  if (merged.size === 0 && failedChunks > 0) {
    throw new Error(
      `Corpus load failed (${failedChunks}/${chunks.length} date chunks could not be loaded)`
    );
  }

  let calls = Array.from(merged.values()).sort((a, b) =>
    String(b.callsdtrndate ?? '').localeCompare(String(a.callsdtrndate ?? ''))
  );
  const truncated = calls.length >= CORPUS_MAX_ROWS;
  if (truncated) {
    calls = calls.slice(0, CORPUS_MAX_ROWS);
  }

  return { calls, truncated, partial: failedChunks > 0 };
}

async function fetchCorpusFull(
  cacheKey: string,
  startDate: string | null,
  endDate: string | null,
  callType: string,
  security: SecurityContext
): Promise<{ calls: Record<string, unknown>[]; truncated: boolean; partial?: boolean }> {
  const inflight = fullInflight.get(cacheKey);
  if (inflight) {
    const calls = await inflight;
    return { calls, truncated: calls.length >= CORPUS_MAX_ROWS };
  }

  const run = (async () => {
    const { calls, truncated, partial } = await fetchCorpusFullMerged(
      startDate,
      endDate,
      callType,
      security
    );
    return { calls, truncated, partial };
  })();

  fullInflight.set(cacheKey, run.then((r) => r.calls));
  try {
    const result = await run;
    fullCache.set(cacheKey, { data: result.calls, timestamp: Date.now() });
    void writeCorpusDiskCache(cacheKey, result.calls).catch((err) => {
      console.warn('Corpus disk cache write failed:', err);
    });
    return result;
  } finally {
    fullInflight.delete(cacheKey);
  }
}

async function fetchCorpusDelta(
  startDate: string | null,
  endDate: string | null,
  callType: string,
  lastSync: string,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const res = await postQuery({
    fields: buildCorpusFieldsSql(),
    tableName: buildCorpusTableName({ startDate, endDate, lastSync }),
    condition: buildCorpusCondition(callType, security),
    orderBy: 'tc.dtrndate DESC',
    timeoutMs: 120000,
  });
  return mapCorpusRows((res.data || []) as Record<string, unknown>[]);
}

export async function GET(req: NextRequest) {
  let staleCacheKey: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    } else {
      const supabase = await createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    }

    const security = await resolveSecurity(userId);
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const callType = searchParams.get('callType') || 'All';
    const lastSync = searchParams.get('lastSync');
    const bypassCache = searchParams.get('refresh') === 'true';

    if (lastSync) {
      const deltaCalls = await fetchCorpusDelta(
        startDate,
        endDate,
        callType,
        lastSync,
        security
      );
      return NextResponse.json({
        deltaCalls,
        isDelta: true,
        scope: 'window',
      });
    }

    const cacheKey = `corpus_${startDate || 'default'}_${endDate || 'default'}_${callType}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
    staleCacheKey = cacheKey;

    const cached = await resolveCachedCorpus(cacheKey, bypassCache);
    if (cached) {
      if (cached.stale) {
        scheduleCorpusRefresh(cacheKey, startDate, endDate, callType, security);
      }
      return NextResponse.json({
        calls: cached.data,
        cached: true,
        stale: cached.stale,
        cacheSource: cached.source,
        scope: 'window',
        truncated: cached.data.length >= CORPUS_MAX_ROWS,
        cacheAgeMs: Date.now() - cached.timestamp,
      });
    }

    const rangeClamp = clampCorpusDateRange(startDate, endDate);
    const effectiveStart = rangeClamp.startDate;
    const effectiveEnd = rangeClamp.endDate;

    const { calls, truncated, partial } = await fetchCorpusFull(
      cacheKey,
      effectiveStart,
      effectiveEnd,
      callType,
      security
    );

    const warnings: string[] = [];
    if (rangeClamp.clamped && rangeClamp.warning) {
      warnings.push(rangeClamp.warning);
    }
    if (truncated) {
      warnings.push(`Showing first ${CORPUS_MAX_ROWS} calls. Narrow the date range for full data.`);
    }
    if (partial) {
      warnings.push('Some date ranges could not be loaded; showing partial data.');
    }

    return NextResponse.json({
      calls,
      cached: false,
      scope: 'window',
      truncated,
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    });
  } catch (err: unknown) {
    console.error('Corpus API Error:', err);
    const message = err instanceof Error ? err.message : 'Corpus query failed';

    if (staleCacheKey && fullCache.has(staleCacheKey)) {
      const cached = fullCache.get(staleCacheKey)!;
      return NextResponse.json({
        calls: cached.data,
        cached: true,
        stale: true,
        scope: 'window',
        truncated: cached.data.length >= CORPUS_MAX_ROWS,
        warning: 'Showing cached data — fresh load failed. Try Refresh again.',
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
