'use client';

import React, { createContext, useContext, useState, useLayoutEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import axios from 'axios';
import { Sidebar } from './Sidebar';

function MainContentPlaceholder() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-slate-50 animate-pulse">
      <div className="h-14 flex-shrink-0 border-b border-slate-200 bg-white" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-10 w-64 rounded-xl bg-slate-200/80" />
        <div className="flex-1 rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

interface UserContextType {
  userProfile: any;
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

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(pathname !== '/login');
  const authLoadedRef = useRef(false);

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await axios.get('/api/auth/me', { withCredentials: true });
        setUserProfile(res.data);
        authLoadedRef.current = true;
        setLoadingProfile(false);
        return;
      } catch (err: unknown) {
        const unauthorized =
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403);
        if (unauthorized) {
          setUserProfile(null);
          authLoadedRef.current = false;
          if (pathname !== '/login') {
            router.replace('/login');
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
  }, [pathname, router]);

  useLayoutEffect(() => {
    if (pathname === '/login') {
      setUserProfile(null);
      authLoadedRef.current = false;
      setLoadingProfile(false);
      return;
    }
    if (authLoadedRef.current && userProfile) {
      setLoadingProfile(false);
      return;
    }
    void fetchProfile();
  }, [pathname, fetchProfile, userProfile]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const authReady = !loadingProfile && !!userProfile;

  return (
    <UserContext.Provider value={{ userProfile, loadingProfile, refreshProfile: fetchProfile }}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden w-screen bg-slate-50 text-slate-700 font-sans">
        <Sidebar user={userProfile} />
        {authReady ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
            {children}
          </div>
        ) : (
          <MainContentPlaceholder />
        )}
      </div>
    </UserContext.Provider>
  );
}
