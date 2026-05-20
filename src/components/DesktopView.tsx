'use client';

import React, { useRef } from 'react';
import { LogOut, Shield, Search, Building2, ChevronDown, ArrowRight, RefreshCw, ArrowUp, Database, FileSpreadsheet } from 'lucide-react';
import { CallTable } from './CallTable';
import { CallDetail } from './CallDetail';
import { DateRangePicker } from './DateRangePicker';
import { DateRangeSelector } from './DateRangeSelector';
import { Tooltip } from './Tooltip';
import BranchTree from '@/components/BranchTree';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface DesktopViewProps {
  calls: any[];
  loading: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  activeTab: 'all' | 'major' | 'minor';
  setActiveTab: (tab: 'all' | 'major' | 'minor') => void;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  portalFilter: string;
  setPortalFilter: (filter: string) => void;
  globalSearch: string;
  setGlobalSearch: (search: string) => void;
  onSelectCall: (id: string) => void;
  selectedCall: any;
  selectedCallId: string | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  onFlagUpdate: (id: string, flag: string) => void;
  onPostComment: (id: string, text: string) => void;
  offices: any[];
  selectedOfficeId: string;
  setSelectedOfficeId: (id: string) => void;
  userProfile: any;
  stats: any;
  branchSearch: string;
  setBranchSearch: (search: string) => void;
  showBranchDropdown: boolean;
  setShowBranchDropdown: (show: boolean) => void;
  timePeriod: string;
  setTimePeriod: (period: any) => void;
  copyToClipboard: (text: string) => void;
  // New High-Performance Props
  onFullReset: () => void;
  lastSyncTime: string | null;
  isSyncing: boolean;
  syncProgress: any;
  onManualSync: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  currentIndex?: number;
  carouselTotalCount?: number;
  onStopSync?: () => void;
  hasFetched?: boolean;
  onFetchCalls?: () => void;
}

