import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { isCrmOutOfMemoryError, postQuery } from '@/lib/db/proxy';

import {
  appendCallTypeFilter,
  appendOfficeSecurityFilter,
  buildCorpusFieldsSql,
  buildCorpusTableName,
  CORPUS_MAX_ROWS,
  MAX_CLIENT_CORPUS_DAYS,
  resolveRegisterDateSqlColumn,
  type RegisterDateFilterColumn,
  TRHCALLS_EXCLUDE_TRANSFERRED,
} from '@/lib/trhcalls/query';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { enrichCallRowForReport } from '@/lib/geo/pincode-geo';
import { CORPUS_SERVER_CACHE_TTL_MS, splitCalendarMonths } from '@/features/report/services/corpus';
import { formatLocalDate } from '@/features/report/services/filters';
import { readCorpusDiskCache, writeCorpusDiskCache } from '@/features/report/server/server-cache';
import { readCallsFromPostgres } from '@/lib/read-model/flags';
import { resolveReportSecurity } from '@/lib/auth/report-security';

const CORPUS_CACHE_TTL = CORPUS_SERVER_CACHE_TTL_MS;
const CORPUS_TIMEOUT_MS = 300000;
/** CRM DBQUERY.aspx OOMs when viewstate exceeds ~few thousand wide rows — subdivide adaptively. */
const CORPUS_SLICE_TIMEOUT_MS = 90000;
const CORPUS_MAX_SLICE_DAYS = 7;
const CORPUS_MIN_CHUNK_DAYS = 1;
const CORPUS_SINGLE_DAY_TOP = '350';
const CORPUS_CHUNK_FETCH_GAP_MS = 800;

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
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): void {
  if (fullInflight.has(cacheKey)) return;

  const rangeClamp = clampCorpusDateRange(startDate, endDate);
  void fetchCorpusFull(
    cacheKey,
    rangeClamp.startDate,
    rangeClamp.endDate,
    callType,
    dateColumn,
    security
  ).catch(() => {
    /* background refresh failed — stale cache may still be served */
  });
}

type SecurityContext = { isHod: boolean; assignedOffices: string[]; forbidden?: boolean };

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
    startDate: formatLocalDate(clampedStart),
    endDate,
    clamped: true,
    warning: `Corpus limited to the most recent ${MAX_CLIENT_CORPUS_DAYS} days. Use Serial Audit for full history in wide ranges.`,
  };
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
  return rawRows.map((row) => enrichCallRowForReport(row));
}

function corpusRowKey(row: Record<string, unknown>): string {
  const trn = row.vtrnno ?? row.UniqueCallNo;
  if (trn != null && String(trn).trim() !== '') return String(trn).trim();
  const id = row.ncode ?? row.id;
  return id != null ? String(id) : '';
}

function rangeSpanDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
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
      start: formatLocalDate(cursor),
      end: formatLocalDate(effectiveEnd),
    });
    cursor = new Date(effectiveEnd.getTime() + dayMs);
  }
  return chunks;
}

async function fetchCorpusSlice(
  startDate: string | null,
  endDate: string | null,
  callType: string,
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext,
  timeoutMs: number,
  opts?: { top?: string }
): Promise<Record<string, unknown>[]> {
  const res = await postQuery({
    top: opts?.top,
    fields: buildCorpusFieldsSql(),
    tableName: buildCorpusTableName({ startDate, endDate, dateColumn }),
    condition: buildCorpusCondition(callType, security),
    orderBy: dateColumn === 'dsolvedatetime' ? 'tc.dsolvedatetime DESC' : 'tc.dtrndate DESC',
    timeoutMs,
  });
  return mapCorpusRows((res.data || []) as Record<string, unknown>[]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeRowsIntoMap(
  merged: Map<string, Record<string, unknown>>,
  rows: Record<string, unknown>[]
): void {
  for (const row of rows) {
    const key = corpusRowKey(row);
    if (key) merged.set(key, row);
  }
}

type AdaptiveFetchResult = {
  rows: Record<string, unknown>[];
  topLimited: boolean;
};

async function mergeAdaptiveChunks(
  chunks: Array<{ start: string; end: string }>,
  callType: string,
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): Promise<AdaptiveFetchResult> {
  const merged = new Map<string, Record<string, unknown>>();
  let failed = 0;
  let topLimited = false;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const result = await fetchCorpusRangeAdaptive(
        chunk.start,
        chunk.end,
        callType,
        dateColumn,
        security
      );
      mergeRowsIntoMap(merged, result.rows);
      if (result.topLimited) topLimited = true;
      if (i < chunks.length - 1) {
        await sleep(CORPUS_CHUNK_FETCH_GAP_MS);
      }
    } catch  {
      failed++;
      /* sub-range failed — continue with partial data */
    }
  }

  if (merged.size === 0 && failed > 0) {
    throw new Error(`Corpus load failed (${failed}/${chunks.length} sub-ranges could not be loaded)`);
  }
  return { rows: Array.from(merged.values()), topLimited };
}

