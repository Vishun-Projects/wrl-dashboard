export type MailAlertsTab = 'org' | 'routing' | 'repair';

export const MAIL_ALERTS_TABS: ReadonlyArray<{ id: MailAlertsTab; label: string }> = [
  { id: 'org', label: 'Org settings' },
  { id: 'routing', label: 'MIS Email Routing' },
  { id: 'repair', label: 'Major Repair Alerts' },
];

export function mailAlertsTabFromPath(pathname: string): MailAlertsTab {
  if (pathname.includes('mis-email-routing')) return 'routing';
  if (pathname.includes('major-repair-alerts')) return 'repair';
  return 'org';
}
