/**
 * CRM HTTP overload ops mail. Import only from Node/sync paths — not from client components.
 */
import {
  CRM_HTTP_HEALTH_DEFAULTS,
  markCrmHttpAlertSent,
  noteCrmHttpStatus,
} from '@/lib/db/crm-http-health';

const DEFAULT_ALERT_TO = 'vishunvishwakarma90211@gmail.com';

let alertInflight: Promise<void> | null = null;

function resolveAlertTo(): string {
  const raw =
    process.env.CRM_HTTP_STORM_ALERT_TO?.trim() ||
    process.env.SYNC_WORKER_ALERT_TO?.trim() ||
    process.env.VPS_OPS_ALERT_TO?.trim() ||
    DEFAULT_ALERT_TO;
  const parts = raw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.includes(DEFAULT_ALERT_TO)) parts.push(DEFAULT_ALERT_TO);
  return [...new Set(parts)].join(', ');
}

function portalSyncUrl(): string {
  const base =
    process.env.MIS_EMAIL_PORTAL_URL?.trim() ||
    process.env.PORTAL_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    'https://wrl-dashboard.vercel.app';
  return `${base.replace(/\/$/, '')}/admin/sync`;
}

/** Fire-and-forget ops mail on first 405 and on storms. Never throws. */
export function maybeAlertCrmHttpStorm(status: number | undefined | null): void {
  if (typeof window !== 'undefined') return;

  const { first, storm, count } = noteCrmHttpStatus(status);
  if (!first && !storm) return;
  if (process.env.CRM_HTTP_STORM_ALERT === 'false') return;
  if (alertInflight) return;

  const kind = first && !storm ? 'first' : storm ? 'storm' : 'first';
  const code = status ?? 0;
  markCrmHttpAlertSent();

  console.error(
    `[crm-proxy] HTTP ${code} ${kind.toUpperCase()} alert — count=${count} in window (threshold ${CRM_HTTP_HEALTH_DEFAULTS.threshold})`
  );

  alertInflight = sendOverloadAlert(kind, count, code)
    .catch((err) => {
      console.error(
        '[crm-proxy] 405 alert mail failed:',
        err instanceof Error ? err.message : err
      );
    })
    .finally(() => {
      alertInflight = null;
    });
}

async function sendOverloadAlert(
  kind: 'first' | 'storm',
  count: number,
  status: number
): Promise<void> {
  const to = resolveAlertTo();
  const { createMailTransport, resolveSmtpConfig } = await import('@/lib/mail/smtp');
  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const windowMin = Math.round(CRM_HTTP_HEALTH_DEFAULTS.windowMs / 60_000);
  const syncUrl = portalSyncUrl();
  const subject =
    kind === 'first'
      ? `[WRL] CRM DBQUERY HTTP ${status} during sync — open /admin/sync`
      : `[WRL] CRM DBQUERY HTTP ${status} storm — ${count} in ${windowMin}m`;
  const body = [
    kind === 'first'
      ? `Western CRM DBQUERY.aspx returned HTTP ${status} during sync (first hit after a quiet period).`
      : `Western CRM DBQUERY.aspx returned HTTP ${status} repeatedly (${count} in ~${windowMin}m).`,
    ``,
    `This can leave calls_latest_hot stale (cancels/solves lag). Morning MIS stays blocked until midnight verify passes.`,
    ``,
    `Action now:`,
    `1. Open Sync UI: ${syncUrl}`,
    `2. Trigger a manual resync / editedon catch-up when CRM is healthy.`,
    `3. Or wait for midnight sync (retries until 07:00 IST).`,
    ``,
    `To: ${to}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
  await transport.sendMail({ from: smtp.from, to, subject, text: body });
  console.error(`[crm-proxy] HTTP ${status} ${kind} alert mailed to ${to}`);
}