/** Fetch in ≤7-day slices; subdivide further on CRM viewstate OOM. */
async function fetchCorpusRangeAdaptive(
  startDate: string,
  endDate: string,
  callType: string,
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): Promise<AdaptiveFetchResult> {
  const span = rangeSpanDays(startDate, endDate);

  if (span > CORPUS_MAX_SLICE_DAYS) {
    const chunks = splitDateRange(startDate, endDate, CORPUS_MAX_SLICE_DAYS);
    return mergeAdaptiveChunks(chunks, callType, dateColumn, security);
  }

  try {
    const rows = await fetchCorpusSlice(
      startDate,
      endDate,
      callType,
      dateColumn,
      security,
      CORPUS_SLICE_TIMEOUT_MS
    );
    return { rows, topLimited: false };
  } catch (err) {
    if (span <= CORPUS_MIN_CHUNK_DAYS && isCrmOutOfMemoryError(err)) {
      /* day OOM — fetch capped row count */
      const rows = await fetchCorpusSlice(
        startDate,
        endDate,
        callType,
        dateColumn,
        security,
        CORPUS_SLICE_TIMEOUT_MS,
        { top: CORPUS_SINGLE_DAY_TOP }
      );
      return { rows, topLimited: true };
    }

    if (span <= CORPUS_MIN_CHUNK_DAYS) throw err;

    const subChunkDays = Math.max(CORPUS_MIN_CHUNK_DAYS, Math.floor(span / 2));
    const subChunks = splitDateRange(startDate, endDate, subChunkDays);
    if (subChunks.length <= 1) throw err;

    return mergeAdaptiveChunks(subChunks, callType, dateColumn, security);
  }
}

async function fetchCorpusFullMerged(
  startDate: string | null,
  endDate: string | null,
  callType: string,
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): Promise<{ calls: Record<string, unknown>[]; truncated: boolean; partial: boolean; topLimited?: boolean }> {
  if (!startDate || !endDate) {
    const calls = await fetchCorpusSlice(startDate, endDate, callType, dateColumn, security, CORPUS_TIMEOUT_MS);
    const capped = calls.length > CORPUS_MAX_ROWS ? calls.slice(0, CORPUS_MAX_ROWS) : calls;
    return { calls: capped, truncated: calls.length >= CORPUS_MAX_ROWS, partial: false };
  }

  const months = splitCalendarMonths(startDate, endDate);
  const merged = new Map<string, Record<string, unknown>>();
  let failedMonths = 0;
  let topLimited = false;

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    try {
      const result = await fetchCorpusRangeAdaptive(
        month.start,
        month.end,
        callType,
        dateColumn,
        security
      );
      mergeRowsIntoMap(merged, result.rows);
      if (result.topLimited) topLimited = true;
      if (merged.size >= CORPUS_MAX_ROWS) break;
    } catch  {
      failedMonths++;
      /* month slice failed — continue with partial data */
    }
    if (i < months.length - 1) {
      await sleep(CORPUS_CHUNK_FETCH_GAP_MS);
    }
  }

  if (merged.size === 0 && failedMonths > 0) {
    throw new Error(
      `Corpus load failed (${failedMonths}/${months.length} calendar months could not be loaded)`
    );
  }

  let calls = Array.from(merged.values()).sort((a, b) =>
    String(b.callsdtrndate ?? '').localeCompare(String(a.callsdtrndate ?? ''))
  );
  const truncated = calls.length >= CORPUS_MAX_ROWS;
  if (truncated) {
    calls = calls.slice(0, CORPUS_MAX_ROWS);
  }

  return {
    calls,
    truncated,
    partial: failedMonths > 0 || topLimited,
    topLimited,
  };
}

