import { requirePageAccess } from '@/lib/auth/require-page-access';
import MailAlertsHubPageClient from '@/modules/mail-alerts/pages/MailAlertsHubPageClient';
import type { MailAlertsTab } from '@/modules/mail-alerts/components/MailAlertsSubnav';

function parseTab(raw: string | string[] | undefined): MailAlertsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'routing' || value === 'repair' || value === 'cron') return value;
  return 'org';
}

export default async function MisEmailOrgSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const user = await requirePageAccess('/admin/mis-email-settings');
  const params = searchParams ? await searchParams : {};
  return (
    <MailAlertsHubPageClient
      initialTab={parseTab(params.tab)}
      permissions={user.permissions ?? []}
    />
  );
}
