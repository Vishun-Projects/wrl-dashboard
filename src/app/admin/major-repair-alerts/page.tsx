import { requirePageAccess } from '@/lib/auth/require-page-access';
import MajorRepairAlertsPageClient from '@/features/major-repair-alerts/ui/MajorRepairAlertsPageClient';

export default async function MajorRepairAlertsPage() {
  await requirePageAccess('/admin/major-repair-alerts');
  return <MajorRepairAlertsPageClient />;
}
