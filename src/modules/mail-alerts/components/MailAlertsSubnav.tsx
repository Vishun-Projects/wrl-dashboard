export type MailAlertsTab = 'org' | 'routing' | 'repair' | 'cron';

export const MAIL_ALERTS_TABS: ReadonlyArray<{ id: MailAlertsTab; label: string }> = [
  { id: 'org', label: 'Org settings' },
  { id: 'routing', label: 'MIS Email Routing' },
  { id: 'repair', label: 'Major Repair Alerts' },
  { id: 'cron', label: 'VPS Cron & schedules' },
];

export function mailAlertsTabFromPath(pathname: string): MailAlertsTab {
  if (pathname.includes('mis-email-routing')) return 'routing';
  if (pathname.includes('major-repair-alerts')) return 'repair';
  if (pathname.includes('vps-cron')) return 'cron';
  return 'org';
}
