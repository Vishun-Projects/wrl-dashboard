'use client';

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef } from 'react';
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
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [showMainContent, setShowMainContent] = useState(false);
  const hasDeferredInitialContent = useRef(false);

  const fetchProfile = async () => {
    try {
      const res = await axios.get('/api/auth/me');
      setUserProfile(res.data);
    } catch (err) {
      if (pathname !== '/login') {
        router.push('/login');
      }
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  // On first dashboard paint, show sidebar before mounting heavy route content.
  useLayoutEffect(() => {
    if (pathname === '/login') return;
    if (hasDeferredInitialContent.current) {
      setShowMainContent(true);
      return;
    }
    hasDeferredInitialContent.current = true;
    const frame = requestAnimationFrame(() => setShowMainContent(true));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <UserContext.Provider value={{ userProfile, loadingProfile, refreshProfile: fetchProfile }}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden w-screen bg-slate-50 text-slate-700 font-sans">
        <Sidebar user={userProfile} />
        {showMainContent ? (
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
