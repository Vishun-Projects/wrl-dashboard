'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import axios from 'axios';
import { Sidebar } from './Sidebar';

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

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <UserContext.Provider value={{ userProfile, loadingProfile, refreshProfile: fetchProfile }}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden w-screen bg-slate-50 text-slate-700 font-sans">
        <Sidebar user={userProfile} />
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
          {children}
        </div>
      </div>
    </UserContext.Provider>
  );
}
