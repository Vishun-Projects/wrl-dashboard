'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import * as Popover from '@radix-ui/react-popover';
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
  ChevronDown,
  ShieldCheck,
  User,
  Map,
  ScanBarcode,
  Receipt,
  MapPin,
  Shield,
  Gauge,
  Mail,
  History,
  GitCompareArrows,
  Ban,
  Package,
  ShieldAlert,
  Repeat,
  XCircle,
  Hourglass,
  Table,
  PackageSearch,
  LayoutDashboard,
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  defaultLandingPath,
  RBAC_NAV_SECTIONS,
  visiblePages,
  type RbacNavSection,
} from '@/lib/auth/rbac-catalog';
import { canViewSecurityAudit } from '@/lib/security/audit-access';

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
  const [isAdminExpanded, setIsAdminExpanded] = useState(true);
  const [isCollapsedAdminPopoverOpen, setIsCollapsedAdminPopoverOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<RbacNavSection, boolean>>({
    CRM: true,
    'CRM + SAP': false,
    SAP: false,
  });
  const [collapsedSectionPopover, setCollapsedSectionPopover] = useState<RbacNavSection | null>(
    null
  );

  // Persistence in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('wrl-sidebar-collapsed');
    if (saved !== null) {
      setIsCollapsed(saved === 'true');
    }
  }, []);

  // Auto-expand admin accordion if currently on an admin page
  const isCurrentPathAdmin = pathname.startsWith('/admin');
  useEffect(() => {
    if (isCurrentPathAdmin) {
      setIsAdminExpanded(true);
    }
  }, [isCurrentPathAdmin]);

  const sectionIcon = (section: RbacNavSection) =>
    section === 'CRM' ? FileSpreadsheet : section === 'CRM + SAP' ? GitCompareArrows : Table;

  const isItemActive = (item: { href: string; exactPath: boolean }) =>
    item.exactPath
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const toggleCollapse = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    setIsCollapsedAdminPopoverOpen(false);
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
    // Hard navigation breaks auth redirect loops after cookie clear.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional sign-out full reload
    window.location.assign('/login');
  };

  const pageNav = visiblePages(user?.permissions ?? []);
  const canSeeSecurityAudit = canViewSecurityAudit(user?.permissions);
  const iconForPath = (path: string) =>
    path === '/report'
      ? FileSpreadsheet
      : path === '/report/distribution'
        ? Map
        : path === '/report/arcp-claims'
          ? Receipt
          : path === '/report/arcp-provision'
            ? Receipt
          : path === '/report/serial-audit'
            ? ScanBarcode
            : path === '/report/location-audit'
              ? MapPin
              : path === '/compressor-barcodes'
                ? Repeat
              : path === '/report/warranty-master'
                ? Shield
              : path === '/report/warranty-comparison'
                ? ShieldAlert
                : path === '/report/athena-reconciliation'
                  ? GitCompareArrows
                  : path === '/report/cancelled-calls'
                    ? Ban
                    : path === '/report/defective-serials'
                      ? PackageSearch
                    : path === '/report/rejected-calls'
                      ? XCircle
                    : path === '/report/call-visits'
                      ? Package
                    : path === '/report/spare-loan-check'
                      ? PackageSearch
                    : path === '/report/spare-stock-analysis'
                      ? Package
                    : path === '/report/zss02'
                      ? FileSpreadsheet
                    : path === '/report/mb51-aging'
                      ? Hourglass
                    : path === '/report/mb51-table'
                      ? Table
                  : path === '/admin/users'
                  ? Users
                  : path === '/admin/roles'
                    ? ShieldCheck
                    : path === '/admin/performance-insights'
                      ? Gauge
                    : path === '/admin/mis-email-settings'
                      ? Mail
                      : path === '/admin/security-audit'
                        ? History
                      : ShieldCheck;

  type NavItem = {
    name: string;
    href: string;
    exactPath: boolean;
    icon: typeof FileSpreadsheet;
    navSection?: RbacNavSection;
  };

  const allNavigationItems: NavItem[] = [
    ...pageNav.map((page) => ({
      name: page.label,
      href: page.path,
      exactPath: page.exactPath ?? false,
      icon: iconForPath(page.path),
      navSection: page.navSection,
    })),
    ...(canSeeSecurityAudit
      ? [{ name: 'Activity Log', href: '/admin/security-audit', exactPath: true, icon: History }]
      : []),
  ];

  // Separate into primary Reports and Admin sub-pages
  const reportsNav = allNavigationItems.filter((item) => !item.href.startsWith('/admin'));
  const adminNav = allNavigationItems.filter((item) => item.href.startsWith('/admin'));

  const reportSections = RBAC_NAV_SECTIONS.map((section) => ({
    section,
    items: reportsNav.filter((item) => (item.navSection ?? 'CRM') === section),
  })).filter((group) => group.items.length > 0);

  // Keep the section that owns the current route open
  useEffect(() => {
    for (const { section, items } of reportSections) {
      if (items.some((item) => isItemActive(item))) {
        setExpandedSections((prev) => (prev[section] ? prev : { ...prev, [section]: true }));
        break;
      }
    }
  }, [pathname]);

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-bg-canvas text-slate-600 select-none dark:border-slate-800 dark:bg-slate-900">
      {/* Header / Logo — h-14 aligns with PageShell header border */}
      <div className="relative flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 px-3.5 dark:border-slate-800">
        <div
          className="flex items-center gap-2.5 cursor-pointer group overflow-hidden"
          onClick={() => router.push(defaultLandingPath())}
        >
          <div className="w-7.5 h-7.5 bg-bg-soft border border-slate-100 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105 active:scale-95 shadow-2xs flex-shrink-0 dark:border-slate-800 dark:bg-slate-800">
            <Image src="/western-head-logo-2025.png" alt="W" width={19} height={19} className="object-contain" style={{ width: 'auto', height: 'auto' }} />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col justify-center animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-xs font-bold text-slate-900 leading-none tracking-tight dark:text-white">WRL PORTAL</span>
            </div>
          )}
        </div>

        {/* Collapsible toggle button on desktop */}
        <button
          onClick={toggleCollapse}
          className="hidden md:flex absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-bg-canvas border border-slate-200 text-slate-400 hover:text-slate-800 items-center justify-center transition-colors z-50 shadow-2xs dark:border-slate-700 dark:bg-slate-900 dark:hover:text-white"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      </div>

      {/* Navigation links */}
      <div className="flex-1 py-2.5 px-2.5 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {(() => {
          const dashboardActive = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
          return (
            <button
              type="button"
              onClick={() => {
                router.push('/dashboard');
                setIsMobileOpen(false);
              }}
              className={`sidebar-nav-button group w-full flex items-center rounded-lg text-xs transition-all ${
                dashboardActive
                  ? 'bg-blue-50/80 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                  : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
              } ${isCollapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-2'}`}
              title="Dashboard"
            >
              <LayoutDashboard
                size={16}
                className={`sidebar-nav-icon transition-colors flex-shrink-0 ${
                  dashboardActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                }`}
              />
              {!isCollapsed ? <span className="truncate">Dashboard</span> : null}
            </button>
          );
        })()}

        {/* 1. Reports: CRM / CRM + SAP / SAP — same accordion pattern as Admin */}
        {reportSections.map(({ section, items }, sectionIndex) => {
          const SectionIcon = sectionIcon(section);
          const sectionActive = items.some((item) => isItemActive(item));
          const sectionOpen = expandedSections[section];

          return (
            <div key={section} className={sectionIndex > 0 ? 'pt-1.5' : undefined}>
              {sectionIndex > 0 ? (
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              ) : null}

              {isCollapsed ? (
                <Popover.Root
                  open={collapsedSectionPopover === section}
                  onOpenChange={(open) => setCollapsedSectionPopover(open ? section : null)}
                >
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className={`sidebar-nav-button group w-full flex items-center justify-center py-2 rounded-lg text-xs transition-all relative ${
                        sectionActive
                          ? 'bg-blue-50/80 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                          : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                      } px-0`}
                      title={section}
                    >
                      <SectionIcon
                        size={16}
                        className={`sidebar-nav-icon transition-colors flex-shrink-0 ${
                          sectionActive
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                        }`}
                      />
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      side="right"
                      align="start"
                      sideOffset={10}
                      className="z-[999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-1.5 min-w-[200px] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150 space-y-0.5 backdrop-blur-md"
                    >
                      <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span>{section}</span>
                        <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 rounded px-1.5 py-0.2">
                          {items.length}
                        </span>
                      </div>
                      <div className="pt-0.5 space-y-0.5">
                        {items.map((subItem) => {
                          const isSubActive = isItemActive(subItem);
                          return (
                            <button
                              key={subItem.href}
                              type="button"
                              onClick={() => {
                                router.push(subItem.href);
                                setCollapsedSectionPopover(null);
                              }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-all ${
                                isSubActive
                                  ? 'bg-slate-950 text-white font-semibold shadow-2xs dark:bg-blue-600 dark:text-white'
                                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                              }`}
                            >
                              <subItem.icon
                                size={15}
                                className={isSubActive ? 'text-white' : 'text-slate-400'}
                              />
                              <span>{subItem.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
                    }
                    className={`sidebar-nav-button group w-full flex items-center justify-between py-2 rounded-lg text-xs transition-all relative ${
                      sectionActive
                        ? 'bg-blue-50/80 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                        : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                    } px-2.5`}
                  >
                    <div className="flex items-center gap-2.5">
                      <SectionIcon
                        size={16}
                        className={`sidebar-nav-icon transition-colors flex-shrink-0 ${
                          sectionActive
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                        }`}
                      />
                      <span className="animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap font-semibold">
                        {section}
                      </span>
                    </div>
                    <ChevronDown
                      size={13}
                      className={`text-slate-400 transition-transform duration-200 ${
                        sectionOpen ? 'rotate-180 text-slate-700 dark:text-slate-200' : ''
                      }`}
                    />
                  </button>

                  {sectionOpen ? (
                    <div className="pl-2.5 pr-1 space-y-0.5 border-l-2 border-slate-200/80 dark:border-slate-800 ml-3.5 my-1 animate-in slide-in-from-top-1 duration-200">
                      {items.map((subItem) => {
                        const isSubActive = isItemActive(subItem);
                        return (
                          <button
                            key={subItem.href}
                            type="button"
                            onClick={() => {
                              router.push(subItem.href);
                              setIsMobileOpen(false);
                            }}
                            className={`group w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-[11.5px] font-medium transition-all ${
                              isSubActive
                                ? 'bg-slate-950 text-white font-semibold shadow-2xs dark:bg-slate-800 dark:text-white'
                                : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-850 dark:hover:text-slate-200'
                            }`}
                          >
                            <subItem.icon
                              size={14}
                              className={`flex-shrink-0 transition-colors ${
                                isSubActive
                                  ? 'text-white'
                                  : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500'
                              }`}
                            />
                            <span className="truncate">{subItem.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}

        {/* 2. Admin Section (Collapsed with Floating Popover / Expanded with Accordion) */}
        {adminNav.length > 0 && (
          <div className="pt-1.5">
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            {isCollapsed ? (
              /* Collapsed Mode: Radix Floating Popover rendered outside sidebar container */
              <Popover.Root
                open={isCollapsedAdminPopoverOpen}
                onOpenChange={setIsCollapsedAdminPopoverOpen}
              >
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    className={`sidebar-nav-button group w-full flex items-center justify-center py-2 rounded-lg text-xs transition-all relative ${
                      isCurrentPathAdmin
                        ? 'bg-blue-50/80 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                        : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                    } px-0`}
                    title="Admin"
                  >
                    <ShieldCheck
                      size={16}
                      className={`sidebar-nav-icon transition-colors flex-shrink-0 ${
                        isCurrentPathAdmin
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                      }`}
                    />
                  </button>
                </Popover.Trigger>

                <Popover.Portal>
                  <Popover.Content
                    side="right"
                    align="start"
                    sideOffset={10}
                    className="z-[999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-1.5 min-w-[200px] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150 space-y-0.5 backdrop-blur-md"
                  >
                    <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span>Administration</span>
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 rounded px-1.5 py-0.2">
                        {adminNav.length}
                      </span>
                    </div>
                    <div className="pt-0.5 space-y-0.5">
                      {adminNav.map((subItem) => {
                        const isSubActive =
                          subItem.exactPath
                            ? pathname === subItem.href
                            : pathname === subItem.href || pathname.startsWith(`${subItem.href}/`);
                        return (
                          <button
                            key={subItem.name}
                            type="button"
                            onClick={() => {
                              router.push(subItem.href);
                              setIsCollapsedAdminPopoverOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-all ${
                              isSubActive
                                ? 'bg-slate-950 text-white font-semibold shadow-2xs dark:bg-blue-600 dark:text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                          >
                            <subItem.icon size={15} className={isSubActive ? 'text-white' : 'text-slate-400'} />
                            <span>{subItem.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              /* Expanded Mode: Inline Collapsible Accordion */
              <>
                <button
                  type="button"
                  onClick={() => setIsAdminExpanded(!isAdminExpanded)}
                  className={`sidebar-nav-button group w-full flex items-center justify-between py-2 rounded-lg text-xs transition-all relative ${
                    isCurrentPathAdmin
                      ? 'bg-blue-50/80 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                      : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                  } px-2.5`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck
                      size={16}
                      className={`sidebar-nav-icon transition-colors flex-shrink-0 ${
                        isCurrentPathAdmin
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                      }`}
                    />
                    <span className="animate-in fade-in slide-in-from-left-2 duration-300 whitespace-nowrap font-semibold">
                      Admin
                    </span>
                  </div>

                  <ChevronDown
                    size={13}
                    className={`text-slate-400 transition-transform duration-200 ${
                      isAdminExpanded ? 'rotate-180 text-slate-700 dark:text-slate-200' : ''
                    }`}
                  />
                </button>

                {isAdminExpanded && (
                  <div className="pl-2.5 pr-1 space-y-0.5 border-l-2 border-slate-200/80 dark:border-slate-800 ml-3.5 my-1 animate-in slide-in-from-top-1 duration-200">
                    {adminNav.map((subItem) => {
                      const isSubActive =
                        subItem.exactPath
                          ? pathname === subItem.href
                          : pathname === subItem.href || pathname.startsWith(`${subItem.href}/`);
                      return (
                        <button
                          key={subItem.name}
                          type="button"
                          onClick={() => {
                            router.push(subItem.href);
                            setIsMobileOpen(false);
                          }}
                          className={`group w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-[11.5px] font-medium transition-all ${
                            isSubActive
                              ? 'bg-slate-950 text-white font-semibold shadow-2xs dark:bg-slate-800 dark:text-white'
                              : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-850 dark:hover:text-slate-200'
                          }`}
                        >
                          <subItem.icon
                            size={14}
                            className={`flex-shrink-0 transition-colors ${
                              isSubActive
                                ? 'text-white'
                                : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500'
                            }`}
                          />
                          <span className="truncate">{subItem.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer / Profile — Popover portal so the menu is not clipped by sidebar overflow */}
      <div className="flex-shrink-0 border-t border-slate-100 p-2.5 dark:border-slate-800">
        <Popover.Root open={isProfileOpen} onOpenChange={setIsProfileOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 transition-all hover:bg-bg-soft dark:hover:bg-slate-800 ${
                isCollapsed ? 'justify-center' : ''
              }`}
              aria-label="Account menu"
            >
              <div className="flex h-7.5 w-7.5 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {user?.avatar_url ? (
                  <Image
                    src={resolveAvatarDisplayUrl(user.avatar_url) ?? user.avatar_url}
                    alt=""
                    width={30}
                    height={30}
                    className="h-full w-full object-cover"
                    unoptimized
                  />
                ) : user?.name ? (
                  user.name.charAt(0).toUpperCase()
                ) : (
                  <User size={13} />
                )}
              </div>

              {!isCollapsed && (
                <div className="min-w-0 flex-1 text-left animate-in fade-in slide-in-from-left-2 duration-300">
                  <p className="truncate text-xs font-medium leading-tight text-slate-900 dark:text-white">
                    {user?.name || 'Loading...'}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-400">
                    {user?.role || 'User'}
                  </p>
                </div>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align={isCollapsed ? 'start' : 'end'}
              sideOffset={8}
              collisionPadding={8}
              className="z-[200] min-w-[190px] space-y-0.5 rounded-xl border border-slate-200 bg-bg-canvas p-1 shadow-lg outline-none animate-in fade-in zoom-in-95 duration-150 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="border-b border-slate-100 px-2.5 py-1.5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <p className="mb-0.5 text-[9px] text-slate-400">Signed in as</p>
                <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                  {user?.email}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  router.push('/profile');
                  setIsProfileOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-slate-600 transition-all hover:bg-bg-soft hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <User size={14} />
                My Profile
              </button>

              <button
                type="button"
                onClick={() => {
                  router.push('/profile?tab=settings');
                  setIsProfileOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-slate-600 transition-all hover:bg-bg-soft hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <Settings size={14} />
                Settings
              </button>

              <div className="mx-1 my-0.5 h-px bg-slate-100 dark:bg-slate-800" />

              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-rose-600 transition-all hover:bg-rose-50/60 hover:text-rose-700 dark:hover:bg-rose-950/40"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden w-full h-14 bg-bg-canvas text-slate-800 border-b border-slate-200 flex items-center justify-between px-4 z-[90] flex-shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-bg-soft border border-slate-100 rounded-lg flex items-center justify-center shadow-sm dark:border-slate-800 dark:bg-slate-800">
            <Image src="/western-head-logo-2025.png" alt="W" width={20} height={20} className="object-contain" style={{ width: 'auto', height: 'auto' }} />
          </div>
          <span className="text-xs text-slate-900 ui-label dark:text-white">WRL PORTAL</span>
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-bg-soft transition-all dark:hover:bg-slate-800 dark:hover:text-white"
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
          <aside className="md:hidden fixed top-0 left-0 bottom-0 w-56 z-[120] animate-in slide-in-from-left duration-300">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Desktop Persistent Collapsible Spacer */}
      <div
        className={`hidden md:block transition-all duration-300 ease-in-out flex-shrink-0 ${isCollapsed ? 'w-14' : 'w-56'}`}
      />

      {/* Desktop Persistent Collapsible Sidebar Panel */}
      <aside
        className={`hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-[100] transition-all duration-300 ease-in-out ${isCollapsed ? 'w-14' : 'w-56'}`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
