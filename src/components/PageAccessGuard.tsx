'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/components/DashboardLayout';
import { canAccessPath, defaultReportLandingPath } from '@/lib/auth/page-access';
import { toast } from 'sonner';

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

    if (canAccessPath(permissions, pathname)) return;

    toast.error('You do not have access to this page.');
    const fallback =
      pathname.startsWith('/report') || pathname.startsWith('/admin')
        ? defaultReportLandingPath(permissions)
        : '/report';
    router.replace(fallback);
  }, [loadingProfile, userProfile, pathname, router]);

  return <>{children}</>;
}
