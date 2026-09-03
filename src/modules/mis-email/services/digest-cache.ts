import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import { fetchDigestSummaryData } from '@/modules/mis-email/services/fetch-digest-data';
import { fetchDigestClientAccountSummary } from '@/modules/mis-email/services/fetch-digest-accounts';
import { isDirectDatabaseForBulkReads } from '@/lib/read-model/db';
import type { UserDigestScope } from '@/modules/mis-email/services/user-scope';
import type { AccountSummaryRow, SummaryDashboard } from '@/lib/summary/derive';
import type { BdMisTraceableExportPayload } from '@/modules/mis';
import {
  buildDigestTraceableExportPayload,
  type BuildDigestTraceOptions,
} from '@/modules/mis-email/services/fetch-digest-trace';

const LOG_PREFIX = '[mis-email/timing]';

const SUMMARY_TTL_MS = 10 * 60 * 1000;
const summaryCache = new Map<string, { expiresAt: number; data: SummaryDashboard }>();
const clientAccountCache = new Map<string, { expiresAt: number; data: AccountSummaryRow[] }>();
const traceCache = new Map<string, { expiresAt: number; data: BdMisTraceableExportPayload }>();
const traceInflight = new Map<string, Promise<BdMisTraceableExportPayload>>();

function summaryCacheKey(scope: UserDigestScope, dateRange: DigestDateRange): string {
  return JSON.stringify({
    offices: scope.assignedOffices,
    isHod: scope.isHod,
    start: dateRange.startDate,
    end: dateRange.endDate,
  });
}

function clientAccountCacheKey(dateRange: DigestDateRange): string {
  return JSON.stringify({
    start: dateRange.startDate,
    end: dateRange.endDate,
  });
}

function traceCacheKey(
  scope: UserDigestScope,
  dateRange: DigestDateRange,
  options: BuildDigestTraceOptions | undefined
): string {
  return JSON.stringify({
    offices: scope.assignedOffices,
    isHod: scope.isHod,
    start: dateRange.startDate,
    end: dateRange.endDate,
    fullCorpus: options?.requireFullCorpus === true,
    openExport: options?.includeOpenCallsExport === true,
    traceExport: options?.includeTraceableExport === true,
    skipRepair: options?.skipRepairDone === true,
  });
}

export async function fetchDigestSummaryDataCached(
  scope: UserDigestScope,
  dateRange: DigestDateRange
): Promise<SummaryDashboard> {
  const key = summaryCacheKey(scope, dateRange);
  const hit = summaryCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    console.log(
      `${LOG_PREFIX} summary cache HIT ${dateRange.startDate}→${dateRange.endDate} · branches=${hit.data.branchSummary.length} accounts=${hit.data.accountSummary.length}`
    );
    return hit.data;
  }

  const started = Date.now();
  const data = await fetchDigestSummaryData(scope, dateRange);
  console.log(
    `${LOG_PREFIX} summary cache MISS ${dateRange.startDate}→${dateRange.endDate} · query ${Date.now() - started}ms · branches=${data.branchSummary.length} accounts=${data.accountSummary.length}`
  );
  summaryCache.set(key, { expiresAt: Date.now() + SUMMARY_TTL_MS, data });
  return data;
}

export async function fetchDigestClientAccountSummaryCached(
  dateRange: DigestDateRange
): Promise<AccountSummaryRow[]> {
  const key = clientAccountCacheKey(dateRange);
  const hit = clientAccountCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    console.log(
      `${LOG_PREFIX} client accounts cache HIT ${dateRange.startDate}→${dateRange.endDate} · accounts=${hit.data.length}`
    );
    return hit.data;
  }

  const started = Date.now();
  const via = isDirectDatabaseForBulkReads() ? 'direct' : 'pooler';
  console.log(
    `${LOG_PREFIX} queryClientAccountSummary ${dateRange.startDate}→${dateRange.endDate} · ${via}`
  );
  const data = await fetchDigestClientAccountSummary(dateRange);
  console.log(
    `${LOG_PREFIX} client accounts cache MISS ${dateRange.startDate}→${dateRange.endDate} · query ${Date.now() - started}ms · accounts=${data.length}`
  );
  clientAccountCache.set(key, { expiresAt: Date.now() + SUMMARY_TTL_MS, data });
  return data;
}

/** Shared YTD call corpus for body + Excel — TTL cache + in-flight dedupe (parallel previews). */
export async function buildDigestTraceableExportPayloadCached(
  scope: UserDigestScope,
  dateRange: DigestDateRange,
  summaryData: SummaryDashboard,
  clientAccountSummary: AccountSummaryRow[],
  options?: BuildDigestTraceOptions
): Promise<BdMisTraceableExportPayload> {
  const key = traceCacheKey(scope, dateRange, options);
  const hit = traceCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    console.log(
      `${LOG_PREFIX} trace cache HIT ${dateRange.startDate}→${dateRange.endDate} · traceRows=${hit.data.traceRows.length}`
    );
    return hit.data;
  }

  const existing = traceInflight.get(key);
  if (existing) {
    console.log(
      `${LOG_PREFIX} trace cache WAIT ${dateRange.startDate}→${dateRange.endDate} (in-flight)`
    );
    return existing;
  }

  const pending = buildDigestTraceableExportPayload(
    scope,
    dateRange,
    summaryData,
    clientAccountSummary,
    options
  )
    .then((data) => {
      traceCache.set(key, { expiresAt: Date.now() + SUMMARY_TTL_MS, data });
      return data;
    })
    .finally(() => {
      traceInflight.delete(key);
    });

  traceInflight.set(key, pending);
  return pending;
}

export function clearDigestSummaryCache(): void {
  summaryCache.clear();
  clientAccountCache.clear();
  traceCache.clear();
  traceInflight.clear();
}
