/**
 * CRM DBQUERY.aspx HTTP health counters (no nodemailer).
 * Ops mail lives in `@/lib/db/crm-http-alert` so client bundles that import proxy
 * never pull tls/child_process.
 */

export type CrmHttpHealthConfig = {
  windowMs: number;
  threshold: number;
  /** Min gap between any two alert mails (first or storm). */
  alertCooldownMs: number;
};

export const CRM_HTTP_HEALTH_DEFAULTS: CrmHttpHealthConfig = {
  windowMs: Number(process.env.CRM_HTTP_STORM_WINDOW_MS ?? 10 * 60_000) || 10 * 60_000,
  threshold: Number(process.env.CRM_HTTP_STORM_THRESHOLD ?? 5) || 5,
  alertCooldownMs: Number(process.env.CRM_HTTP_STORM_ALERT_COOLDOWN_MS ?? 5 * 60_000) || 5 * 60_000,
};

const OVERLOAD_STATUSES = new Set([405, 502, 503]);

let hits: number[] = [];
let lastAlertAt = 0;
let alertedFirstInWindow = false;

export function isCrmHttpOverloadStatus(status: number | undefined | null): boolean {
  return status != null && OVERLOAD_STATUSES.has(status);
}

export function resetCrmHttpHealthForTests(): void {
  hits = [];
  lastAlertAt = 0;
  alertedFirstInWindow = false;
}

function prune(now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  hits = hits.filter((t) => t >= cutoff);
}

export type CrmHttpNoteResult = {
  first: boolean;
  storm: boolean;
  count: number;
};

/** Record a CRM HTTP status. first=true on first overload after a quiet window; storm at threshold. */
export function noteCrmHttpStatus(
  status: number | undefined | null,
  now = Date.now(),
  cfg: CrmHttpHealthConfig = CRM_HTTP_HEALTH_DEFAULTS
): CrmHttpNoteResult {
  prune(now, cfg.windowMs);
  if (hits.length === 0) alertedFirstInWindow = false;

  if (!isCrmHttpOverloadStatus(status)) {
    return { first: false, storm: false, count: hits.length };
  }
  hits.push(now);
  const count = hits.length;

  let first = false;
  if (!alertedFirstInWindow) {
    alertedFirstInWindow = true;
    first = true;
  }

  let storm = false;
  if (count >= cfg.threshold && now - lastAlertAt >= cfg.alertCooldownMs) {
    storm = true;
  }

  return { first, storm, count };
}

/** Call after an alert mail is dispatched so storm cooldown applies. */
export function markCrmHttpAlertSent(now = Date.now()): void {
  lastAlertAt = now;
}
