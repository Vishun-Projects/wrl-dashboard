'use client';

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { resolveAvatarDisplayUrl } from '@/lib/auth/avatar-url';
import {
  Users,
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
  Map,
  ScanBarcode,
  Receipt,
  MapPin,
  Shield,
  Gauge,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { defaultLandingPath, visiblePages } from '@/lib/auth/rbac-catalog';

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
  const [homePath, setHomePath] = useState('/report');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Persistence in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('wrl-sidebar-collapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setHomePath(defaultLandingPath(user.permissions ?? []));
  }, [user?.id, user?.permissions]);

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
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    } catch {
      /* still navigate to login */
    }
    try {
      await supabase.auth.signOut();
    } catch {
      /* client storage cleanup is best-effort */
    }
    // Full page load clears dashboard state and stops in-flight report fetches.
    window.location.assign('/login');
  };

  const pageNav = visiblePages(user?.permissions ?? []);
  const iconForPath = (path: string) =>
    path === '/report'
      ? FileSpreadsheet
      : path === '/report/distribution'
        ? Map
        : path === '/report/arcp-claims'
          ? Receipt
          : path === '/report/serial-audit'
            ? ScanBarcode
            : path === '/report/location-audit'
              ? MapPin
              : path === '/report/warranty-master'
                ? Shield
                : path === '/admin/users'
                  ? Users
                  : path === '/admin/performance-insights'
                    ? Gauge
                    : ShieldCheck;

  const filteredNavigation = pageNav.map((page) => ({
    name: page.label,
    href: page.path,
    exactPath: page.exactPath ?? false,
    icon: iconForPath(page.path),
  }));

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-bg-canvas text-slate-600 select-none">
      {/* Header / Logo — h-14 aligns with PageShell header border */}
      <div className="relative flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div
          className="flex items-center gap-3 cursor-pointer group overflow-hidden"
          onClick={() => router.push(homePath)}
        >
          <div className="w-8 h-8 bg-bg-soft border border-slate-100 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105 active:scale-95 shadow-sm flex-shrink-0">
            <Image src="/western-head-logo-2025.png" alt="W" width={20} height={20} className="object-contain" style={{ height: 'auto' }} />
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
          className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-bg-canvas border border-slate-200 text-slate-400 hover:text-slate-800 items-center justify-center transition-colors z-50"
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Navigation links */}
      <div className="flex-1 py-4 px-3 space-y-1.5 custom-scrollbar">
        {filteredNavigation.map((item) => {
          const isActive = item.exactPath
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <button
              key={item.name}
              onClick={() => {
                router.push(item.href);
                setIsMobileOpen(false);
              }}
              className={`sidebar-nav-button w-full flex items-center gap-3 py-3 rounded-xl text-xs transition-colors relative ${isActive ? 'is-active bg-slate-950 text-white' : 'text-slate-500 hover:bg-bg-soft hover:text-slate-900'} ${isCollapsed ? 'justify-center px-0' : 'px-3'} ui-label`}
            >
              <item.icon
                size={18}
                className={`sidebar-nav-icon transition-colors flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'}`}
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
          className={`flex items-center gap-3 p-2 rounded-xl hover:bg-bg-soft cursor-pointer transition-all ${isCollapsed ? 'justify-center' : ''}`}
        >
          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 overflow-hidden flex-shrink-0">
            {user?.avatar_url ? (
              <Image
                src={resolveAvatarDisplayUrl(user.avatar_url) ?? user.avatar_url}
                alt=""
                width={32}
                height={32}
                className="h-full w-full object-cover"
                unoptimized
              />
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
          <div className={`absolute bottom-full mb-2 bg-bg-canvas border border-slate-200 shadow-sm rounded-xl z-[150] p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-200 ${isCollapsed ? 'left-3 w-48' : 'right-3'}`}>
            <div className="p-2 border-b border-slate-100 text-slate-500">
              <p className="text-[9px] text-slate-400 mb-0.5 ui-strong">Signed in as</p>
              <p className="text-[11px] text-slate-700 truncate ui-label">{user?.email}</p>
            </div>

            <button
              onClick={() => { router.push('/profile'); setIsProfileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] text-slate-600 hover:text-slate-950 hover:bg-bg-soft transition-all ui-label"
            >
              <User size={14} />
              My Profile
            </button>

            <button
              onClick={() => { router.push('/profile?tab=settings'); setIsProfileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] text-slate-600 hover:text-slate-950 hover:bg-bg-soft transition-all ui-label"
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
      <div className="md:hidden w-full h-14 bg-bg-canvas text-slate-800 border-b border-slate-200 flex items-center justify-between px-4 z-[90] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-bg-soft border border-slate-100 rounded-lg flex items-center justify-center shadow-sm">
            <Image src="/western-head-logo-2025.png" alt="W" width={20} height={20} className="object-contain" style={{ height: 'auto' }} />
          </div>
          <span className="text-xs text-slate-900 ui-label">WRL PORTAL</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-bg-soft transition-all"
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