async function fetchCorpusFull(
  cacheKey: string,
  startDate: string | null,
  endDate: string | null,
  callType: string,
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): Promise<{ calls: Record<string, unknown>[]; truncated: boolean; partial?: boolean; topLimited?: boolean }> {
  const inflight = fullInflight.get(cacheKey);
  if (inflight) {
    const calls = await inflight;
    return { calls, truncated: calls.length >= CORPUS_MAX_ROWS };
  }

  const run = (async () => {
    const { calls, truncated, partial, topLimited } = await fetchCorpusFullMerged(
      startDate,
      endDate,
      callType,
      dateColumn,
      security
    );
    return { calls, truncated, partial, topLimited };
  })();

  fullInflight.set(cacheKey, run.then((r) => r.calls));
  try {
    const result = await run;
    fullCache.set(cacheKey, { data: result.calls, timestamp: Date.now() });
    void writeCorpusDiskCache(cacheKey, result.calls).catch(() => {
      /* disk cache optional */
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
  dateColumn: RegisterDateFilterColumn,
  security: SecurityContext
): Promise<Record<string, unknown>[]> {
  const res = await postQuery({
    fields: buildCorpusFieldsSql(),
    tableName: buildCorpusTableName({ startDate, endDate, lastSync, dateColumn }),
    condition: buildCorpusCondition(callType, security),
    orderBy: dateColumn === 'dsolvedatetime' ? 'tc.dsolvedatetime DESC' : 'tc.dtrndate DESC',
    timeoutMs: 120000,
  });
  return mapCorpusRows((res.data || []) as Record<string, unknown>[]);
}

export async function GET(req: NextRequest) {
  if (readCallsFromPostgres()) {
    return NextResponse.json(
      {
        error: 'This endpoint is not available for your report configuration.',
        readSource: 'postgres',
      },
      { status: 410 }
    );
  }

  let staleCacheKey: string | null = null;

  try {
    const supabase = await createClient();
    const userId = await resolveRequestUserId(req, supabase);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(userId, {
      pageId: 'mis_reports',
      tabId: 'register',
    });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const callType = searchParams.get('callType') || 'All';
    const dateFilterColumn = resolveRegisterDateSqlColumn(searchParams.get('dateFilterColumn'));
    const lastSync = searchParams.get('lastSync');
    const bypassCache = searchParams.get('refresh') === 'true';

    if (lastSync) {
      const deltaCalls = await fetchCorpusDelta(
        startDate,
        endDate,
        callType,
        lastSync,
        dateFilterColumn,
        security
      );
      return NextResponse.json({
        deltaCalls,
        isDelta: true,
        scope: 'window',
      });
    }

    const cacheKey = `corpus_${startDate || 'default'}_${endDate || 'default'}_${dateFilterColumn}_${callType}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
    staleCacheKey = cacheKey;

    const cached = await resolveCachedCorpus(cacheKey, bypassCache);
    if (cached) {
      if (cached.stale) {
        scheduleCorpusRefresh(cacheKey, startDate, endDate, callType, dateFilterColumn, security);
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

    const { calls, truncated, partial, topLimited } = await fetchCorpusFull(
      cacheKey,
      effectiveStart,
      effectiveEnd,
      callType,
      dateFilterColumn,
      security
    );

    const warnings: string[] = [];
    if (rangeClamp.clamped && rangeClamp.warning) {
      warnings.push(rangeClamp.warning);
    }
    if (truncated) {
      warnings.push(`Showing first ${CORPUS_MAX_ROWS} calls. Narrow the date range for full data.`);
    }
    if (topLimited) {
      warnings.push(
        'Some busy days hit memory limits and were capped — counts for those days may be incomplete.'
      );
    }
    if (partial && !topLimited) {
      warnings.push('Some date ranges could not be loaded; showing partial data.');
    }

    return NextResponse.json({
      calls,
      cached: false,
      cacheStored: true,
      rowCount: calls.length,
      scope: 'window',
      truncated,
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    });
  } catch (err: unknown) {
    console.error('Corpus API Error:', err);

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

    return NextResponse.json({ error: safeErrorMessage(err, 'Corpus query failed') }, { status: 500 });
  }
}
