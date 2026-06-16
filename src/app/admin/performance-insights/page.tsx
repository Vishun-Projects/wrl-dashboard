import { notFound } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessInsights } from '@/lib/auth/insights-access';
import { PerformanceInsightsPageClient } from '@/components/admin/PerformanceInsightsPageClient';

export default async function PerformanceInsightsPage() {
  const userInfo = await getUserInfo();
  if (!userInfo || !canAccessInsights(userInfo.email)) {
    notFound();
  }

  return <PerformanceInsightsPageClient />;
}
