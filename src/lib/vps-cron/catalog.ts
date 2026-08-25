export const VPS_CRON_JOB_IDS = [
  'mis_email_digest',
  'mis_email_test',
  'mis_email_watchdog',
  'mis_client_purge',
  'vacuum_full_mis_rows',
  'sync_worker_health',
  'nightly_ytd_calls_export',
] as const;

export type VpsCronJobId = (typeof VPS_CRON_JOB_IDS)[number];

export type VpsCronJobDef = {
  id: VpsCronJobId;
  label: string;
  schedule: string;
  script: string;
};

export const VPS_CRON_CATALOG: readonly VpsCronJobDef[] = [
  {
    id: 'mis_email_digest',
    label: 'MIS email digest',
    schedule: 'Every 15 min Mon–Sat IST (send times from portal prefs)',
    script: 'mis-email-digest.sh',
  },
  {
    id: 'mis_email_test',
    label: 'MIS email test digest',
    schedule: 'Test cron hour (often 14:00 IST) → test To only',
    script: 'mis-email-test-digest.sh',
  },
  {
    id: 'mis_email_watchdog',
    label: 'MIS morning watchdog',
    schedule: '~09:50 IST Mon–Sat (alerts if morning digest failed)',
    script: 'mis-email-morning-watchdog.sh',
  },
  {
    id: 'mis_client_purge',
    label: 'MIS client import file purge',
    schedule: '~03:15 IST daily (files older than 7 days)',
    script: 'mis-client-purge-old-files.sh',
  },
  {
    id: 'vacuum_full_mis_rows',
    label: 'Database VACUUM FULL (MIS Rows)',
    schedule: '00:00 IST Sunday (Saturday night)',
    script: 'vacuum-full-mis-rows.sh',
  },
  {
    id: 'sync_worker_health',
    label: 'Sync worker health watchdog',
    schedule: 'Every 15 min IST (crash-loop / stale watermark → mail)',
    script: 'sync-worker-health-watchdog.sh',
  },
  {
    id: 'nightly_ytd_calls_export',
    label: 'Nightly YTD calls export',
    schedule: '00:00 IST daily (Jan 1 → yesterday Excel → ops mail)',
    script: 'nightly-ytd-calls-export.sh',
  },
] as const;

export function isVpsCronJobId(value: unknown): value is VpsCronJobId {
  return typeof value === 'string' && (VPS_CRON_JOB_IDS as readonly string[]).includes(value);
}
