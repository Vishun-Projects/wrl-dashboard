'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/components/layout/DashboardLayout';
import { canAccessPath, defaultReportLandingPath } from '@/lib/auth/page-access';
import { canAccessInsights, isPerformanceInsightsPath } from '@/lib/auth/insights-access';
import { feedback } from '@/lib/ui/feedback';

type PageAccessGuardProps = {
  children: React.ReactNode;
};

/** Redirects when the signed-in user lacks permission for the current route. */
export function PageAccessGuard({ children }: PageAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile, loadingProfile } = useUser();

  useEffect(() => {
    if (loadingProfile || !userProfile || !pathname) return;
    const permissions: string[] = userProfile.permissions ?? [];

    if (isPerformanceInsightsPath(pathname)) {
      if (canAccessInsights(userProfile.email)) return;
      feedback.accessDenied();
      router.replace(defaultReportLandingPath(permissions));
      return;
    }

    if (canAccessPath(permissions, pathname, { email: userProfile.email })) return;

    feedback.accessDenied();
    const fallback =
      pathname.startsWith('/report') || pathname.startsWith('/admin')
        ? defaultReportLandingPath(permissions)
        : '/report';
    router.replace(fallback);
  }, [loadingProfile, userProfile, pathname, router]);

  return <>{children}</>;
}
