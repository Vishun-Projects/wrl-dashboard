'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Search, Building2, Filter, ArrowRight, 
  ChevronDown, LayoutGrid, List, SlidersHorizontal,
  Clock, Shield, ArrowUpRight, RefreshCw, ArrowUp, Database, FileSpreadsheet
} from 'lucide-react';
import { CallCard } from './CallCard';
import { CallDetail } from './CallDetail';
import { DateRangePicker } from './DateRangePicker';

interface MobileViewProps {
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
  timePeriod: string;
  setTimePeriod: (period: any) => void;
  onLoadMore: () => void;
  onSelectCall: (id: string) => void;
  selectedCall: any;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  onFlagUpdate: (id: string, flag: string) => void;
  onPostComment: (id: string, text: string) => void;
  offices: any[];
  selectedOfficeId: string;
  setSelectedOfficeId: (id: string) => void;
  userProfile: any;
  stats: any;
  // High-Performance Props
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

export function MobileView({
  calls, loading, page, totalPages, totalCount, onPageChange, activeTab, setActiveTab,
  selectedStatus, setSelectedStatus, globalSearch, setGlobalSearch,
  onSelectCall, selectedCall, isDrawerOpen, setIsDrawerOpen,
  onFlagUpdate, onPostComment, offices, selectedOfficeId, setSelectedOfficeId,
  userProfile, stats, timePeriod, setTimePeriod,
  newCallsCount, lastSyncTime, isSyncing, syncProgress, onCatchUp, onManualSync, onFullReset,
  updateInfo, onApplyUpdates,
  onNext, onPrev, hasNext, hasPrev,
  currentIndex, carouselTotalCount
}: MobileViewProps) {
  const router = useRouter();
  const [showFilters, setShowFilters] = useState(false);

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
    <div className="flex flex-col h-screen bg-[#f1f5f9] overflow-hidden font-sans">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-3.5 bg-white border-b border-[#f1f5f9] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/western-head-logo-2025.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
          <div>
            <div className="text-[14px] text-[#0f172a] leading-none ui-strong">WRL</div>
            <div className="flex items-center gap-1 mt-1">
              <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-[11px] font-medium text-[#94a3b8]">
                {isSyncing ? 'Syncing...' : 'LIVE'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(userProfile?.permissions?.includes('view_reports') || 
            userProfile?.permissions?.includes('view_all_offices') || 
            ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(userProfile?.role || '')) && (
            <button 
              onClick={() => router.push('/report')}
              className="bg-white border border-[#e2e8f0] rounded-lg px-2.5 py-1.5 text-[14px] text-emerald-600"
            >
              <FileSpreadsheet size={16} />
            </button>
          )}
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="bg-white border border-[#e2e8f0] rounded-lg px-2.5 py-1.5 text-[14px] text-[#64748b]"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="p-2.5 px-4 bg-white flex-shrink-0">
        <input 
          placeholder="Search records…"
          className="w-full h-10 bg-[#f8fafc] border border-[#e2e8f0] rounded-lg px-3.5 text-[13px] text-[#374151] outline-none"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
      </div>

      {/* Catch-up Banner */}
      {newCallsCount > 0 && (
        <button 
          onClick={onCatchUp}
          className="w-full bg-[#fef3c7] border-t border-[#fde68a] py-2.5 text-[12px] text-[#92400e] text-center font-medium"
        >
          ↑ {newCallsCount} new entries — tap to catch up
        </button>
      )}

      {/* Sync Progress Banner (Mobile) */}
      {syncProgress?.is_running && (
        <div className="bg-slate-900 px-4 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-amber-400 ui-label">Syncing {syncProgress.progress}%</span>
            <span className="text-[10px] text-slate-400 truncate max-w-[150px]">{syncProgress.current_step}</span>
          </div>
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${syncProgress.progress}%` }} />
          </div>
        </div>
      )}

      {/* Stats Pills */}
      <div className="flex gap-2 px-4 py-2.5 bg-white border-b border-[#f1f5f9] flex-shrink-0 overflow-x-auto no-scrollbar">
        <span className="text-[12px] text-[#0369a1] bg-[#e0f2fe] rounded-full px-3 py-1 whitespace-nowrap">● {stats.total} Total</span>
        <span className="text-[12px] text-[#e11d48] bg-[#fff1f2] rounded-full px-3 py-1 whitespace-nowrap">● {stats.escalate} Rejected</span>
        <span className="text-[12px] text-[#16a34a] bg-[#f0fdf4] rounded-full px-3 py-1 whitespace-nowrap">● {stats.total - stats.unflagged} Verified</span>
      </div>

      {/* List Area */}
      <main className="flex-1 overflow-y-auto px-4 py-3 pb-24 flex flex-col gap-2.5">
        {loading && calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-3 border-[#0f172a] border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] font-medium text-[#94a3b8]">Syncing...</span>
          </div>
        ) : (
          calls.map(call => (
            <CallCard
              key={call.id}
              call={call}
              onSelect={(id) => onSelectCall(id)}
              onFlagUpdate={onFlagUpdate}
              onPostComment={onPostComment}
              activeTab={activeTab}
            />
          ))
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 inset-x-0 h-16 bg-white border-t border-[#e2e8f0] flex items-center z-50">
        {[
          { id: 'all', label: 'All' },
          { id: 'major', label: 'Major' },
          { id: 'minor', label: 'Minor' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 h-full text-[13px] font-medium transition-all border-t-2 ${activeTab === tab.id ? 'text-[#0f172a] border-[#0f172a]' : 'text-[#94a3b8] border-transparent'}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* FILTER SHEET (OVERLAY) */}
      {showFilters && (
        <div className="fixed inset-0 z-[100] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[32px] p-6 animate-in slide-in-from-bottom-full duration-400">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8" />
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl text-slate-900 ui-strong">Audit Filters</h2>
              <button onClick={() => setShowFilters(false)} className="p-2 bg-slate-100 rounded-full">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-[10px] text-slate-400 block mb-3 ui-label">Service Location</label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select 
                    className="w-full h-12 bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 text-sm text-slate-900 outline-none appearance-none ui-label"
                    value={selectedOfficeId}
                    onChange={(e) => setSelectedOfficeId(e.target.value)}
                  >
                    <option value="">All Branches</option>
                    {offices.map(o => <option key={o.ncode} value={o.ncode}>{o.vcompanyname}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-3 ui-label">Time Window</label>
                <select
                  className="w-full h-12 bg-white border border-[#e2e8f0] rounded-xl px-4 text-[13px] text-[#0f172a] outline-none ui-label"
                  value={timePeriod}
                  onChange={(e) => setTimePeriod(e.target.value)}
                >
                  <option value="Today">Today</option>
                  <option value="Last 3 Days">Last 3 Days</option>
                  <option value="Last 7 Days">Last 7 Days</option>
                  <option value="Last 30 Days">Last 30 Days</option>
                  <option value="This Month">This Month</option>
                  <option value="Last Month">Last Month</option>
                  <option value="All Time">All Time</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-3 ui-label">Lifecycle Status</label>
                <div className="grid grid-cols-2 gap-2">
                  {STATUSES.map(s => (
                    <button
                      key={s}
                      onClick={() => setSelectedStatus(s)}
                      className={`px-3 py-3 rounded-2xl text-[11px] transition-all border ${ selectedStatus === s ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-slate-50 text-slate-600 border-slate-200' } ui-label`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={() => setShowFilters(false)}
                className="w-full py-4 bg-slate-900 text-white rounded-3xl text-sm mt-4 shadow-xl shadow-slate-200 active:scale-[0.98] transition-all ui-label"
              >
                Apply Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE CALL DETAIL DRAWER */}
      {isDrawerOpen && selectedCall && (
        <div className="fixed inset-0 z-[120] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setIsDrawerOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 top-[5%] bg-white rounded-t-[32px] overflow-hidden flex flex-col animate-in slide-in-from-bottom-full duration-500">
            <div className="flex-shrink-0 h-1.5 w-12 bg-slate-200 rounded-full mx-auto my-4" />
            <div className="flex-1 flex flex-col min-h-0">
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
        </div>
      )}
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg 
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" 
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
