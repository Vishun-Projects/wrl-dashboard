'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import axios from 'axios';
import { signOutAndGoToLogin } from '@/lib/auth/sign-out-client';
import {
  isSessionExpiredResponse,
  showSessionExpired,
} from '@/lib/auth/session-expired-client';
import { isPublicAuthRoute } from '@/lib/auth/rbac-catalog';
import { Sidebar } from './Sidebar';
import { PageAccessGuard } from './PageAccessGuard';
import { CallDetailDialogProvider } from '@/components/calls/CallDetailDialogProvider';
import { PerformanceMetricsLogger } from '@/components/performance/PerformanceMetricsLogger';
import { performanceLogEnabledClient } from '@/lib/performance/log-config';
import { MotionProvider } from '@/components/motion';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { MisEmailSendTracker } from '@/features/mis-email/ui/MisEmailSendTracker';
import { SessionExpiredDialog } from '@/components/auth/SessionExpiredDialog';

type DashboardUser = {
  id?: string;
  name: string;
  email: string;
  role?: string;
  avatar_url?: string | null;
  permissions: string[];
  office_ids?: string[];
  theme?: string;
  sessionExpiresAt?: string | null;
};

interface UserContextType {
  userProfile: DashboardUser | null;
  loadingProfile: boolean;
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextType | null>(null);

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export function DashboardLayout({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: DashboardUser | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [userProfile, setUserProfile] = useState<DashboardUser | null>(initialUser);
  const [loadingProfile, setLoadingProfile] = useState(
    !isPublicAuthRoute(pathname) && !initialUser
  );
  const authLoadedRef = useRef(!!initialUser);
  const profileRequestRef = useRef<Promise<void> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSessionExpiry = useCallback((expiresAtIso: string | null | undefined) => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (!expiresAtIso) return;
    const expiresMs = Date.parse(expiresAtIso);
    if (!Number.isFinite(expiresMs)) return;
    const delay = Math.max(0, expiresMs - Date.now());
    expiryTimerRef.current = setTimeout(() => {
      showSessionExpired();
    }, delay);
  }, []);

  const fetchProfile = useCallback(async () => {
    if (profileRequestRef.current) {
      return profileRequestRef.current;
    }

    const run = async () => {
    if (!authLoadedRef.current) {
      setLoadingProfile(true);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await axios.get<DashboardUser>('/api/auth/me', { withCredentials: true });
        setUserProfile(res.data);
        authLoadedRef.current = true;
        setLoadingProfile(false);
        scheduleSessionExpiry(res.data.sessionExpiresAt);
        return;
      } catch (err: unknown) {
        const unauthorized =
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403);
        if (unauthorized) {
          setUserProfile(null);
          authLoadedRef.current = false;
          if (!isPublicAuthRoute(pathname)) {
            if (
              axios.isAxiosError(err) &&
              isSessionExpiredResponse(err.response?.status ?? 0, err.response?.data)
            ) {
              showSessionExpired();
            } else {
              void signOutAndGoToLogin();
            }
          }
          setLoadingProfile(false);
          return;
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        // Network / 5xx: keep last profile — do not treat as logout
      }
    }
    setLoadingProfile(false);
    };

    const req = run().finally(() => {
      if (profileRequestRef.current === req) {
        profileRequestRef.current = null;
      }
    });
    profileRequestRef.current = req;
    return req;
  }, [pathname, router, scheduleSessionExpiry]);

  useEffect(() => {
    if (isPublicAuthRoute(pathname)) {
      setUserProfile(null);
      authLoadedRef.current = false;
      setLoadingProfile(false);
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
      return;
    }
    if (authLoadedRef.current && userProfile) {
      setLoadingProfile(false);
      return;
    }
    void fetchProfile();
  }, [pathname, fetchProfile, userProfile]);

  useEffect(() => {
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, []);

  if (isPublicAuthRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <UserContext.Provider value={{ userProfile, loadingProfile, refreshProfile: fetchProfile }}>
      <ThemeProvider serverTheme={initialUser?.theme}>
      <MotionProvider>
      <CallDetailDialogProvider>
        <SessionExpiredDialog />
        <MisEmailSendTracker />
        {performanceLogEnabledClient() ? <PerformanceMetricsLogger /> : null}
        <div className="flex flex-col md:flex-row h-screen overflow-hidden w-screen bg-bg-soft text-slate-700 font-sans">
          <Sidebar user={userProfile ? { ...userProfile, avatar_url: userProfile.avatar_url ?? undefined } : null} />
          <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
            <PageAccessGuard>{children}</PageAccessGuard>
          </div>
        </div>
      </CallDetailDialogProvider>
      </MotionProvider>
      </ThemeProvider>
    </UserContext.Provider>
  );
}
