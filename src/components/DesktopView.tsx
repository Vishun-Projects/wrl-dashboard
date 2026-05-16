'use client';

import React, { useRef } from 'react';
import { LogOut, Shield, Search, Building2, ChevronDown, ArrowRight, RefreshCw, ArrowUp, Database, FileSpreadsheet } from 'lucide-react';
import { CallTable } from './CallTable';
import { CallDetail } from './CallDetail';
import { DateRangePicker } from './DateRangePicker';
import { DateRangeSelector } from './DateRangeSelector';
import { Tooltip } from './Tooltip';
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
  updateInfo: { newCount: number, updatedCount: number } | null;
  onApplyUpdates: () => void;
  lastSyncTime: string | null;
  isSyncing: boolean;
  syncProgress: any;
  onCatchUp: () => void;
  onManualSync: () => void;
  newCallsCount: number;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  currentIndex?: number;
  carouselTotalCount?: number;
  onStopSync?: () => void;
}

export function DesktopView({
  calls, loading, page, totalPages, totalCount, onPageChange, activeTab, setActiveTab,
  selectedStatus, setSelectedStatus, globalSearch, setGlobalSearch,
  onSelectCall, selectedCall, selectedCallId, isDrawerOpen, setIsDrawerOpen,
  onFlagUpdate, onPostComment, offices, selectedOfficeId, setSelectedOfficeId,
  userProfile, stats, branchSearch, setBranchSearch, showBranchDropdown, setShowBranchDropdown,
  timePeriod, setTimePeriod, copyToClipboard,
  newCallsCount, lastSyncTime, isSyncing, syncProgress, onCatchUp, onManualSync, onFullReset,
  updateInfo, onApplyUpdates, onStopSync,
  onNext, onPrev, hasNext, hasPrev,
  currentIndex, carouselTotalCount
}: DesktopViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (userProfile?.role === 'hod' || userProfile?.role === 'super_admin') return true;
    if (!userProfile?.visible_statuses || userProfile.visible_statuses.length === 0) return true;
    return userProfile.visible_statuses.includes(s);
  });

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] overflow-hidden text-slate-700 font-sans">
      <header className="flex-shrink-0 bg-white border-b border-[#e2e8f0]">
        {/* Top Nav */}
        <div className="h-14 px-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/western-head-logo-2025.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain shadow-sm" />
            <div>
              <h1 className="text-[14px] font-bold text-[#0f172a] leading-none">WRL</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-[11px] font-medium text-[#94a3b8]">
                  {isSyncing ? 'Syncing...' : (lastSyncTime ? `LIVE: ${new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'OFFLINE')}
                </span>
                <Tooltip content="Sync fresh data">
                  <button onClick={onManualSync} className="p-1 hover:bg-slate-50 rounded text-slate-300 hover:text-slate-900 transition-all">
                    <RefreshCw size={10} className={isSyncing ? 'animate-spin text-amber-500' : ''} />
                  </button>
                </Tooltip>
                {userProfile?.role === 'hod' && (
                  <Tooltip content="Deep Reset & Full Resync (1 Lakh+)">
                    <button onClick={onFullReset} className="p-1 hover:bg-rose-50 rounded text-slate-300 hover:text-rose-600 transition-all ml-0.5">
                      <Database size={10} />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {newCallsCount > 0 && (
              <button 
                onClick={onCatchUp}
                className="bg-[#fef3c7] border border-[#fde68a] rounded-full px-3.5 py-1 text-[12px] font-medium text-[#92400e] hover:bg-[#fde68a] transition-all"
              >
                ↑ {newCallsCount} new — catch up
              </button>
            )}
            {(userProfile?.role === 'hod' || userProfile?.role === 'super_admin' || (userProfile?.office_ids && userProfile.office_ids.length > 1)) && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                  className="h-9 px-3.5 bg-white border border-[#e2e8f0] rounded-lg flex items-center gap-2 hover:border-slate-400 transition-all text-[#475569] text-[13px]"
                >
                  <span className="truncate max-w-[140px]">{selectedOfficeName}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
                {showBranchDropdown && (
                  <div className="absolute top-full right-0 mt-2 w-[300px] bg-white border border-slate-200 shadow-2xl rounded-xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-3 bg-slate-50 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                          autoFocus
                          placeholder="Type to filter branches..."
                          className="w-full bg-white border border-slate-200 rounded-lg py-2 pl-8 pr-3 text-[12px] outline-none focus:border-slate-400 shadow-sm"
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto custom-scrollbar p-1.5">
                      <button
                        onClick={() => { setSelectedOfficeId(''); setShowBranchDropdown(false); setBranchSearch(''); }}
                        className={`w-full text-left px-3 py-2.5 text-[11px] font-bold rounded-lg uppercase tracking-wider mb-1 transition-colors ${!selectedOfficeId ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                      >
                        Global View (All)
                      </button>
                      {filteredOffices.map(o => (
                        <button
                          key={o.ncode}
                          onClick={() => { setSelectedOfficeId(o.ncode); setShowBranchDropdown(false); setBranchSearch(''); }}
                          className={`w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex flex-col transition-colors ${selectedOfficeId === o.ncode ? 'bg-slate-50 ring-1 ring-slate-200' : ''}`}
                        >
                          <span className="text-[12px] font-bold text-slate-900">{o.vcompanyname}</span>
                          <span className="text-[10px] text-slate-400 font-bold tabular-nums">CODE: {o.ncode}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="h-6 w-px bg-slate-100 mx-1" />
            {(userProfile?.role === 'hod' || userProfile?.role === 'super_admin') && (
              <button 
                onClick={() => router.push('/report')}
                className="flex items-center gap-2 h-9 px-4 bg-emerald-50 text-emerald-700 rounded-lg text-[13px] font-bold border border-emerald-100 hover:bg-emerald-100 transition-all shadow-sm"
              >
                <FileSpreadsheet size={16} />
                <span>Reports</span>
              </button>
            )}
            <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-all">
              <LogOut size={16} />
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
            <select
              className="h-8 bg-white border border-[#e2e8f0] rounded-lg px-2.5 text-[12px] text-[#475569] outline-none cursor-pointer"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="All">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
              <span className="text-[11px] font-bold text-white uppercase tracking-wider">Syncing Data</span>
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
                className="px-2 py-0.5 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold rounded uppercase tracking-tighter transition-all active:scale-95 shadow-lg shadow-rose-500/20"
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
            <span className="text-[13px] font-bold text-[#0f172a]">{stats.total}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-[#94a3b8]">Pending review</span>
            <span className="text-[13px] font-bold text-[#e11d48]">{stats.unflagged}</span>
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
            <span className="text-[11px] font-bold text-[#16a34a] min-w-[32px]">
              {stats.total > 0 ? Math.round(((stats.total - stats.unflagged) / stats.total) * 100) : 0}%
            </span>
          </div>
        </div>
      </header>

      {/* UPDATE NOTIFICATION PILL */}
      {updateInfo && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 duration-300">
          <button 
            onClick={onApplyUpdates}
            className="flex items-center gap-3 bg-[#0f172a] text-white px-6 py-2.5 rounded-full shadow-2xl hover:bg-slate-800 transition-all active:scale-95 group border border-slate-700"
          >
            <div className="relative">
              <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            </div>
            <span className="text-[13px] font-bold whitespace-nowrap">
              {updateInfo.newCount > 0 && `${updateInfo.newCount} new`}
              {updateInfo.newCount > 0 && updateInfo.updatedCount > 0 && ' & '}
              {updateInfo.updatedCount > 0 && `${updateInfo.updatedCount} updated`}
              {' entries found. Click to refresh.'}
            </span>
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-slate-50/10">
        {loading && calls.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Synchronizing Data...</div>
            </div>
          </div>
        ) : (
          <div className="w-full px-6 py-8">
            <div className="relative">
              {loading && calls.length > 0 && (
                <div className="absolute top-0 right-0 p-2 z-20">
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
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
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
                          className={`w-8 h-8 flex items-center justify-center rounded-lg text-[12px] font-semibold transition-all ${page === p ? 'bg-[#0f172a] text-white' : 'bg-white border border-[#e2e8f0] text-[#475569] hover:bg-slate-50'}`}
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
