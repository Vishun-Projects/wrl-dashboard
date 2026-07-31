import type { DigestDateRange } from '@/features/mis-email/services/fetch-digest-data';
import { fetchDigestSummaryData } from '@/features/mis-email/services/fetch-digest-data';
import { fetchDigestClientAccountSummary } from '@/features/mis-email/services/fetch-digest-accounts';
import { isDirectDatabaseForBulkReads } from '@/lib/read-model/db';
import type { UserDigestScope } from '@/features/mis-email/services/user-scope';
import type { AccountSummaryRow, SummaryDashboard } from '@/features/report';

const LOG_PREFIX = '[mis-email/timing]';

const SUMMARY_TTL_MS = 10 * 60 * 1000;
const summaryCache = new Map<string, { expiresAt: number; data: SummaryDashboard }>();
const clientAccountCache = new Map<string, { expiresAt: number; data: AccountSummaryRow[] }>();

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

export function clearDigestSummaryCache(): void {
  summaryCache.clear();
  clientAccountCache.clear();
}
