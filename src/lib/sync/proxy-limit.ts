/** Max rows returned by location-audit and similar bounded report queries. */
export const REPORT_MAX_ROWS = 2000;

/** Sync-proxy CRM page size (cursor pagination). */
export const SYNC_PROXY_DEFAULT_LIMIT = 500;

export const SYNC_PROXY_MAX_LIMIT = Number(process.env.SYNC_PROXY_MAX_LIMIT ?? 2000) || 2000;

export function clampSyncProxyLimit(requested: number): number {
  if (!Number.isFinite(requested) || requested < 1) return SYNC_PROXY_DEFAULT_LIMIT;
  return Math.min(Math.floor(requested), SYNC_PROXY_MAX_LIMIT);
}
