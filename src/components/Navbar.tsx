'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  LayoutDashboard,
  FileSpreadsheet,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ShieldCheck,
  Database
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface NavbarProps {
  user: {
    id?: string;
    name: string;
    email: string;
    role?: string;
    avatar_url?: string;
    permissions: string[];
  } | null;
}

export function Navbar({ user }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const navigation = [
    {
      name: 'Calls Dashboard',
      href: '/calls',
      icon: LayoutDashboard,
      permission: 'view_calls'
    },
    {
      name: 'MIS Reports',
      href: '/report',
      icon: FileSpreadsheet,
      permission: 'view_reports'
    },
    {
      name: 'User Management',
      href: '/admin/users',
      icon: Users,
      permission: 'manage_users'
    },
    {
      name: 'Roles & Access',
      href: '/admin/roles',
      icon: ShieldCheck,
      permission: 'manage_roles'
    },
  ];

  const filteredNavigation = navigation.filter(item =>
    !item.permission || user?.permissions.includes(item.permission)
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-[100] shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-8">
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => router.push('/calls')}
            >
              <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 active:scale-95 shadow-lg shadow-slate-200">
                <img src="/western-head-logo-2025.png" alt="W" className="w-6 h-6 object-contain" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-black text-slate-900 leading-tight tracking-tight uppercase">WRL</span>
                {/* <span className="text-[10px] font-bold text-slate-400 leading-none uppercase tracking-widest">Portal 2025</span> */}
              </div>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              {filteredNavigation.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <button
                    key={item.name}
                    onClick={() => router.push(item.href)}
                    className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-[13px] font-bold transition-all duration-200 ${isActive
                      ? 'bg-slate-50 text-slate-900 ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50'
                      }`}
                  >
                    <item.icon size={16} className={isActive ? 'text-slate-900' : 'text-slate-400'} />
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4 border-l border-slate-100 pl-6 h-10">
              <div className="flex flex-col items-end">
                <span className="text-[12px] font-bold text-slate-900 leading-none">{user?.name || 'Loading...'}</span>
                <span className="text-[10px] font-medium text-slate-400 mt-1">{user?.email}</span>
              </div>

              <div className="relative">
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-all active:scale-95 overflow-hidden"
                >
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    user?.name ? user.name.charAt(0).toUpperCase() : <Settings size={16} />
                  )}
                </button>

                {isProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsProfileOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 shadow-2xl rounded-2xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                      <div className="p-4 bg-slate-50 border-b border-slate-100">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Signed in as</p>
                        <p className="text-[13px] font-bold text-slate-900 truncate">{user?.email}</p>
                      </div>
                      <div className="p-1.5 space-y-1">
                        <button
                          onClick={() => { router.push('/profile'); setIsProfileOpen(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                        >
                          <Users size={16} className="text-slate-400 group-hover:text-slate-900" />
                          My Profile
                        </button>
                        <button
                          onClick={() => { router.push('/profile?tab=settings'); setIsProfileOpen(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                        >
                          <Settings size={16} className="text-slate-400 group-hover:text-slate-900" />
                          Settings
                        </button>
                        <div className="h-px bg-slate-100 mx-2 my-1" />
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-rose-600 hover:bg-rose-50 transition-all group"
                        >
                          <LogOut size={16} className="text-rose-400 group-hover:text-rose-600" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Mobile Menu Button */}
            <div className="lg:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all"
              >
                {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-100 bg-white animate-in slide-in-from-top-4 duration-200">
          <div className="px-4 pt-2 pb-6 space-y-1">
            {filteredNavigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <button
                  key={item.name}
                  onClick={() => {
                    router.push(item.href);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-bold transition-all ${isActive
                    ? 'bg-slate-900 text-white shadow-lg shadow-slate-200'
                    : 'text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  <item.icon size={18} />
                  {item.name}
                </button>
              );
            })}
            <div className="pt-4 border-t border-slate-100 mt-4">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] font-bold text-rose-600 hover:bg-rose-50 transition-all"
              >
                <LogOut size={18} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
