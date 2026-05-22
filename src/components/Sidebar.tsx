'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  LayoutDashboard,
  FileSpreadsheet,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  User,
  ExternalLink,
  Map
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface SidebarProps {
  user: {
    id?: string;
    name: string;
    email: string;
    role?: string;
    avatar_url?: string;
    permissions: string[];
  } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Persistence in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('wrl-sidebar-collapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
  }, []);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleCollapse = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    localStorage.setItem('wrl-sidebar-collapsed', String(nextState));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navigation = [
    {
      name: 'Calls Dashboard',
      href: '/calls',
      icon: LayoutDashboard,
      permission: 'view_calls'
    },
    {
      name: 'Call Distribution',
      href: '/report/distribution',
      icon: Map,
      permission: 'view_calls'
    },
    {
      name: 'MIS Reports',
      href: '/report',
      icon: FileSpreadsheet,
      permission: 'view_calls'
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
    !item.permission || user?.permissions?.includes(item.permission)
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white text-slate-600 border-r border-slate-200/80 select-none">
      {/* Header / Logo */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200 flex-shrink-0 relative">
        <div
          className="flex items-center gap-3 cursor-pointer group overflow-hidden"
          onClick={() => router.push('/calls')}
        >
          <div className="w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105 active:scale-95 shadow-sm flex-shrink-0">
            <img src="/western-head-logo-2025.png" alt="W" className="w-5 h-5 object-contain" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col justify-center animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-xs text-slate-900 leading-none ui-label">WRL PORTAL</span>
            </div>
          )}
        </div>

        {/* Collapsible toggle button on desktop */}
        <button
          onClick={toggleCollapse}
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-800 items-center justify-center transition-colors z-50"
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Navigation links */}
      <div className="flex-1 py-4 px-3 space-y-1.5 custom-scrollbar">
        {filteredNavigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <button
              key={item.name}
              onClick={() => {
                router.push(item.href);
                setIsMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 py-3 rounded-xl text-xs transition-colors relative ${isActive ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'} ${isCollapsed ? 'justify-center px-0' : 'px-3'} ui-label`}
            >
              <item.icon
                size={18}
                className={`transition-colors flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'}`}
              />

              {!isCollapsed && (
                <span className="animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap">
                  {item.name}
                </span>
              )}

              {/* Tooltip for collapsed view */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 text-[10px] bg-slate-900 text-white rounded-lg border border-slate-850 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 whitespace-nowrap ui-label">
                  {item.name}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer / Profile section */}
      <div className="p-3 border-t border-slate-100 flex-shrink-0 relative" ref={dropdownRef}>
        <div
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          className={`flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-all ${isCollapsed ? 'justify-center' : ''}`}
        >
          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 overflow-hidden flex-shrink-0">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              user?.name ? user.name.charAt(0).toUpperCase() : <User size={14} />
            )}
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0 animate-in fade-in slide-in-from-left-2 duration-300">
              <p className="text-[11px] text-slate-900 truncate leading-tight ui-label">{user?.name || 'Loading...'}</p>
              <p className="text-[9px] text-slate-450 truncate mt-0.5 ui-strong">
                {user?.role || 'User'}
              </p>
            </div>
          )}
        </div>

        {/* Profile Popover / Dropdown */}
        {isProfileOpen && (
          <div className={`absolute bottom-full mb-2 bg-white border border-slate-200 shadow-sm rounded-xl z-[150] p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-200 ${isCollapsed ? 'left-3 w-48' : 'right-3'}`}>
            <div className="p-2 border-b border-slate-100 text-slate-500">
              <p className="text-[9px] text-slate-400 mb-0.5 ui-strong">Signed in as</p>
              <p className="text-[11px] text-slate-700 truncate ui-label">{user?.email}</p>
            </div>

            <button
              onClick={() => { router.push('/profile'); setIsProfileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] text-slate-600 hover:text-slate-950 hover:bg-slate-50 transition-all ui-label"
            >
              <User size={14} />
              My Profile
            </button>

            <button
              onClick={() => { router.push('/profile?tab=settings'); setIsProfileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] text-slate-600 hover:text-slate-950 hover:bg-slate-50 transition-all ui-label"
            >
              <Settings size={14} />
              Settings
            </button>

            <div className="h-px bg-slate-105 my-1 mx-1" />

            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] text-rose-650 hover:text-rose-700 hover:bg-rose-50/60 transition-all ui-label"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden w-full h-14 bg-white text-slate-800 border-b border-slate-200 flex items-center justify-between px-4 z-[90] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center shadow-sm">
            <img src="/western-head-logo-2025.png" alt="W" className="w-5 h-5 object-contain" />
          </div>
          <span className="text-xs text-slate-900 ui-label">WRL PORTAL</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all"
        >
          {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Overlay Menu Drawer */}
      {isMobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[110]"
            onClick={() => setIsMobileOpen(false)}
          />
          <aside className="md:hidden fixed top-0 left-0 bottom-0 w-64 z-[120] animate-in slide-in-from-left duration-300">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Desktop Persistent Collapsible Spacer */}
      <div
        className={`hidden md:block transition-all duration-300 ease-in-out flex-shrink-0 ${isCollapsed ? 'w-20' : 'w-64'}`}
      />

      {/* Desktop Persistent Collapsible Sidebar Panel */}
      <aside
        className={`hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-[100] transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'}`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
