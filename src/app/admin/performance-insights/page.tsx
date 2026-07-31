import { requirePageAccess } from '@/lib/auth/require-page-access';
import { PerformanceInsightsPageClient } from '@/modules/performance/pages/PerformanceInsightsPageClient';

export default async function PerformanceInsightsPage() {
  await requirePageAccess('/admin/performance-insights');
  return <PerformanceInsightsPageClient />;
}