export function DesktopView({
  calls, loading, page, totalPages, totalCount, onPageChange, activeTab, setActiveTab,
  selectedStatus, setSelectedStatus, portalFilter, setPortalFilter, globalSearch, setGlobalSearch,
  onSelectCall, selectedCall, selectedCallId, isDrawerOpen, setIsDrawerOpen,
  onFlagUpdate, onPostComment, offices, selectedOfficeId, setSelectedOfficeId,
  userProfile, stats, branchSearch, setBranchSearch, showBranchDropdown, setShowBranchDropdown,
  timePeriod, setTimePeriod, copyToClipboard,
  lastSyncTime, isSyncing, syncProgress, onManualSync, onFullReset,
  onStopSync,
  onNext, onPrev, hasNext, hasPrev,
  currentIndex, carouselTotalCount,
  hasFetched, onFetchCalls
}: DesktopViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const selectedOfficeName = offices.find(o => o.ncode === selectedOfficeId)?.vcompanyname || 'All Branches';
  const filteredOffices = offices.filter(o =>
    o.vcompanyname.toLowerCase().includes(branchSearch.toLowerCase()) ||
    o.ncode.toString().includes(branchSearch)
  ).slice(0, 50);

  const STATUSES = [
    'Open Unallocated',
    'Assigned',
    'Tech. Solve Call',
    'Closed'
  ].filter(s => {
    const isGlobal = 
      userProfile?.permissions?.includes('view_reports') ||
      userProfile?.permissions?.includes('view_all_offices') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(userProfile?.role || '');

    if (isGlobal) return true;
    if (!userProfile?.visible_statuses || userProfile.visible_statuses.length === 0) return true;
    return userProfile.visible_statuses.includes(s);
  });

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] overflow-hidden font-sans">
      {/* Syncing Progress Header Banner */}
      {syncProgress?.is_running && (
        <div className="bg-slate-900 px-6 py-2 flex items-center justify-between gap-4 border-b border-slate-800 flex-shrink-0 animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] text-amber-400 flex items-center gap-1.5 shrink-0 ui-label">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
              Syncing {syncProgress.progress}%
            </span>
            <span className="text-[11px] text-slate-400 font-medium truncate">
              {syncProgress.current_step}
            </span>
          </div>
          <div className="flex items-center gap-4 flex-1 max-w-md">
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-amber-400 transition-all duration-500 rounded-full" 
                style={{ width: `${syncProgress.progress}%` }} 
              />
            </div>
            {onStopSync && (
              <button 
                onClick={onStopSync}
                className="text-[10px] text-slate-400 hover:text-white transition-colors ui-label"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Top Bar */}
      <header className="flex-shrink-0 border-b border-slate-200/80 bg-white">
        <div className="h-14 px-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/western-head-logo-2025.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-900 ui-label">Western CRM</span>
                <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] rounded border border-emerald-100 ui-strong">
                  Live
                </span>
              </div>
              <p className="text-[9px] text-slate-400 font-medium">Fast-Close Executive Operations Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
          </div>

          <div className="flex items-center gap-2">
            {lastSyncTime && mounted && (
              <span suppressHydrationWarning className="text-[10px] text-slate-400 font-medium">
                Last Refreshed: {new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            {isSyncing && (
              <button
                onClick={onStopSync}
                className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-all shadow-sm flex items-center gap-1 ui-label animate-pulse"
                title="Stop current query execution"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                Stop Query
              </button>
            )}
            <button
              onClick={onManualSync}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-md text-xs hover:bg-slate-800 transition-all shadow-sm disabled:opacity-50 ui-label"
              title="Fast delta sync (fetches only new or updated calls since last sync)"
            >
              <div className={`${isSyncing ? 'animate-spin' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
              </div>
              Sync
            </button>
            <button
              onClick={onFullReset}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-white text-slate-700 px-3 py-1.5 rounded-md text-xs border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm disabled:opacity-50 ui-label"
              title="Full reload (re-runs all queries from scratch)"
            >
              <div className={`${isSyncing ? 'animate-spin' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
              </div>
              Full Reload
            </button>
          </div>
        </div>

        {/* Sub Nav */}
        <div className="px-7 h-12 flex items-center justify-between border-t border-[#e2e8f0] bg-white">
          <div className="flex gap-0 h-full">
            {['all', 'major', 'minor'].map((t: any) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`h-full px-4 text-[13px] transition-all border-b-2 flex items-center ${activeTab === t ? 'text-[#0f172a] border-[#0f172a]' : 'text-[#94a3b8] border-transparent hover:text-slate-600'}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            {(userProfile?.permissions.includes('view_reports') || (userProfile?.office_ids && userProfile.office_ids.length > 1)) && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                  className="h-8 px-3 bg-white border border-[#e2e8f0] rounded-lg flex items-center gap-2 hover:border-[#cbd5e1] transition-all text-[#475569] text-[12px]"
                >
                  <span className="truncate max-w-[150px]">{selectedOfficeName}</span>
                  <ChevronDown size={14} className="text-[#94a3b8]" />
                </button>
                {showBranchDropdown && (
                  <div className="absolute top-full left-0 mt-2 w-[300px] bg-white border border-slate-200 shadow-2xl rounded-xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-3 bg-slate-50 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                          autoFocus
                          placeholder="Filter branches..."
                          className="w-full bg-white border border-slate-200 rounded-lg py-1.5 pl-9 pr-3 text-[12px] outline-none"
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                      <button
                        onClick={() => { setSelectedOfficeId(''); setShowBranchDropdown(false); setBranchSearch(''); }}
                        className={`w-full text-left px-3 py-2 text-[11px] font-medium rounded-lg mb-1 transition-all ${!selectedOfficeId ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >
                        Global View
                      </button>
                      <BranchTree
                        offices={offices}
                        selectedIds={selectedOfficeId ? [String(selectedOfficeId)] : []}
                        setSelectedIds={(ids) => {
                          const id = ids[0] || '';
                          setSelectedOfficeId(id);
                          setShowBranchDropdown(false);
                          setBranchSearch('');
                        }}
                        single
                        search={branchSearch}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <select
              className="h-8 bg-white border border-[#e2e8f0] rounded-lg px-2.5 text-[12px] text-[#475569] outline-none cursor-pointer"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="All">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              className="h-8 bg-white border border-[#e2e8f0] rounded-lg px-2.5 text-[12px] text-[#475569] outline-none cursor-pointer"
              value={portalFilter}
              onChange={(e) => setPortalFilter(e.target.value)}
            >
              <option value="All">All Actions</option>
              <option value="unseen">Unseen</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="hold">On Hold</option>
              <option value="comments">With Comments</option>
            </select>
            <DateRangeSelector
              value={timePeriod}
              onChange={(range) => {
                setTimePeriod(range);
              }}
            />
            <input
              placeholder="Search records…"
              className="h-8 w-[200px] bg-white border border-[#e2e8f0] rounded-lg px-3 text-[12px] text-[#475569] outline-none"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Sync Progress Bar */}
        {syncProgress?.is_running && (
          <div className="h-10 px-7 bg-slate-900 flex items-center gap-4 animate-in slide-in-from-top-full duration-300">
            <div className="flex items-center gap-2 min-w-[140px]">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[11px] text-white ui-label">Syncing Data</span>
            </div>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-500 ease-out shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                style={{ width: `${syncProgress.progress}%` }}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[11px] font-mono text-slate-400 min-w-[160px] text-right truncate">
                {syncProgress.current_step} · {syncProgress.progress}%
              </div>
              <button
                onClick={onStopSync}
                className="px-2 py-0.5 bg-rose-500 hover:bg-rose-600 text-white text-[10px] rounded transition-all active:scale-95 shadow-lg shadow-rose-500/20 ui-label"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {/* Stats Bar */}
        <div className="flex items-center gap-6 px-7 py-2.5 bg-white border-t border-[#f1f5f9]">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-[#94a3b8]">Total batch</span>
            <span className="text-[13px] text-[#0f172a] ui-label">{stats.total}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-[#94a3b8]">Pending review</span>
            <span className="text-[13px] text-[#e11d48] ui-label">{stats.unflagged}</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#94a3b8]">Review progress</span>
            <div className="w-[120px] h-1 bg-[#e2e8f0] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#16a34a] transition-all duration-500"
                style={{ width: `${stats.total > 0 ? Math.round(((stats.total - stats.unflagged) / stats.total) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[11px] text-[#16a34a] min-w-[32px] ui-label">
              {stats.total > 0 ? Math.round(((stats.total - stats.unflagged) / stats.total) * 100) : 0}%
            </span>
          </div>
        </div>
      </header>



      <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-slate-50/10">
        {!hasFetched ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50">
            <div className="max-w-md w-full mx-auto p-8 bg-white border border-slate-200/80 rounded-2xl shadow-xl text-center flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center shadow-inner text-slate-800">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="11" y2="17" /></svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 ui-label font-sans">Calls Dashboard</h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">
                  Click below to fetch the first batch of 100 latest edited calls. You can customize active filters above before fetching.
                </p>
              </div>
              <button
                onClick={onFetchCalls}
                className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 active:scale-98 transition-all shadow-md flex items-center justify-center gap-2 ui-label"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                Fetch 100 Latest Calls
              </button>
            </div>
          </div>
        ) : loading && calls.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-[11px] text-slate-400 animate-pulse ui-label">Synchronizing Data...</div>
              <button
                onClick={onStopSync}
                className="px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-md transition-all shadow-sm flex items-center gap-1 ui-label"
              >
                Stop Query
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full px-6 py-8">
            <div className="relative">
              {loading && calls.length > 0 && (
                <div className="absolute top-0 right-0 p-2 z-20 flex items-center gap-2">
                  <button
                    onClick={onStopSync}
                    className="px-2 py-0.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-[10px] font-semibold rounded transition-all shadow-sm ui-label"
                  >
                    Stop
                  </button>
                  <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              <CallTable
                calls={calls}
                onFlagUpdate={onFlagUpdate}
                onSelectCall={(id) => { onSelectCall(id); setIsDrawerOpen(true); }}
                onCopy={copyToClipboard}
                selectedId={selectedCallId}
                activeTab={activeTab}
              />
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-6">
              <div className="text-[11px] text-slate-400 ui-label">
                Showing Page <span className="text-slate-900">{page}</span> of <span className="text-slate-900">{totalPages}</span>
                <span className="ml-2 text-slate-300">({totalCount} records total)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page === 1 || loading}
                  onClick={() => onPageChange(page - 1)}
                  className="h-8 px-3 bg-white border border-[#e2e8f0] rounded-lg text-[12px] font-medium text-[#475569] hover:border-slate-400 disabled:opacity-30 transition-all shadow-sm"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {/* Smart Pagination Window */}
                  {(() => {
                    const pages = [];
                    const windowSize = 1; // Show 1 page on each side of current

                    // Always show first page
                    pages.push(1);

                    if (page > windowSize + 2) pages.push('...');

                    const start = Math.max(2, page - windowSize);
                    const end = Math.min(totalPages - 1, page + windowSize);

                    for (let p = start; p <= end; p++) {
                      pages.push(p);
                    }

                    if (page < totalPages - (windowSize + 1)) pages.push('...');

                    // Always show last page if more than 1
                    if (totalPages > 1) pages.push(totalPages);

                    return pages.map((p, idx) => {
                      if (p === '...') return <span key={`ellipsis-${idx}`} className="px-1 text-[#94a3b8] text-[12px]">...</span>;
                      return (
                        <button
                          key={p}
                          onClick={() => onPageChange(p as number)}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg text-[12px] transition-all ${page === p ? 'bg-[#0f172a] text-white' : 'bg-white border border-[#e2e8f0] text-[#475569] hover:bg-slate-50'} ui-label`}
                        >
                          {p}
                        </button>
                      );
                    });
                  })()}
                </div>
                <button
                  disabled={page === totalPages || loading}
                  onClick={() => onPageChange(page + 1)}
                  className="h-8 px-3 bg-white border border-[#e2e8f0] rounded-lg text-[12px] font-medium text-[#475569] hover:border-slate-400 disabled:opacity-30 transition-all shadow-sm"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {isDrawerOpen && selectedCall && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 animate-in fade-in duration-300" onClick={() => setIsDrawerOpen(false)} />
          <div className="relative bg-white shadow-[0_8px_40px_rgba(0,0,0,0.12)] rounded-[20px] w-full max-w-[850px] h-[min(800px,92vh)] flex flex-col animate-in zoom-in-95 slide-in-from-bottom-12 duration-300 overflow-hidden border border-slate-200">
            <CallDetail
              call={selectedCall}
              onClose={() => setIsDrawerOpen(false)}
              onFlagUpdate={onFlagUpdate}
              onPostComment={onPostComment}
              onNext={onNext}
              onPrev={onPrev}
              hasNext={hasNext}
              hasPrev={hasPrev}
              currentIndex={currentIndex}
              totalCount={carouselTotalCount}
            />
          </div>
        </div>
      )}
    </div>
  );
}
