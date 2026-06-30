'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/components/layout/DashboardLayout';
import { canAccessPath, defaultLandingPath } from '@/lib/auth/rbac-catalog';
import { feedback } from '@/lib/ui/feedback';

type PageAccessGuardProps = {
  children: React.ReactNode;
};

function AccessGuardPlaceholder() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-bg-soft animate-pulse">
      <div className="h-14 flex-shrink-0 border-b border-slate-200 bg-bg-canvas" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-10 w-64 rounded-xl bg-slate-200/80" />
        <div className="flex-1 rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

/** Redirects when the signed-in user lacks permission for the current route. */
export function PageAccessGuard({ children }: PageAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile, loadingProfile } = useUser();

  const accessAllowed = useMemo(() => {
    if (loadingProfile || !userProfile || !pathname) return null;
    return canAccessPath(userProfile.permissions ?? [], pathname, { email: userProfile.email });
  }, [loadingProfile, userProfile, pathname]);

  useEffect(() => {
    if (accessAllowed !== false || !pathname) return;

    feedback.accessDenied();
    const permissions: string[] = userProfile?.permissions ?? [];
    const fallback =
      pathname.startsWith('/report') || pathname.startsWith('/admin')
        ? defaultLandingPath(permissions)
        : '/report';
    router.replace(fallback);
  }, [accessAllowed, pathname, router, userProfile]);

  if (loadingProfile || !userProfile || accessAllowed === null) {
    return <AccessGuardPlaceholder />;
  }

  if (accessAllowed === false) {
    return <AccessGuardPlaceholder />;
  }

  return <>{children}</>;
}
