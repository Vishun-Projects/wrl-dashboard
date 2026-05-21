'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { MobileView } from '@/components/MobileView';
import { DesktopView } from '@/components/DesktopView';
import { useUser } from '@/components/DashboardLayout';

interface GlobalCallsCacheType {
  calls: any[];
  totalCount: number;
  totalPages: number;
  page: number;
  activeTab: 'all' | 'major' | 'minor';
  selectedOfficeId: string;
  dateRange: { start: Date; end: Date; label: string };
  selectedStatus: string;
  globalSearch: string;
  freezePoint: Date;
  newCallsCount: number;
  portalFilter: string;
  lastSyncTime: string;
}

let globalCallsCache: GlobalCallsCacheType | null = null;

export default function CallsPage() {
  const [mounted, setMounted] = useState(false);
  const supabase = createClient();
  
  const [calls, setCalls] = useState<any[]>(globalCallsCache?.calls || []);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(globalCallsCache?.page || 1);
  const [totalPages, setTotalPages] = useState<number>(globalCallsCache?.totalPages || 1);
  const [totalCount, setTotalCount] = useState<number>(globalCallsCache?.totalCount || 0);

  useEffect(() => {
    if (!globalCallsCache?.calls?.length) {
      try {
        const cached = localStorage.getItem('calls_fortnight_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.calls) setCalls(parsed.calls);
          if (parsed.totalPages) setTotalPages(parsed.totalPages);
          if (parsed.totalCount) setTotalCount(parsed.totalCount);
          if (parsed.lastSyncTime) {
            lastSyncTimeRef.current = parsed.lastSyncTime;
            setLastSyncTime(parsed.lastSyncTime);
          }
        }
      } catch(e) {}
    }
    setMounted(true);
  }, []);
  const [activeTab, setActiveTab] = useState<'all' | 'major' | 'minor'>(globalCallsCache?.activeTab || 'all');
  const { userProfile } = useUser();
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>(globalCallsCache?.selectedOfficeId || '');
  const [branchSearch, setBranchSearch] = useState('');
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{start: Date, end: Date, label: string}>(() => {
    if (globalCallsCache) return globalCallsCache.dateRange;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 14);
    return { start, end, label: 'Last 14 Days' };
  });
  const [selectedStatus, setSelectedStatus] = useState(globalCallsCache?.selectedStatus || 'All');
  const [portalFilter, setPortalFilter] = useState(globalCallsCache?.portalFilter || 'All');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState(globalCallsCache?.globalSearch || '');

  // High-Performance States
  const [hasFetched, setHasFetched] = useState<boolean>(() => {
    if (globalCallsCache?.calls?.length) return true;
    return false; 
  });
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  const lastSyncTimeRef = useRef<string>(globalCallsCache?.lastSyncTime || new Date().toISOString().replace('T', ' ').substring(0, 19));
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => lastSyncTimeRef.current);
  const [freezePoint, setFreezePoint] = useState<Date>(() => globalCallsCache?.freezePoint || new Date());

  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const prevFiltersRef = useRef({
    selectedOfficeId,
    selectedStatus,
    portalFilter,
    activeTab,
    dateRange,
    globalSearch
  });

  const router = useRouter();

  // Sync state variables to the global cache on every change
  useEffect(() => {
    globalCallsCache = {
      calls,
      totalCount,
      totalPages,
      page,
      activeTab,
      selectedOfficeId,
      dateRange,
      selectedStatus,
      globalSearch,
      freezePoint,
      newCallsCount: 0,
      portalFilter,
      lastSyncTime
    };
  }, [calls, totalCount, totalPages, page, activeTab, selectedOfficeId, dateRange, selectedStatus, globalSearch, freezePoint, portalFilter, lastSyncTime]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!userProfile) return;
    async function loadOffices() {
      try {
        const isGlobalUser = 
          userProfile?.permissions?.includes('view_reports') || 
          userProfile?.permissions?.includes('view_all_offices') ||
          ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(userProfile?.role || '');

        if (isGlobalUser || (userProfile?.office_ids && userProfile.office_ids.length > 1)) {
          const { data: { session } } = await supabase.auth.getSession();
          const resOffices = await axios.get('/api/offices', {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
          });
          setOffices(resOffices.data || []);
        }
      } catch (err) {
        console.error('Failed to load offices:', err);
      }
    }
    loadOffices();
  }, [userProfile]);

  // Filter Monitoring (Auto-Fetch ONLY when filters actually change, NOT on mount)
  useEffect(() => {
    if (!userProfile) return;

    if (!initialCheckDone) {
      setInitialCheckDone(true);
      setHasFetched(true);
      setLoading(false); // Stop fake loader, do not auto-fetch on mount
    } else {
      const filtersChanged = 
        prevFiltersRef.current.selectedOfficeId !== selectedOfficeId ||
        prevFiltersRef.current.selectedStatus !== selectedStatus ||
        prevFiltersRef.current.portalFilter !== portalFilter ||
        prevFiltersRef.current.activeTab !== activeTab ||
        prevFiltersRef.current.dateRange.start.getTime() !== dateRange.start.getTime() ||
        prevFiltersRef.current.dateRange.end.getTime() !== dateRange.end.getTime() ||
        prevFiltersRef.current.globalSearch !== globalSearch;

      if (filtersChanged) {
        setPage(1);
        const now = new Date();
        setFreezePoint(now);
        fetchCalls(1, true);
      }
    }

    prevFiltersRef.current = {
      selectedOfficeId,
      selectedStatus,
      portalFilter,
      activeTab,
      dateRange,
      globalSearch
    };

    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [selectedOfficeId, selectedStatus, portalFilter, activeTab, dateRange, userProfile, globalSearch, hasFetched]);

  // Sync cache automatically whenever calls change on the first page, but ONLY if no active filters
  useEffect(() => {
    const isBaseFilter = selectedOfficeId === '' && selectedStatus === 'All' && portalFilter === 'All' && globalSearch === '';
    if (page === 1 && calls.length > 0 && isBaseFilter) {
      try {
        localStorage.setItem('calls_fortnight_cache', JSON.stringify({ calls, totalCount, totalPages, lastSyncTime: lastSyncTimeRef.current }));
      } catch (e) {}
    }
  }, [calls, page, totalCount, totalPages, selectedOfficeId, selectedStatus, portalFilter, globalSearch]);

  const handleManualSync = async () => {
    setHasFetched(true);
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const limit = 100;
      let finalUrl = `/api/calls?priority=${activeTab}&limit=${limit}&page=${page}&freezePoint=${freezePoint.toISOString()}`;
      
      if (selectedOfficeId) finalUrl += `&officeId=${selectedOfficeId}`;
      if (selectedStatus !== 'All') finalUrl += `&status=${selectedStatus}`;
      if (portalFilter !== 'All') finalUrl += `&portalFilter=${portalFilter}`;
      if (globalSearch && globalSearch.trim().length > 0) finalUrl += `&search=${encodeURIComponent(globalSearch)}`;
      
      finalUrl += `&startDate=${dateRange.start.toISOString().split('T')[0]}&endDate=${dateRange.end.toISOString().split('T')[0]}`;
      
      if (lastSyncTimeRef.current) {
        finalUrl += `&lastSync=${lastSyncTimeRef.current}`;
      }

      const res = await axios.get(finalUrl, { 
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });

      if (controller.signal.aborted) return;

      const { data: fetchedCalls, total, totalPages: fetchedTotalPages, isDelta } = res.data;

      if (isDelta) {
        if (fetchedCalls && fetchedCalls.length > 0) {
          const updatedCalls = [...calls];
          let updatedCount = 0;
          let addedCount = 0;
          fetchedCalls.forEach((nc: any) => {
            const idx = updatedCalls.findIndex(c => String(c.id) === String(nc.id));
            if (idx > -1) {
              updatedCalls[idx] = nc;
              updatedCount++;
            } else {
              updatedCalls.unshift(nc);
              addedCount++;
            }
          });
          setCalls(updatedCalls);
          toast.success(`Sync completed! ${addedCount} new, ${updatedCount} updated records.`);
        } else {
          toast.success("Sync completed! Everything up to date.");
        }
      } else {
        setCalls(fetchedCalls);
        setTotalCount(total);
        setTotalPages(fetchedTotalPages);
        toast.success("Full sync completed.");
      }
      
      lastSyncTimeRef.current = new Date().toISOString().replace('T', ' ').substring(0, 19);
      setLastSyncTime(lastSyncTimeRef.current);
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      toast.error(err.response?.data?.error || "Failed to sync data");
    } finally {
      setLoading(false);
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
    }
  };

  const handleFullReset = async () => {
    setHasFetched(true);
    setLoading(true);
    try {
      const now = new Date();
      setFreezePoint(now);
      lastSyncTimeRef.current = now.toISOString().replace('T', ' ').substring(0, 19);
      setLastSyncTime(lastSyncTimeRef.current);
      await fetchCalls(1, true);
      toast.success("Full reload completed from scratch.");
    } catch (err: any) {
      toast.error("Failed to run full reload.");
    } finally {
      setLoading(false);
    }
  };

  const fetchCalls = async (pageToFetch: number = 1, isInitial: boolean = false) => {
    setHasFetched(true);
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    if (isInitial) {
      setLoading(true);
      // We do NOT clear setCalls([]) here anymore so that the localStorage cache remains visible while fetching!
      setPage(1);
    } else {
      setLoading(true);
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const limit = 100;
      let finalUrl = `/api/calls?priority=${activeTab}&limit=${limit}&page=${pageToFetch}&freezePoint=${freezePoint.toISOString()}`;
      
      if (selectedOfficeId) finalUrl += `&officeId=${selectedOfficeId}`;
      if (selectedStatus !== 'All') finalUrl += `&status=${selectedStatus}`;
      if (portalFilter !== 'All') finalUrl += `&portalFilter=${portalFilter}`;
      if (globalSearch && globalSearch.trim().length > 0) finalUrl += `&search=${encodeURIComponent(globalSearch)}`;
      
      // Pass absolute date bounds
      finalUrl += `&startDate=${dateRange.start.toISOString().split('T')[0]}&endDate=${dateRange.end.toISOString().split('T')[0]}`;

      const res = await axios.get(finalUrl, { 
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });

      if (controller.signal.aborted) return;
      
      const { data: fetchedCalls, total, totalPages: fetchedTotalPages } = res.data;

      // Main update
      setCalls(fetchedCalls); 
      setTotalCount(total);
      setTotalPages(fetchedTotalPages);
      setPage(pageToFetch);
      setLoading(false);
      lastSyncTimeRef.current = new Date().toISOString().replace('T', ' ').substring(0, 19);
      setLastSyncTime(lastSyncTimeRef.current);

    } catch (err: any) {
      if (axios.isCancel(err)) return;
      const errorMsg = err.response?.data?.error || "Failed to fetch data";
      toast.error(errorMsg);

      setLoading(false);
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
    }
  };

  const handleStopQuery = () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
      setLoading(false);
      toast.info("Query stopped by user.");
    }
  };

  const handleSelectCall = async (id: string) => {
    setSelectedCallId(id);
    setIsDrawerOpen(true);

    const targetCall = calls.find(c => c.id === id);
    if (targetCall) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await axios.get(`/api/calls/${id}?officeId=${targetCall.office_id || ''}&vtrnno=${targetCall.vtrnno || ''}`, {
          headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        setCalls(prev => prev.map(c => c.id === id ? { ...c, ...res.data } : c));
      } catch (err: any) {
        toast.error(err.response?.data?.error || "Failed to load call details");
      }
    }
  };

  const handleFlagUpdate = async (id: string, flag: string) => {
    const targetCall = calls.find(c => c.id === id);
    setCalls(prev => prev.map(c => c.id === id ? { ...c, audit_flag: flag } : c));
    const { data: { session } } = await supabase.auth.getSession();
    await axios.post('/api/flags', { 
      call_id: id, 
      flag_type: flag, 
      office_id: targetCall?.office_id,
      vtrnno: targetCall?.vtrnno
    }, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    });
  };

  const handlePostComment = async (id: string, text: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const targetCall = calls.find(c => c.id === id);
    const newComment = { 
      author_name: userProfile?.name || 'User', 
      comment: text, 
      created_at: new Date().toISOString(),
      author_avatar_url: userProfile?.avatar_url || null
    };
    setCalls(prev => prev.map(c => c.id === id ? { ...c, comments: [newComment, ...(c.comments || [])] } : c));
    await axios.post('/api/comments', { 
      call_id: id, 
      text,
      office_id: targetCall?.office_id 
    }, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    });
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopyStatus(text);
    setTimeout(() => setCopyStatus(null), 2000);
  };

  const localFilteredCalls = calls.filter(c => {
    if (!globalSearch) return true;
    const searchLower = globalSearch.toLowerCase();
    return (
      String(c.customer_name || '').toLowerCase().includes(searchLower) ||
      String(c.engineer_name || '').toLowerCase().includes(searchLower) ||
      String(c.vtrnno || '').toLowerCase().includes(searchLower) ||
      String(c.vcomplaint || '').toLowerCase().includes(searchLower) ||
      String(c.vserialno || '').toLowerCase().includes(searchLower) ||
      String(c.branch_name || '').toLowerCase().includes(searchLower) ||
      String(c.vlocation || '').toLowerCase().includes(searchLower) ||
      String(c.id || '').toLowerCase().includes(searchLower) ||
      String(c.ncode || '').toLowerCase().includes(searchLower)
    );
  });

  const currentIndex = selectedCallId ? localFilteredCalls.findIndex((c: any) => c.id === selectedCallId) : -1;

  const handleNextCall = () => {
    if (currentIndex < localFilteredCalls.length - 1) {
      handleSelectCall(localFilteredCalls[currentIndex + 1].id);
    }
  };

  const handlePrevCall = () => {
    if (currentIndex > 0) {
      handleSelectCall(localFilteredCalls[currentIndex - 1].id);
    }
  };

  const handleFetchInitial = () => {
    setHasFetched(true);
    fetchCalls(1, true);
  };

  const selectedCall = calls.find(c => c.id === selectedCallId);

  const stats = {
    total: localFilteredCalls.length,
    unflagged: localFilteredCalls.filter(c => !c.audit_flag).length,
    escalate: localFilteredCalls.filter(c => c.audit_flag === 'escalate').length,
  };

  const sharedProps = {
    calls: localFilteredCalls,
    loading,
    page,
    totalPages,
    totalCount,
    hasFetched,
    onFetchCalls: handleFetchInitial,
    onPageChange: (p: number) => fetchCalls(p),
    activeTab,
    setActiveTab,
    selectedStatus,
    setSelectedStatus,
    portalFilter,
    setPortalFilter,
    globalSearch,
    setGlobalSearch,
    onLoadMore: () => { },
    onSelectCall: handleSelectCall,
    selectedCall,
    isDrawerOpen,
    setIsDrawerOpen,
    onFlagUpdate: handleFlagUpdate,
    onPostComment: handlePostComment,
    offices,
    selectedOfficeId,
    setSelectedOfficeId,
    userProfile,
    stats,
    dateRange,
    timePeriod: dateRange.label,
    setTimePeriod: (period: any) => {
      if (typeof period === 'string') {
        // Fallback for string-only updates if needed
        const end = new Date();
        const start = new Date();
        if (period === 'Today') start.setHours(0,0,0,0);
        else if (period === 'Yesterday') { start.setDate(start.getDate()-1); start.setHours(0,0,0,0); end.setDate(end.getDate()-1); end.setHours(23,59,59,999); }
        else if (period === 'Last 7 Days') start.setDate(start.getDate()-7);
        else if (period === 'Last 30 Days') start.setDate(start.getDate()-30);
        else if (period === 'all') start.setDate(start.getDate()-180);
        setDateRange({ start, end, label: period });
      } else {
        setDateRange(period);
      }
    },
    copyToClipboard,
    onFullReset: handleFullReset,
    lastSyncTime: lastSyncTime,
    isSyncing: loading,
    syncProgress: 0,
    onManualSync: handleManualSync,
    onStopSync: handleStopQuery,
    onNext: handleNextCall,
    onPrev: handlePrevCall,
    hasNext: currentIndex < localFilteredCalls.length - 1,
    hasPrev: currentIndex > 0,
    currentIndex,
    carouselTotalCount: localFilteredCalls.length,
  };

  if (!mounted) {
    return <div className="flex-1 bg-[#f8fafc]"></div>;
  }

  return (
    <>
      {isMobile ? (
        <MobileView {...sharedProps} />
      ) : (
        <DesktopView
          {...sharedProps}
          selectedCallId={selectedCallId}
          branchSearch={branchSearch}
          setBranchSearch={setBranchSearch}
          showBranchDropdown={showBranchDropdown}
          setShowBranchDropdown={setShowBranchDropdown}
          copyToClipboard={copyToClipboard}
        />
      )}

      {copyStatus && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-3 border border-slate-800">
            <ShieldCheck size={16} className="text-emerald-400" />
            <span className="text-[11px] whitespace-nowrap ui-label">Captured: {copyStatus}</span>
          </div>
        </div>
      )}
    </>
  );
}
