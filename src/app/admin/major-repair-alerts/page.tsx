import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/auth/require-page-access';

export default async function MajorRepairAlertsPage() {
  await requirePageAccess('/admin/major-repair-alerts');
  redirect('/admin/mis-email-settings?tab=repair');
}
