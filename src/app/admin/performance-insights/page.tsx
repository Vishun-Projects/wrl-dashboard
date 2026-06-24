import { notFound } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessPerformanceInsights } from '@/lib/auth/insights-access';
import { PerformanceInsightsPageClient } from '@/components/admin/PerformanceInsightsPageClient';

export default async function PerformanceInsightsPage() {
  const userInfo = await getUserInfo();
  if (!userInfo || !canAccessPerformanceInsights(userInfo.permissions)) {
    notFound();
  }

  return <PerformanceInsightsPageClient />;
}
