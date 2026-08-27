export type MailAlertsTab = 'org' | 'routing' | 'repair' | 'cancelled' | 'cron' | 'subcontractor';

export const MAIL_ALERTS_TABS: ReadonlyArray<{ id: MailAlertsTab; label: string }> = [
  { id: 'org', label: 'Org settings' },
  { id: 'routing', label: 'MIS Email Routing' },
  { id: 'repair', label: 'Major Repair Alerts' },
  { id: 'cancelled', label: 'Cancelled Calls' },
  { id: 'cron', label: 'VPS Cron & schedules' },
  { id: 'subcontractor', label: 'Subcontractor Stock' },
];

export function mailAlertsTabFromPath(pathname: string): MailAlertsTab {
  if (pathname.includes('mis-email-routing')) return 'routing';
  if (pathname.includes('major-repair-alerts')) return 'repair';
  if (pathname.includes('cancelled-call-alerts')) return 'cancelled';
  if (pathname.includes('vps-cron')) return 'cron';
  if (pathname.includes('subcontractor-stock')) return 'subcontractor';
  return 'org';
}

