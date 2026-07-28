import { requirePageAccess } from '@/lib/auth/require-page-access';
import MailAlertsHubPageClient from '@/features/mis-email/ui/MailAlertsHubPageClient';
import type { MailAlertsTab } from '@/features/mis-email/ui/MailAlertsSubnav';

function parseTab(raw: string | string[] | undefined): MailAlertsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'routing' || value === 'repair') return value;
  return 'org';
}

export default async function MisEmailOrgSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  await requirePageAccess('/admin/mis-email-settings');
  const params = searchParams ? await searchParams : {};
  return <MailAlertsHubPageClient initialTab={parseTab(params.tab)} />;
}
