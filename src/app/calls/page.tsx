'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { toast } from 'sonner';
import { MobileView } from '@/components/MobileView';
import { DesktopView } from '@/components/DesktopView';

export default function CallsPage() {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'all' | 'major' | 'minor'>('all');
  const [userProfile, setUserProfile] = useState<any>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('');
  const [branchSearch, setBranchSearch] = useState('');
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [dateRange, setDateRange] = useState<{start: Date, end: Date, label: string}>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    return { start, end, label: 'Last 30 Days' };
  });
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');

  // High-Performance States
  const [freezePoint, setFreezePoint] = useState<Date>(() => new Date());
  const [newCallsCount, setNewCallsCount] = useState(0);
  const [pendingCalls, setPendingCalls] = useState<any[] | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ newCount: number, updatedCount: number } | null>(null);

  const router = useRouter();

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // INIT
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase.from('app_users').select('*').eq('id', user.id).single();
      setUserProfile(profile);

      // Fetch offices for HODs or managers with multiple branches
      if (profile?.role === 'hod' || profile?.role === 'super_admin' || (profile?.office_ids && profile.office_ids.length > 1)) {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await axios.get('/api/offices', {
          headers: { 'Authorization': `Bearer ${session?.access_token}` }
        });
        setOffices(res.data || []);
      }
    }
    init();
  }, []);

  // Fetch Logic with Race Condition Prevention (AbortController)
  useEffect(() => {
    if (!userProfile) return;
    
    const controller = new AbortController();
    setPage(1);
    const now = new Date();
    setFreezePoint(now);
    
    fetchCalls(1, true, controller.signal);
    
    // Auto-refresh every 10 seconds (disabled if searching)
    const intervalId = setInterval(() => {
      if (!globalSearch || globalSearch.length <= 2) {
        fetchCalls(1, false, undefined, true);
      }
    }, 10000);

    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [selectedOfficeId, selectedStatus, activeTab, dateRange, userProfile, globalSearch]);

  const checkNewCalls = async () => {
    try {
      const { count } = await supabase
        .from('calls_cache')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', selectedOfficeId)
        .gt('logged_at', freezePoint.toISOString());

      setNewCallsCount(count || 0);
    } catch (err) {

    }
  };

  const handleCatchUp = () => {
    setFreezePoint(new Date());
    setNewCallsCount(0);
    fetchCalls(1);
  };

  const fetchCalls = async (pageToFetch: number = 1, isInitial: boolean = false, signal?: AbortSignal, silent: boolean = false) => {
    if (isInitial) {
      setLoading(true);
      setCalls([]); 
      setTotalCount(0);
      setPage(1);
    } else if (!silent) {
      setLoading(true);
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const limit = 100;
      let finalUrl = `/api/calls?priority=${activeTab}&limit=${limit}&page=${pageToFetch}&freezePoint=${freezePoint.toISOString()}`;
      
      if (selectedOfficeId) finalUrl += `&officeId=${selectedOfficeId}`;
      if (selectedStatus !== 'All') finalUrl += `&status=${selectedStatus}`;
      if (globalSearch && globalSearch.length > 2) finalUrl += `&search=${encodeURIComponent(globalSearch)}`;
      
      // Pass absolute date bounds
      finalUrl += `&startDate=${dateRange.start.toISOString().split('T')[0]}&endDate=${dateRange.end.toISOString().split('T')[0]}`;
      
      const res = await axios.get(finalUrl, { 
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal
      });

      if (signal?.aborted) return;
      
      const { data: fetchedCalls, total, totalPages: fetchedTotalPages } = res.data;

      if (silent) {
        // Silent update handling
        const currentIds = new Set(calls.map(c => String(c.id)));
        let newCount = 0;

        fetchedCalls.forEach((nc: any) => {
          if (!currentIds.has(String(nc.id))) {
            newCount++;
          }
        });

        if (newCount > 0 && !signal?.aborted) {
          setPendingCalls(fetchedCalls);
          setUpdateInfo({ newCount, updatedCount: 0 });
        }
        return;
      }

      // Main update
      setCalls(fetchedCalls); 
      setTotalCount(total);
      setTotalPages(fetchedTotalPages);
      setPage(pageToFetch);
      setLoading(false);

    } catch (err: any) {
      if (axios.isCancel(err)) return;
      const errorMsg = err.response?.data?.error || "Failed to fetch data";
      toast.error(errorMsg);

      if (isInitial || !silent) setLoading(false);
    }
  };



  const handleApplyUpdates = () => {
    if (pendingCalls) {
      setCalls(pendingCalls);
      setPendingCalls(null);
      setUpdateInfo(null);
    }
  };

  const handleSelectCall = async (id: string) => {
    setSelectedCallId(id);
    setIsDrawerOpen(true);

    const targetCall = calls.find(c => c.id === id);
    if (targetCall) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await axios.get(`/api/calls/${id}?officeId=${targetCall.office_id}&vtrnno=${targetCall.vtrnno}`, {
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
    const newComment = { author_name: userProfile?.name || 'User', comment: text, created_at: new Date().toISOString() };
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
    const matchesSearch = !globalSearch ||
      c.customer_name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
      c.engineer_name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
      c.vtrnno?.includes(globalSearch) ||
      c.vcomplaint?.toLowerCase().includes(globalSearch.toLowerCase());
    return matchesSearch;
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
    onPageChange: (p: number) => fetchCalls(p),
    activeTab,
    setActiveTab,
    selectedStatus,
    setSelectedStatus,
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
    updateInfo,
    onApplyUpdates: handleApplyUpdates,
    newCallsCount,
    onCatchUp: handleCatchUp,
    onFullReset: () => { },
    lastSyncTime: null,
    isSyncing: false,
    syncProgress: 0,
    onManualSync: () => { },
    onStopSync: () => { },
    onNext: handleNextCall,
    onPrev: handlePrevCall,
    hasNext: currentIndex < localFilteredCalls.length - 1,
    hasPrev: currentIndex > 0,
    currentIndex,
    carouselTotalCount: localFilteredCalls.length,
  };

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
            <span className="text-[11px] font-extrabold uppercase tracking-widest whitespace-nowrap">Captured: {copyStatus}</span>
          </div>
        </div>
      )}
    </>
  );
}
