'use client';

import React, { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { createClient } from '@/lib/supabase/client';
import axios from 'axios';
import {
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  X,
  MapPin
} from 'lucide-react';
import { toast } from 'sonner';
import { useUser } from '@/components/DashboardLayout';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { CallDetail } from '@/components/CallDetail';
import { useRouter, usePathname } from 'next/navigation';

interface GlobalReportCacheType {
  data: any[];
  summaryData: any[];
  accountsData: any[];
  globalHeadcount: number;
  total: number;
  page: number;
  search: string;
  pincodeSearch: string;
  selectedOfficeIds: string[];
  dateRange: { start: Date; end: Date; label: string };
  filterRegion: string[];
  filterAccount: string[];
  selectedCallTypes: string[];
  registerSummary: { total: number, transferred: number, cancelled: number, solved: number, open: number } | null;
  lastRefreshed: Date | null;
  agingAsOf: string;
  selectedStatus: string;
  selectedState?: string;
  selectedCity?: string;
  selectedBranch?: string;
  selectedFranchisee?: string;
  selectedTechnician?: string;
}

// --- IndexedDB Local Storage Cache Helpers ---
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject('Not in browser');
      return;
    }
    const request = indexedDB.open('wrl_reports_db', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('calls')) {
        db.createObjectStore('calls', { keyPath: 'UniqueCallNo' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    request.onsuccess = (e: any) => resolve(e.target.result);
    request.onerror = (e: any) => reject(e.target.error);
  });
};

const saveCallsToDB = async (calls: any[]) => {
  try {
    const db = await openDB();
    const tx = db.transaction('calls', 'readwrite');
    const store = tx.objectStore('calls');
    calls.forEach((c) => {
      if (c.UniqueCallNo) {
        store.put(c);
      }
    });
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('IndexedDB save error:', err);
  }
};

const getCallsFromDB = async (): Promise<any[]> => {
  try {
    const db = await openDB();
    const tx = db.transaction('calls', 'readonly');
    const store = tx.objectStore('calls');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('IndexedDB read error:', err);
    return [];
  }
};

const saveMeta = async (key: string, val: any) => {
  try {
    const db = await openDB();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(val, key);
  } catch (err) {
    console.error('IndexedDB meta save error:', err);
  }
};

const getMeta = async (key: string): Promise<any> => {
  try {
    const db = await openDB();
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
};

const clearCallsDB = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction(['calls', 'meta'], 'readwrite');
    tx.objectStore('calls').clear();
    tx.objectStore('meta').clear();
  } catch (err) {
    console.error('IndexedDB clear error:', err);
  }
};

let globalReportCache: GlobalReportCacheType | null = null;

export default function ReportPage() {
  const { userProfile } = useUser();
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  const [dbInitialized, setDbInitialized] = useState(!!globalReportCache);
  const [activeTab, setActiveTab] = useState<'register' | 'summary' | 'accounts'>('register');
  const [data, setData] = useState<any[]>(globalReportCache?.data || []);
  const [summaryData, setSummaryData] = useState<any[]>(globalReportCache?.summaryData || []);
  const [accountsData, setAccountsData] = useState<any[]>(globalReportCache?.accountsData || []);
  const [globalHeadcount, setGlobalHeadcount] = useState<number>(globalReportCache?.globalHeadcount || 0);
  const [loading, setLoading] = useState(!globalReportCache);
  const [total, setTotal] = useState(globalReportCache?.total || 0);
  const [page, setPage] = useState(globalReportCache?.page || 1);
  const [limit] = useState(10);
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const prefetchedDataRef = React.useRef<{ page: number, data: any[], total?: number } | null>(null);
  const [search, setSearch] = useState(globalReportCache?.search || '');
  const [debouncedSearch, setDebouncedSearch] = useState(globalReportCache?.search || '');
  const [pincodeSearch, setPincodeSearch] = useState(globalReportCache?.pincodeSearch || '');
  const [debouncedPincodeSearch, setDebouncedPincodeSearch] = useState(globalReportCache?.pincodeSearch || '');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPincodeSearch(pincodeSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [pincodeSearch]);

  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>(globalReportCache?.selectedOfficeIds || []);
  const [showOfficeDropdown, setShowOfficeDropdown] = useState(false);
  const [dateRange, setDateRange] = useState<{start: Date, end: Date, label: string}>(() => {
    if (globalReportCache) return {
      start: new Date(globalReportCache.dateRange.start),
      end: new Date(globalReportCache.dateRange.end),
      label: globalReportCache.dateRange.label || 'Last 30 Days'
    };
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end, label: 'Last 30 Days' };
  });
  const [selectedBranchEngs, setSelectedBranchEngs] = useState<string[]>([]);
  const [showEngPopup, setShowEngPopup] = useState<string | null>(null);
  const [fetchingEngs, setFetchingEngs] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(globalReportCache?.lastRefreshed || null);
  const [filterRegion, setFilterRegion] = useState<string[]>(globalReportCache?.filterRegion || []); // Array for multiselect
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string[]>(Array.isArray(globalReportCache?.filterAccount) ? globalReportCache.filterAccount : []);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [tempFilterRegion, setTempFilterRegion] = useState<string[]>([]);
  const [tempFilterAccount, setTempFilterAccount] = useState<string[]>([]);
  const [tempSelectedCallTypes, setTempSelectedCallTypes] = useState<string[]>([]);
  const [tempSelectedOfficeIds, setTempSelectedOfficeIds] = useState<string[]>([]);
  const [selectedCallTypes, setSelectedCallTypes] = useState<string[]>(globalReportCache?.selectedCallTypes || []);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [showCallTypeDropdown, setShowCallTypeDropdown] = useState(false);
  const [exportingDetailed, setExportingDetailed] = useState(false);
  const [agingAsOf, setAgingAsOf] = useState<string>(() => {
    if (globalReportCache && typeof globalReportCache.agingAsOf === 'string' && globalReportCache.agingAsOf.includes('-') && !globalReportCache.agingAsOf.includes(':')) {
      return globalReportCache.agingAsOf;
    }
    return new Date().toISOString().split('T')[0];
  });
  const [selectedStatus, setSelectedStatus] = useState<string>(globalReportCache?.selectedStatus || 'All');

  const [selectedState, setSelectedState] = useState<string>(globalReportCache?.selectedState || 'All');
  const [statesList, setStatesList] = useState<any[]>([]);

  const [selectedCity, setSelectedCity] = useState<string>(globalReportCache?.selectedCity || 'All');
  const [citiesList, setCitiesList] = useState<any[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleFlagUpdate = async (id: string, flag: string) => {
    // Optimistic update locally
    setData(prev => prev.map(d => (String(d.id) === String(id) ? { ...d, audit_flag: flag } : d)));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post('/api/flags', {
        call_id: id,
        flag_type: flag,
        office_id: selectedCall?.nofficeid || undefined,
        vtrnno: selectedCall?.UniqueCallNo || undefined
      }, { headers: { 'Authorization': `Bearer ${session?.access_token}` } });
    } catch (err) {
      // ignore
    }
  };

  const handlePostComment = async (id: string, text: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const targetCall = data.find(d => String(d.id) === String(id)) || selectedCall;
      const newComment = { author_name: userProfile?.name || 'User', comment: text, created_at: new Date().toISOString(), author_avatar_url: userProfile?.avatar_url || null };
      setData(prev => prev.map(d => (String(d.id) === String(id) ? { ...d, comments: [newComment, ...(d.comments || [])] } : d)));
      await axios.post('/api/comments', { call_id: id, text, office_id: targetCall?.nofficeid }, { headers: { 'Authorization': `Bearer ${session?.access_token}` } });
    } catch (err) {
      // ignore
    }
  };

  const handleSelectCall = async (id: string, row?: any) => {
    setSelectedCallId(id);
    setIsDrawerOpen(true);
    const targetCall = row || data.find(d => String(d.id) === String(id));
    
    // Set fallback initial details to prevent blank state
    setSelectedCall(targetCall || { id });
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (targetCall?.nofficeid) params.append('officeId', String(targetCall.nofficeid));
      if (targetCall?.UniqueCallNo) params.append('vtrnno', targetCall.UniqueCallNo);
      
      const res = await axios.get(`/api/calls/${id}?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setSelectedCall({
        ...(targetCall || {}),
        ...res.data
      });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load call details');
    }
  };

  const [selectedBranch, setSelectedBranch] = useState<string>(globalReportCache?.selectedBranch || 'All');
  const [branchesList, setBranchesList] = useState<any[]>([]);

  const [selectedFranchisee, setSelectedFranchisee] = useState<string>(globalReportCache?.selectedFranchisee || 'All');
  const [franchiseesList, setFranchiseesList] = useState<any[]>([]);

  const [selectedTechnician, setSelectedTechnician] = useState<string>(globalReportCache?.selectedTechnician || 'All');
  const [techniciansList, setTechniciansList] = useState<any[]>([]);

  useEffect(() => {
    // visibleLimit removed
  }, [
    search,
    pincodeSearch,
    selectedOfficeIds,
    dateRange,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus,
    selectedCallTypes,
    filterRegion,
    filterAccount
  ]);



  // CSR Dropdown change handlers to reset lower levels safely
  const handleStateChange = (val: string) => {
    setSelectedState(val);
    setSelectedCity('All');
    setSelectedBranch('All');
    setSelectedFranchisee('All');
    setSelectedTechnician('All');
  };

  const handleCityChange = (val: string) => {
    setSelectedCity(val);
    setSelectedBranch('All');
    setSelectedFranchisee('All');
    setSelectedTechnician('All');
  };

  const handleBranchChange = (val: string) => {
    setSelectedBranch(val);
    setSelectedFranchisee('All');
    setSelectedTechnician('All');
  };

  const handleFranchiseeChange = (val: string) => {
    setSelectedFranchisee(val);
    setSelectedTechnician('All');
  };

  // Helper to filter calls on the client
  const filterCallsCSR = (calls: any[], criteria: any, exclude?: string) => {
    return calls.filter((c) => {
      if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
        if (c.state !== criteria.state) return false;
      }
      if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
        if (c.city !== criteria.city) return false;
      }
      if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
        if (String(c.resolved_branch_code) !== criteria.branch) return false;
      }
      if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
        const cFranCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
        if (cFranCode !== criteria.franchisee) return false;
      }
      if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
        if (String(c.nengineer) !== criteria.technician) return false;
      }
      return true;
    });
  };

  const [officeSearch, setOfficeSearch] = useState('');
  const [drillDown, setDrillDown] = useState<{
    isOpen: boolean;
    loading: boolean;
    data: any[];
    sql: string;
    type: string;
    title: string;
    params: any;
  }>({
    isOpen: false,
    loading: false,
    data: [],
    sql: '',
    type: '',
    title: '',
    params: null
  });
  const [registerSummary, setRegisterSummary] = useState<{ total: number, transferred: number, cancelled: number, solved: number, open: number } | null>(globalReportCache?.registerSummary || null);
  const fetchControllerRef = React.useRef<AbortController | null>(null);
  const drillDownControllerRef = React.useRef<AbortController | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-sync agingAsOf with dateRange.end if it falls behind
  useEffect(() => {
    if (dateRange.end && agingAsOf) {
      const endD = dateRange.end;
      const agingD = new Date(agingAsOf);
      if (agingD < endD) {
        setAgingAsOf(endD.toISOString().split('T')[0]);
      }
    }
  }, [dateRange.end, agingAsOf]);

  // Client-side cascades computation removed in favor of server-side cascades

  // Save selections to global cache dynamically
  useEffect(() => {
    if (globalReportCache) {
      globalReportCache.selectedState = selectedState;
      globalReportCache.selectedCity = selectedCity;
      globalReportCache.selectedBranch = selectedBranch;
      globalReportCache.selectedFranchisee = selectedFranchisee;
      globalReportCache.selectedTechnician = selectedTechnician;
      globalReportCache.selectedStatus = selectedStatus;
    }
  }, [selectedState, selectedCity, selectedBranch, selectedFranchisee, selectedTechnician, selectedStatus]);

  // Fetch Offices and Call Types
  useEffect(() => {
    async function fetchOffices() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { 'Authorization': `Bearer ${session?.access_token}` };

        const [officeRes, typesRes] = await Promise.all([
          axios.get('/api/offices', { headers }),
          axios.get('/api/report/call-types', { headers })
        ]);

        setOffices(officeRes.data || []);
        setCallTypes(typesRes.data || []);
      } catch (err) {
        console.error('Failed to fetch report resources:', err);
      }
    }
    fetchOffices();
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';

    // Handle DD/MM/YYYY with optional time
    if (typeof dateStr === 'string' && dateStr.includes('/') && dateStr.split('/')[0].length <= 2) {
      const parts = dateStr.split(' ')[0].split('/');
      if (parts.length === 3) {
        const [d, m, y] = parts;
        const date = new Date(`${y}-${m}-${d}`);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      }
    }

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Return raw if still invalid, might be a string already
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const persistCurrentCache = async (
    calls: any[],
    summaryData: any[],
    accountsData: any[],
    globalHeadcount: number,
    total: number,
    registerSummary: any,
    lastRefreshedDate: Date
  ) => {
    try {
      const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');
      const callTypesParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');
      const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
      const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;

      await saveCallsToDB(calls);
      await saveMeta('cacheParams', {
        startDate: startDateStr,
        endDate: endDateStr,
        officeIds: officeIdsParam,
        callTypes: callTypesParam,
        lastRefreshed: lastRefreshedDate.toISOString(),
        total,
        registerSummary,
        summaryData,
        accountsData,
        globalHeadcount
      });
    } catch (err) {
      console.error('Failed to persist cache to IndexedDB:', err);
    }
  };

  const fetchData = async (p = 1, opts?: { silent?: boolean }) => {
    // Cancel previous request if it's still running
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }

    // Reset prefetched data cache on any fresh fetch request
    prefetchedDataRef.current = null;

    const controller = new AbortController();
    fetchControllerRef.current = controller;

    if (!opts?.silent) {
      setLoading(true);
      setLoadingPage(p);
    } else {
      setLoadingPage(null);
    }
    const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');
    const callTypesParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');

    const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
    const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Authorization': `Bearer ${session?.access_token}`,
      };

      // Register data URL
      let url = `/api/report?page=${p}&limit=${limit}&officeId=${officeIdsParam}&callType=${callTypesParam}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (debouncedPincodeSearch) url += `&pincode=${encodeURIComponent(debouncedPincodeSearch)}`;
      if (startDateStr) url += `&startDate=${startDateStr}`;
      if (endDateStr) url += `&endDate=${endDateStr}`;
      
      // Cascading and status filters
      if (selectedState && selectedState !== 'All') url += `&state=${encodeURIComponent(selectedState)}`;
      if (selectedCity && selectedCity !== 'All') url += `&city=${encodeURIComponent(selectedCity)}`;
      if (selectedBranch && selectedBranch !== 'All') url += `&branch=${encodeURIComponent(selectedBranch)}`;
      if (selectedFranchisee && selectedFranchisee !== 'All') url += `&franchisee=${encodeURIComponent(selectedFranchisee)}`;
      if (selectedTechnician && selectedTechnician !== 'All') url += `&technician=${encodeURIComponent(selectedTechnician)}`;
      if (selectedStatus && selectedStatus !== 'All') url += `&status=${encodeURIComponent(selectedStatus)}`;

      const prefetchNextPage = (currentPage: number) => {
        let nextUrl = `/api/report?page=${currentPage + 1}&limit=${limit}&fetchTotals=false&officeId=${officeIdsParam}&callType=${callTypesParam}`;
        if (search) nextUrl += `&search=${encodeURIComponent(search)}`;
        if (debouncedPincodeSearch) nextUrl += `&pincode=${encodeURIComponent(debouncedPincodeSearch)}`;
        if (startDateStr) nextUrl += `&startDate=${startDateStr}`;
        if (endDateStr) nextUrl += `&endDate=${endDateStr}`;
        
        if (selectedState && selectedState !== 'All') nextUrl += `&state=${encodeURIComponent(selectedState)}`;
        if (selectedCity && selectedCity !== 'All') nextUrl += `&city=${encodeURIComponent(selectedCity)}`;
        if (selectedBranch && selectedBranch !== 'All') nextUrl += `&branch=${encodeURIComponent(selectedBranch)}`;
        if (selectedFranchisee && selectedFranchisee !== 'All') nextUrl += `&franchisee=${encodeURIComponent(selectedFranchisee)}`;
        if (selectedTechnician && selectedTechnician !== 'All') nextUrl += `&technician=${encodeURIComponent(selectedTechnician)}`;
        if (selectedStatus && selectedStatus !== 'All') nextUrl += `&status=${encodeURIComponent(selectedStatus)}`;

        axios.get(nextUrl, { headers, signal: controller.signal }).then(res => {
          prefetchedDataRef.current = { page: currentPage + 1, data: res.data.data, total: res.data.total };
        }).catch(() => {});
      };

      // Use prefetched data if available
      const currentPrefetch = prefetchedDataRef.current as { page: number, data: any[], total?: number } | null;
      if (currentPrefetch && currentPrefetch.page === p && p > 1) {
        setData(currentPrefetch.data);
        if (currentPrefetch.total !== undefined) setTotal(currentPrefetch.total);
        setPage(p);
        
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        
        // Removed URL syncing per user request
        prefetchNextPage(p);
        return;
      }

      // Fetch summary only on the first page load or full refresh
      const needsSummary = p === 1;
      let summaryUrl = '';
      if (needsSummary) {
        summaryUrl = `/api/report/summary?officeId=${officeIdsParam}&callType=${callTypesParam}`;
        if (startDateStr) summaryUrl += `&startDate=${startDateStr}`;
        if (endDateStr) summaryUrl += `&endDate=${endDateStr}`;
        if (agingAsOf) {
          const agingStr = agingAsOf.includes(' ') || agingAsOf.includes(':')
            ? new Date(agingAsOf).toISOString().split('T')[0]
            : agingAsOf;
          summaryUrl += `&agingAsOf=${agingStr}`;
        }
      }

      const newDate = new Date();

      // Execute in parallel if summary needed
      if (needsSummary) {
        const [regRes, summRes] = await Promise.all([
          axios.get(url, { headers, signal: controller.signal }),
          axios.get(summaryUrl, { headers, signal: controller.signal })
        ]);

        setData(regRes.data.data);
        setTotal(regRes.data.total);
        setPage(p);
        setRegisterSummary(regRes.data.summary || null);

        // Update cascading options lists from server
        if (regRes.data.statesList) setStatesList(regRes.data.statesList);
        if (regRes.data.citiesList) setCitiesList(regRes.data.citiesList);
        if (regRes.data.branchesList) setBranchesList(regRes.data.branchesList);
        if (regRes.data.franchiseesList) setFranchiseesList(regRes.data.franchiseesList);
        if (regRes.data.techniciansList) setTechniciansList(regRes.data.techniciansList);

        setSummaryData(summRes.data.branchSummary);
        setAccountsData(summRes.data.accountSummary);
        setGlobalHeadcount(summRes.data.globalHeadcount || 0);

        // Save to global cache
        globalReportCache = {
          data: regRes.data.data,
          summaryData: summRes.data.branchSummary,
          accountsData: summRes.data.accountSummary,
          globalHeadcount: summRes.data.globalHeadcount || 0,
          total: regRes.data.total,
          page: p,
          search,
          pincodeSearch,
          selectedOfficeIds,
          dateRange,
          filterRegion,
          filterAccount,
          selectedCallTypes,
          registerSummary: regRes.data.summary || null,
          lastRefreshed: newDate,
          agingAsOf,
          selectedStatus,
          selectedState,
          selectedCity,
          selectedBranch,
          selectedFranchisee,
          selectedTechnician
        };

        // Save to IndexedDB
        persistCurrentCache(
          regRes.data.data,
          summRes.data.branchSummary,
          summRes.data.accountSummary,
          summRes.data.globalHeadcount || 0,
          regRes.data.total,
          regRes.data.summary || null,
          newDate
        );

        const totalPages = Math.max(1, Math.ceil(regRes.data.total / limit));
      } else {
          url += `&fetchTotals=false`;
          const regRes = await axios.get(url, { headers, signal: controller.signal });
          const newChunk = regRes.data.data || [];
          
          setData(newChunk);
          if (regRes.data.total !== undefined) {
            setTotal(regRes.data.total);
          }
          setPage(p);
          if (regRes.data.summary !== undefined) {
            setRegisterSummary(regRes.data.summary);
          }

          // Update global cache for pagination
          if (globalReportCache) {
            globalReportCache.data = newChunk;
            globalReportCache.total = regRes.data.total;
            globalReportCache.page = p;
            globalReportCache.registerSummary = regRes.data.summary || null;
            globalReportCache.lastRefreshed = newDate;

            persistCurrentCache(
              globalReportCache.data,
              globalReportCache.summaryData,
              globalReportCache.accountsData,
              globalReportCache.globalHeadcount,
              globalReportCache.total,
              globalReportCache.registerSummary,
              newDate
            );
          }
      }

      // Removed URL syncing per user request
      prefetchNextPage(p);

    } catch (err: any) {
      if (axios.isCancel(err)) {
        return; // Silently handle cancellation
      }
      toast.error("Failed to fetch report data");
    } finally {
      // Only set loading to false if this was the last request
      if (fetchControllerRef.current === controller) {
        if (!opts?.silent) {
          setLoading(false);
        }
        setLoadingPage(null);
        setLastRefreshed(new Date());
      }
    }
  };

  const formatSQLDate = (date: Date) => {
    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  };

  const isSolved = (rec: any) => {
    const statusStr = String(rec.Status || rec.callstatus || '').toLowerCase();
    return String(rec.callsolved).toLowerCase() === 'true' || String(rec.callsolved) === '1' || statusStr === 'closed' || statusStr === 'solved';
  };

  const isTransferred = (rec: any) => {
    return (rec.vtransfercallno && String(rec.vtransfercallno).trim() !== '') || String(rec.ncancelreason) === '2';
  };

  const isCancelled = (rec: any) => {
    if (isTransferred(rec)) return false;
    const statusStr = String(rec.Status || rec.callstatus || '').toLowerCase();
    return statusStr === 'cancel' || (rec.cancel_reason && String(rec.cancel_reason).trim() !== '');
  };

  const isOpen = (rec: any) => {
    return !isSolved(rec) && !isCancelled(rec) && !isTransferred(rec);
  };

  const fetchDelta = async () => {
    if (!lastRefreshed) {
      fetchData(1);
      return;
    }

    setLoading(true);
    const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');
    const callTypesParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');

    const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
    const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Authorization': `Bearer ${session?.access_token}` };

      // Subtract 10 minutes to safely avoid clock drift
      const safeSyncTime = new Date(lastRefreshed.getTime() - 10 * 60 * 1000);
      const lastSyncStr = formatSQLDate(safeSyncTime);

      let url = `/api/report?officeId=${officeIdsParam}&callType=${callTypesParam}&lastSync=${encodeURIComponent(lastSyncStr)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (debouncedPincodeSearch) url += `&pincode=${encodeURIComponent(debouncedPincodeSearch)}`;
      if (startDateStr) url += `&startDate=${startDateStr}`;
      if (endDateStr) url += `&endDate=${endDateStr}`;

      if (selectedState && selectedState !== 'All') url += `&state=${encodeURIComponent(selectedState)}`;
      if (selectedCity && selectedCity !== 'All') url += `&city=${encodeURIComponent(selectedCity)}`;
      if (selectedBranch && selectedBranch !== 'All') url += `&branch=${encodeURIComponent(selectedBranch)}`;
      if (selectedFranchisee && selectedFranchisee !== 'All') url += `&franchisee=${encodeURIComponent(selectedFranchisee)}`;
      if (selectedTechnician && selectedTechnician !== 'All') url += `&technician=${encodeURIComponent(selectedTechnician)}`;
      if (selectedStatus && selectedStatus !== 'All') url += `&status=${encodeURIComponent(selectedStatus)}`;

      const res = await axios.get(url, { headers });
      const newRecords = res.data.data || [];
      const newDate = new Date();

      if (newRecords.length > 0) {
        const updatedData = [...data];
        let newAddedCount = 0;

        newRecords.forEach((newRec: any) => {
          const idx = updatedData.findIndex(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo) || String(r.callsntrnno) === String(newRec.callsntrnno));
          if (idx > -1) {
            updatedData[idx] = newRec;
          } else {
            updatedData.unshift(newRec);
            newAddedCount++;
          }
        });

        // Sort by date descending
        updatedData.sort((a, b) => {
          const dateA = new Date(a.callsdtrndate || 0).getTime();
          const dateB = new Date(b.callsdtrndate || 0).getTime();
          return dateB - dateA;
        });

        // Update branch summaries incrementally
        setSummaryData(prevSummary => {
          const newSummary = [...prevSummary];
          newRecords.forEach((newRec: any) => {
            const isRecSolved = isSolved(newRec);
            const isRecCancelled = isCancelled(newRec);
            const isRecTransferred = isTransferred(newRec);
            const isRecOpen = isOpen(newRec);

            const branchRowIdx = newSummary.findIndex(b => b.officeId === newRec.nofficeid || b.branch?.toLowerCase() === newRec.officename?.toLowerCase());
            if (branchRowIdx > -1) {
              const row = { ...newSummary[branchRowIdx] };
              const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
              if (oldRec) {
                if (isSolved(oldRec)) row.solved_calls = Math.max(0, (row.solved_calls || 0) - 1);
                else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
                else if (isTransferred(oldRec)) row.transferred_calls = Math.max(0, (row.transferred_calls || 0) - 1);
                else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
              }
              if (isRecSolved) row.solved_calls = (row.solved_calls || 0) + 1;
              else if (isRecCancelled) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
              else if (isRecTransferred) row.transferred_calls = (row.transferred_calls || 0) + 1;
              else if (isRecOpen) row.open_calls = (row.open_calls || 0) + 1;
              
              newSummary[branchRowIdx] = row;
            }
          });
          return newSummary;
        });

        // Update key account summaries incrementally
        setAccountsData(prevAccounts => {
          const newAccounts = [...prevAccounts];
          newRecords.forEach((newRec: any) => {
            const isRecSolved = isSolved(newRec);
            const isRecCancelled = isCancelled(newRec);
            const isRecTransferred = isTransferred(newRec);
            const isRecOpen = isOpen(newRec);

            const accRowIdx = newAccounts.findIndex(a => a.account?.toLowerCase() === newRec.PartyName?.toLowerCase());
            if (accRowIdx > -1) {
              const row = { ...newAccounts[accRowIdx] };
              const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
              if (oldRec) {
                if (isSolved(oldRec)) row.total_solved = Math.max(0, (row.total_solved || 0) - 1);
                else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
                else if (isTransferred(oldRec)) row.transferred_calls = Math.max(0, (row.transferred_calls || 0) - 1);
                else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
              }
              if (isRecSolved) row.total_solved = (row.total_solved || 0) + 1;
              else if (isRecCancelled) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
              else if (isRecTransferred) row.transferred_calls = (row.transferred_calls || 0) + 1;
              else if (isRecOpen) row.open_calls = (row.open_calls || 0) + 1;
              
              newAccounts[accRowIdx] = row;
            }
          });
          return newAccounts;
        });

        // Update register count metrics
        setRegisterSummary(prev => {
          if (!prev) return null;
          let newTotal = prev.total;
          let newSolved = prev.solved;
          let newCancelled = prev.cancelled;
          let newTransferred = prev.transferred;
          let newOpen = prev.open;

          newRecords.forEach((newRec: any) => {
            const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
            if (oldRec) {
              if (isSolved(oldRec)) newSolved = Math.max(0, newSolved - 1);
              else if (isCancelled(oldRec)) newCancelled = Math.max(0, newCancelled - 1);
              else if (isTransferred(oldRec)) newTransferred = Math.max(0, newTransferred - 1);
              else if (isOpen(oldRec)) newOpen = Math.max(0, newOpen - 1);
            } else {
              newTotal++;
            }

            if (isSolved(newRec)) newSolved++;
            else if (isCancelled(newRec)) newCancelled++;
            else if (isTransferred(newRec)) newTransferred++;
            else if (isOpen(newRec)) newOpen++;
          });

          return {
            total: newTotal,
            solved: newSolved,
            cancelled: newCancelled,
            transferred: newTransferred,
            open: newOpen
          };
        });

        // Calculate new registerSummary value to save
        const nextSummary = (() => {
          if (!registerSummary) return null;
          let newTotal = registerSummary.total;
          let newSolved = registerSummary.solved;
          let newCancelled = registerSummary.cancelled;
          let newTransferred = registerSummary.transferred;
          let newOpen = registerSummary.open;

          newRecords.forEach((newRec: any) => {
            const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
            if (oldRec) {
              if (isSolved(oldRec)) newSolved = Math.max(0, newSolved - 1);
              else if (isCancelled(oldRec)) newCancelled = Math.max(0, newCancelled - 1);
              else if (isTransferred(oldRec)) newTransferred = Math.max(0, newTransferred - 1);
              else if (isOpen(oldRec)) newOpen = Math.max(0, newOpen - 1);
            } else {
              newTotal++;
            }

            if (isSolved(newRec)) newSolved++;
            else if (isCancelled(newRec)) newCancelled++;
            else if (isTransferred(newRec)) newTransferred++;
            else if (isOpen(newRec)) newOpen++;
          });
          return {
            total: newTotal,
            solved: newSolved,
            cancelled: newCancelled,
            transferred: newTransferred,
            open: newOpen
          };
        })();

        // Get the latest summaryData and accountsData arrays to save
        const nextSummaryData = (() => {
          const newSummary = [...summaryData];
          newRecords.forEach((newRec: any) => {
            const isRecSolved = isSolved(newRec);
            const isRecCancelled = isCancelled(newRec);
            const isRecTransferred = isTransferred(newRec);
            const isRecOpen = isOpen(newRec);

            const branchRowIdx = newSummary.findIndex(b => b.officeId === newRec.nofficeid || b.branch?.toLowerCase() === newRec.officename?.toLowerCase());
            if (branchRowIdx > -1) {
              const row = { ...newSummary[branchRowIdx] };
              const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
              if (oldRec) {
                if (isSolved(oldRec)) row.solved_calls = Math.max(0, (row.solved_calls || 0) - 1);
                else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
                else if (isTransferred(oldRec)) row.transferred_calls = Math.max(0, (row.transferred_calls || 0) - 1);
                else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
              }
              if (isRecSolved) row.solved_calls = (row.solved_calls || 0) + 1;
              else if (isRecCancelled) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
              else if (isRecTransferred) row.transferred_calls = (row.transferred_calls || 0) + 1;
              else if (isRecOpen) row.open_calls = (row.open_calls || 0) + 1;
              
              newSummary[branchRowIdx] = row;
            }
          });
          return newSummary;
        })();

        const nextAccountsData = (() => {
          const newAccounts = [...accountsData];
          newRecords.forEach((newRec: any) => {
            const isRecSolved = isSolved(newRec);
            const isRecCancelled = isCancelled(newRec);
            const isRecTransferred = isTransferred(newRec);
            const isRecOpen = isOpen(newRec);

            const accRowIdx = newAccounts.findIndex(a => a.account?.toLowerCase() === newRec.PartyName?.toLowerCase());
            if (accRowIdx > -1) {
              const row = { ...newAccounts[accRowIdx] };
              const oldRec = data.find(r => String(r.UniqueCallNo) === String(newRec.UniqueCallNo));
              if (oldRec) {
                if (isSolved(oldRec)) row.total_solved = Math.max(0, (row.total_solved || 0) - 1);
                else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
                else if (isTransferred(oldRec)) row.transferred_calls = Math.max(0, (row.transferred_calls || 0) - 1);
                else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
              }
              if (isRecSolved) row.total_solved = (row.total_solved || 0) + 1;
              else if (isRecCancelled) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
              else if (isRecTransferred) row.transferred_calls = (row.transferred_calls || 0) + 1;
              else if (isRecOpen) row.open_calls = (row.open_calls || 0) + 1;
              
              newAccounts[accRowIdx] = row;
            }
          });
          return newAccounts;
        })();

        setData(updatedData);
        setTotal(total + newAddedCount);
        setRegisterSummary(nextSummary);
        setSummaryData(nextSummaryData);
        setAccountsData(nextAccountsData);

        // Update cache
        if (globalReportCache) {
          globalReportCache.data = updatedData;
          globalReportCache.total = total + newAddedCount;
          globalReportCache.registerSummary = nextSummary;
          globalReportCache.summaryData = nextSummaryData;
          globalReportCache.accountsData = nextAccountsData;
          globalReportCache.lastRefreshed = newDate;
        }

        // Save to IndexedDB
        persistCurrentCache(
          updatedData,
          nextSummaryData,
          nextAccountsData,
          globalHeadcount,
          total + newAddedCount,
          nextSummary,
          newDate
        );
      }

      setLastRefreshed(newDate);
      toast.success(newRecords.length > 0 ? `Synced successfully: ${newRecords.length} call(s) synchronized!` : "Sync completed. No new calls found.");
    } catch (err: any) {
      toast.error("Failed to perform delta sync: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDrillDown = async (type: string, title: string, params: any) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, isOpen: true, loading: true, type, title, params, data: [], sql: '' }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
      const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;
      const res = await axios.post('/api/report/drilldown', {
        type,
        callType: params.callType || (selectedCallTypes.length ? selectedCallTypes.join(',') : 'All'),
        ...params,
        startDate: startDateStr,
        endDate: endDateStr
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      toast.error('Failed to fetch details');
      setDrillDown(prev => ({ ...prev, loading: false }));
    }
  };

  const runCustomQuery = async (customSql: string) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, loading: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post('/api/report/drilldown', {
        customQuery: customSql
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      toast.error('Query Error: ' + (err.response?.data?.error || err.message));
      setDrillDown(prev => ({ ...prev, loading: false }));
    }
  };

  const fetchEngineers = async (branch: string) => {
    setFetchingEngs(true);
    setShowEngPopup(branch);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
      const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;
      let url = `/api/report/engineers?branch=${encodeURIComponent(branch)}`;
      if (startDateStr) url += `&startDate=${startDateStr}`;
      if (endDateStr) url += `&endDate=${endDateStr}`;

      const res = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setSelectedBranchEngs(res.data);
    } catch (err) {
      toast.error("Failed to fetch engineer names");
    } finally {
      setFetchingEngs(false);
    }
  };

  // Initialize cache from IndexedDB on mount
  useEffect(() => {
    const initDBAndCache = async () => {
      try {
        const cacheParams = await getMeta('cacheParams');
        if (cacheParams) {
          const officeIdsParam = selectedOfficeIds.length === 0 ? 'All' : selectedOfficeIds.join(',');
          const callTypesParam = selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',');
          const startDateStr = dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start;
          const endDateStr = dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end;

          if (
            cacheParams.startDate === startDateStr &&
            cacheParams.endDate === endDateStr &&
            cacheParams.officeIds === officeIdsParam &&
            cacheParams.callTypes === callTypesParam
          ) {
            const cachedCalls = await getCallsFromDB();
            if (cachedCalls && cachedCalls.length > 0) {
              setData(cachedCalls);
              setSummaryData(cacheParams.summaryData || []);
              setAccountsData(cacheParams.accountsData || []);
              setGlobalHeadcount(cacheParams.globalHeadcount || 0);
              setTotal(cacheParams.total || 0);
              setRegisterSummary(cacheParams.registerSummary || null);
              
              const refreshedDate = new Date(cacheParams.lastRefreshed);
              setLastRefreshed(refreshedDate);

              globalReportCache = {
                data: cachedCalls,
                summaryData: cacheParams.summaryData || [],
                accountsData: cacheParams.accountsData || [],
                globalHeadcount: cacheParams.globalHeadcount || 0,
                total: cacheParams.total || 0,
                page: 1,
                search,
                pincodeSearch,
                selectedOfficeIds,
                dateRange,
                filterRegion,
                filterAccount,
                selectedCallTypes,
                registerSummary: cacheParams.registerSummary || null,
                lastRefreshed: refreshedDate,
                agingAsOf,
                selectedStatus
              };

              // Let the UI render the loaded cache first
              setLoading(false);

              // Perform silent background sync
              setTimeout(() => {
                fetchDelta();
              }, 500);
            }
          }
        }
      } catch (err) {
        console.error('Error initializing cache from IndexedDB:', err);
      } finally {
        setDbInitialized(true);
      }
    };
    initDBAndCache();
  }, []);

  // Automatically fetch data when filters change, but skip the first fetch if the cache is already present and matches the filters
  useEffect(() => {
    if (!dbInitialized) return;
    const filtersChanged = !globalReportCache ||
      globalReportCache.dateRange.start.getTime() !== dateRange.start.getTime() ||
      globalReportCache.dateRange.end.getTime() !== dateRange.end.getTime() ||
      JSON.stringify(globalReportCache.selectedOfficeIds) !== JSON.stringify(selectedOfficeIds) ||
      globalReportCache.filterAccount !== filterAccount ||
      JSON.stringify(globalReportCache.selectedCallTypes) !== JSON.stringify(selectedCallTypes) ||
      globalReportCache.selectedState !== selectedState ||
      globalReportCache.selectedCity !== selectedCity ||
      globalReportCache.selectedBranch !== selectedBranch ||
      globalReportCache.selectedFranchisee !== selectedFranchisee ||
      globalReportCache.selectedTechnician !== selectedTechnician ||
      globalReportCache.selectedStatus !== selectedStatus;

    if (filtersChanged) {
      // Fetch fresh data for the first page
      fetchData(1);
    }
  }, [
    dbInitialized,
    dateRange,
    selectedOfficeIds,
    filterAccount,
    selectedCallTypes,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus
  ]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(1);
  };

  const handleExportDetailed = async (format: 'excel' | 'csv' = 'excel') => {
    setExportingDetailed(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Authorization': `Bearer ${session?.access_token}` };

      const res = await axios.get('/api/report', {
        headers,
        params: {
          page: 1,
          limit: 100000,
          officeId: selectedOfficeIds.length ? selectedOfficeIds.join(',') : 'All',
          callType: selectedCallTypes.length ? selectedCallTypes.join(',') : 'All',
          startDate: dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start,
          endDate: dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end,
          status: selectedStatus !== 'All' ? selectedStatus : undefined,
          pincode: debouncedPincodeSearch || undefined,
          ...(activeTab === 'accounts' ? {
            account: filterAccount,
            region: filterRegion.length ? filterRegion.join(',') : undefined
          } : {})
        }
      });

      const rawData = res.data?.data || [];
      if (rawData.length === 0) {
        alert("No data to export");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Detailed Breakdown');
      const fileName = `WRL_Detailed_Breakdown_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;

      sheet.columns = [
        { header: 'ID', key: 'id', width: 15 },
        { header: 'Reference', key: 'ref', width: 15 },
        { header: 'Call Type', key: 'type', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Pincode', key: 'pincode', width: 12 },
        { header: 'Product', key: 'product', width: 20 },
        { header: 'Serial', key: 'serial', width: 15 },
        { header: 'Technician', key: 'tech', width: 20 },
        { header: 'Complaint', key: 'complaint', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Solved Date', key: 'solvedDate', width: 12 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'Contact Person', key: 'contact', width: 20 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Address', key: 'address', width: 40 },
      ];

      sheet.getRow(1).eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      rawData.forEach((row: any) => {
        const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
        const isAssigned = row.Status === 'Assigned' || row.callstatus === 'Assigned';
        const statusText = row.Status === 'UNKNOWN' ? 'PENDING' : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          id: row.UniqueCallNo,
          ref: row.callsntrnno,
          type: row.calltype,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          branch: row.officename || row.Branch || '—',
          pincode: row.Pincode || '—',
          product: row.itemname,
          serial: row.callsvserialno,
          tech: row.serviceman,
          complaint: row.vcomplaint,
          status: statusText,
          solvedDate: isSolved ? formatDate(row.callsolveddate) : '—',
          remarks: row.vsolveremarks || row.cancel_reason || '—',
          contact: row.vpersoncalling,
          phone: row.vinsttel1,
          address: row.vinstaddress
        });

        if (isSolved) {
          r.getCell('status').font = { color: { argb: 'FF10B981' }, bold: true };
        } else if (isAssigned) {
          r.getCell('status').font = { color: { argb: 'FFF59E0B' }, bold: true };
        } else {
          r.getCell('status').font = { color: { argb: 'FFEF4444' }, bold: true };
        }
      });

      let buffer;
      let mimeType;
      if (format === 'csv') {
        buffer = await workbook.csv.writeBuffer();
        mimeType = 'text/csv;charset=utf-8;';
      } else {
        buffer = await workbook.xlsx.writeBuffer();
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }

      const blob = new Blob([buffer], { type: mimeType });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

    } catch (err) {
      console.error("Failed to export detailed breakdown:", err);
      alert("Failed to export detailed breakdown");
    } finally {
      setExportingDetailed(false);
    }
  };


  const handleExport = async (format: 'excel' | 'csv' = 'excel') => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Report');
    let fileName = `WRL_MIS_Report_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;

    const getRegionColor = (region: string) => {
      const r = (region || '').toUpperCase();
      if (r.includes('NORTH')) return 'FFC6E0B4';
      if (r.includes('EAST')) return 'FFBDD7EE';
      if (r.includes('WEST')) return 'FFF8CBAD';
      if (r.includes('SOUTH')) return 'FFD9D9D9';
      return 'FFF1F5F9';
    };

    const applyHeaderStyle = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    };

    if (activeTab === 'register') {
      sheet.columns = [
        { header: 'ID', key: 'id', width: 15 },
        { header: 'Reference', key: 'ref', width: 15 },
        { header: 'Call Type', key: 'type', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Pincode', key: 'pincode', width: 12 },
        { header: 'Product', key: 'product', width: 20 },
        { header: 'Serial', key: 'serial', width: 15 },
        { header: 'Technician', key: 'tech', width: 20 },
        { header: 'Complaint', key: 'complaint', width: 40 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Solved Date', key: 'solvedDate', width: 12 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'Contact Person', key: 'contact', width: 20 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Address', key: 'address', width: 40 },
      ];

      applyHeaderStyle(sheet.getRow(1));

      let exportData = data;
      // For Call Register, if there's more than one page, fetch everything for export
      if (activeTab === 'register' && total > limit) {
        setExportingDetailed(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const headers = { 'Authorization': `Bearer ${session?.access_token}` };
          const params = new URLSearchParams({
            officeId: selectedOfficeIds.join(',') || 'All',
            callType: selectedCallTypes.join(',') || 'All',
            startDate: dateRange.start instanceof Date ? dateRange.start.toISOString().split('T')[0] : dateRange.start,
            endDate: dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : dateRange.end,
            limit: '20000', // Fetch a large batch for export
            page: '1'
          });
          if (search) params.append('search', search);
          if (debouncedPincodeSearch) params.append('pincode', debouncedPincodeSearch);

          const res = await axios.get(`/api/report?${params}`, { headers });
          exportData = res.data.data || [];
        } catch (err) {
          console.error("Full data fetch failed:", err);
          // Fallback to current page data
        } finally {
          setExportingDetailed(false);
        }
      }

      exportData.forEach(row => {
        const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
        const isAssigned = row.Status === 'Assigned' || row.callstatus === 'Assigned';
        const statusText = row.Status === 'UNKNOWN' ? 'PENDING' : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          id: row.UniqueCallNo,
          ref: row.callsntrnno,
          type: row.calltype,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          branch: row.officename || '—',
          pincode: row.Pincode || '—',
          product: row.itemname,
          serial: row.callsvserialno,
          tech: row.serviceman,
          complaint: row.vcomplaint,
          status: statusText,
          solvedDate: isSolved ? formatDate(row.callsolveddate) : '—',
          remarks: row.vsolveremarks || row.cancel_reason || '—',
          contact: row.vpersoncalling,
          phone: row.vinsttel1,
          address: row.vinstaddress
        });

        // Style status cell
        const statusCell = r.getCell('status');
        statusCell.font = { bold: true, color: { argb: isSolved ? 'FF059669' : isAssigned ? 'FF1D4ED8' : 'FF64748B' } };
        if (isSolved || isAssigned) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isSolved ? 'FFF8FAFC' : 'FFE8F0FE' } };
        }
      });

    } else if (activeTab === 'summary') {
      const regions = Array.from(new Set(summaryData.map(b => b.region))).sort();
      const topLevelBranches = summaryData.filter(b => b.parentId === 0 || !summaryData.find(p => p.officeId === b.parentId));

      const getAggregate = (item: any, key: string, regionBranches: any[]) => {
        const getAllChildren = (id: number): any[] => {
          let direct = regionBranches.filter(b => b.parentId === id);
          let all = [...direct];
          direct.forEach(d => { all = [...all, ...getAllChildren(d.officeId)]; });
          return all;
        };
        const allDescendants = getAllChildren(item.officeId);
        return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
      };

      // 1. Regional Performance
      sheet.addRow(['Regional Performance']).font = { bold: true, size: 12 };
      const regHeader = sheet.addRow(['Region', 'Total', 'Solved', 'Transferred', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(regHeader);

      regions.forEach(region => {
        const rb = summaryData.filter(b => b.region === region);
        const t = rb.reduce((acc, b) => ({
          t: acc.t + Number(b.total_calls || 0), s: acc.s + Number(b.solved_calls || 0), tr: acc.tr + Number(b.transferred_calls || 0), c: acc.c + Number(b.cancelled_calls || 0), o: acc.o + Number(b.open_calls || 0),
          a2: acc.a2 + Number(b.age_2 || 0), a3: acc.a3 + Number(b.age_3 || 0), a7: acc.a7 + Number(b.age_7 || 0), a15: acc.a15 + Number(b.age_15 || 0),
          p: acc.p + Number(b.part_pending || 0), e: acc.e + Number(b.active_eng || 0)
        }), { t: 0, s: 0, tr: 0, c: 0, o: 0, a2: 0, a3: 0, a7: 0, a15: 0, p: 0, e: 0 });

        const r = sheet.addRow([region, t.t, t.s, t.tr, t.c, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(3).font = { color: { argb: 'FF059669' } };
        r.getCell(4).font = { color: { argb: 'FF2563EB' } }; // Transferred Blue
        r.getCell(5).font = { color: { argb: 'FFDC2626' } };
        r.getCell(6).font = { bold: true };
      });

      // AI Total
      const aiRow = sheet.addRow([
        'AI TOTAL',
        summaryData.reduce((s, b) => s + Number(b.total_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.solved_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.transferred_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.cancelled_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.open_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_2 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_3 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_7 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.age_15 || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.part_pending || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.active_eng || 0), 0)
      ]);
      aiRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      sheet.addRow([]); // Gap

      // 2. Branch Wise Performance
      sheet.addRow(['Branch Wise Performance']).font = { bold: true, size: 12 };
      const brHeader = sheet.addRow(['Branch', 'Total', 'Solved', 'Transferred', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(brHeader);

      topLevelBranches
        .sort((a, b) => a.region.localeCompare(b.region))
        .forEach(b => {
          const rb = summaryData.filter(x => x.region === b.region);
          const r = sheet.addRow([
            b.branch,
            getAggregate(b, 'total_calls', rb),
            getAggregate(b, 'solved_calls', rb),
            getAggregate(b, 'transferred_calls', rb),
            getAggregate(b, 'cancelled_calls', rb),
            getAggregate(b, 'open_calls', rb),
            getAggregate(b, 'age_2', rb),
            getAggregate(b, 'age_3', rb),
            getAggregate(b, 'age_7', rb),
            getAggregate(b, 'age_15', rb),
            getAggregate(b, 'part_pending', rb),
            getAggregate(b, 'active_eng', rb)
          ]);
          r.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(b.region) } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          });
          r.getCell(3).font = { color: { argb: 'FF059669' } };
          r.getCell(4).font = { color: { argb: 'FF2563EB' } }; // Transferred Blue
          r.getCell(5).font = { color: { argb: 'FFDC2626' } };
          r.getCell(6).font = { bold: true };
        });

    } else {
      // Key Account MIS
      const filtered = accountsData.filter(a => {
        const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
        const matchAccount = filterAccount.length === 0 || filterAccount.includes(a.account);
        return matchRegion && matchAccount;
      }).sort((a, b) => a.region.localeCompare(b.region));

      const kaHeader = sheet.addRow(['Region', 'Account', 'Population', 'Total', 'Solved', 'Transferred', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(kaHeader);

      filtered.forEach(a => {
        const openCalls = Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0);
        const r = sheet.addRow([
          a.region, a.account, a.population || 0, a.total_calls, a.total_solved, a.transferred_calls || 0, a.cancelled_calls, openCalls,
          a.age_2, a.age_3, a.age_7, a.age_15, a.part_pending, a.active_eng
        ]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(a.region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(5).font = { color: { argb: 'FF059669' } };
        r.getCell(6).font = { color: { argb: 'FF2563EB' } }; // Transferred Blue
        r.getCell(7).font = { color: { argb: 'FFDC2626' } };
        r.getCell(8).font = { bold: true };
      });
    }

    let buffer;
    let mimeType;
    if (format === 'csv') {
      buffer = await workbook.csv.writeBuffer();
      mimeType = 'text/csv;charset=utf-8;';
    } else {
      buffer = await workbook.xlsx.writeBuffer();
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    const blob = new Blob([buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / limit);

  const localFilteredData = React.useMemo(() => {
    return data;
  }, [data]);

  const displayedData = localFilteredData;

  const liveStats = React.useMemo(() => {
    let total = localFilteredData.length;
    let solved = 0;
    let open = 0;
    let transferred = 0;
    let cancelled = 0;

    localFilteredData.forEach(row => {
      const isTransferred = (row.vtransfercallno && row.vtransfercallno !== '') || row.cancel_reason?.includes('Transfer');
      const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
      const isCancelled = (row.callstatus === 'Cancel' || row.Status === 'Cancel') && !isTransferred;

      if (isTransferred) transferred++;
      else if (isSolved) solved++;
      else if (isCancelled) cancelled++;
      else open++;
    });

    return { total, solved, open, transferred, cancelled };
  }, [localFilteredData]);


  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden text-slate-900 bg-white">
      {/* Page Header / Controls */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex">
            {[
              { id: 'register', label: 'Call Register' },
              { id: 'summary', label: 'Summary Dashboard' },
              { id: 'accounts', label: 'Key Account MIS' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 h-14 text-xs font-medium transition-all relative ${activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600' }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-[10px] text-slate-400 font-medium">
              Last Refreshed: {lastRefreshed?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => fetchDelta()}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-md text-xs hover:bg-slate-800 transition-all shadow-sm disabled:opacity-50 ui-label"
            title="Fast delta sync (fetches only new or updated calls since last sync)"
          >
            <div className={`${loading ? 'animate-spin' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
            </div>
            Sync
          </button>
          <button
            onClick={() => fetchData(1)}
            disabled={loading}
            className="flex items-center gap-1.5 bg-white text-slate-700 px-3 py-1.5 rounded-md text-xs border border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm disabled:opacity-50 ui-label"
            title="Full reload (re-runs all branch and account queries from scratch)"
          >
            <div className={`${loading ? 'animate-spin' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>
            </div>
            Full Reload
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 bg-white text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
          >
            <FileSpreadsheet size={14} className="text-emerald-600" />
            Excel Export
          </button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          {/* Call Type Filter */}
          <div className="relative">
            <button
              onClick={() => {
                if (!showCallTypeDropdown) {
                  setTempSelectedCallTypes(selectedCallTypes);
                }
                setShowCallTypeDropdown(!showCallTypeDropdown);
              }}
              className="min-w-[140px] max-w-[200px] bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all shadow-sm ui-label"
            >
              <span className="truncate">
                {selectedCallTypes.length === 0 ? 'All Call Types' : `${selectedCallTypes.length} Types Selected`}
              </span>
              <ChevronDown size={14} className={`transition-transform duration-200 ${showCallTypeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showCallTypeDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowCallTypeDropdown(false)}
                />
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 ui-label">Select Call Type</span>
                    <button
                      onClick={() => setTempSelectedCallTypes([])}
                      className="text-[10px] text-slate-400 hover:text-slate-900 px-2 py-1 rounded hover:bg-white ui-label"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1 custom-scrollbar">
                    {callTypes.map(type => {
                      const isSelected = tempSelectedCallTypes.includes(type);
                      return (
                        <label key={type} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTempSelectedCallTypes(prev => [...prev, type]);
                              } else {
                                setTempSelectedCallTypes(prev => prev.filter(t => t !== type));
                              }
                            }}
                          />
                          <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
                            {type}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="p-2 border-t border-slate-100 bg-slate-50 flex justify-end">
                    <button
                      onClick={() => {
                        setSelectedCallTypes(tempSelectedCallTypes);
                        setShowCallTypeDropdown(false);
                      }}
                      className="bg-slate-900 text-white px-4 py-1 rounded text-[10px] hover:bg-slate-800 transition-colors ui-label"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              className="h-[30px] bg-white border border-slate-200 rounded-md px-3 py-1 text-xs text-slate-700 outline-none cursor-pointer hover:border-slate-400 transition-all shadow-sm ui-label"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="All">All Statuses</option>
              <option value="Open Unallocated">Open Unallocated</option>
              <option value="Assigned">Assigned</option>
              <option value="Tech. Solve Call">Tech. Solve Call</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          {/* Branch Filter */}
          {activeTab !== 'register' && (
            <div className="relative">
              <button
                onClick={() => {
                  if (!showOfficeDropdown) {
                    setTempSelectedOfficeIds(selectedOfficeIds);
                  }
                  setShowOfficeDropdown(!showOfficeDropdown);
                }}
                className="min-w-[140px] max-w-[200px] bg-white border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all shadow-sm ui-label"
              >
                <span className="truncate">
                  {selectedOfficeIds.length === 0 ? 'All Branches' : `${selectedOfficeIds.length} Selected`}
                </span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${showOfficeDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showOfficeDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOfficeDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 shadow-xl rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 ui-label">Select Branches</span>
                      <button
                        onClick={() => { setTempSelectedOfficeIds([]); setOfficeSearch(''); }}
                        className="text-[10px] text-slate-400 hover:text-slate-900 px-2 py-1 rounded hover:bg-white ui-label"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="p-2 border-b border-slate-100">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search branches..."
                          className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                          value={officeSearch}
                          onChange={(e) => setOfficeSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1 custom-scrollbar">
                      {officeSearch ? (
                        offices.filter(o => o.vcompanyname.toLowerCase().includes(officeSearch.toLowerCase())).map(o => {
                          const isSelected = tempSelectedOfficeIds.includes(String(o.ncode));
                          return (
                            <label key={o.ncode} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                checked={isSelected}
                                onChange={(e) => {
                                  const val = String(o.ncode);
                                  if (e.target.checked) {
                                    setTempSelectedOfficeIds(prev => Array.from(new Set([...prev, val])));
                                  } else {
                                    setTempSelectedOfficeIds(prev => prev.filter(id => id !== val));
                                  }
                                }}
                              />
                              <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
                                {o.vcompanyname}
                              </span>
                            </label>
                          );
                        })
                      ) : ((() => {
                        const buildTree = (parentId: string | null = '0', level = 0): React.ReactNode[] => {
                          return offices
                            .filter(o => String(o.nunder || '0') === String(parentId || '0'))
                            .map(o => {
                              const isSelected = tempSelectedOfficeIds.includes(String(o.ncode));
                              return [
                                <label key={o.ncode} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                                  <div style={{ width: `${level * 12}px` }} />
                                  <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      const val = String(o.ncode);
                                      if (e.target.checked) {
                                        // Add this and all descendants
                                        const getAllChildren = (id: string): string[] => {
                                          const children = offices.filter(c => String(c.nunder) === String(id));
                                          let ids = [id];
                                          children.forEach(c => {
                                            ids = [...ids, ...getAllChildren(String(c.ncode))];
                                          });
                                          return ids;
                                        };
                                        const allToAdd = getAllChildren(val);
                                        setTempSelectedOfficeIds(prev => Array.from(new Set([...prev, ...allToAdd])));
                                      } else {
                                        // Remove this and all descendants
                                        const getAllChildren = (id: string): string[] => {
                                          const children = offices.filter(c => String(c.nunder) === String(id));
                                          let ids = [id];
                                          children.forEach(c => {
                                            ids = [...ids, ...getAllChildren(String(c.ncode))];
                                          });
                                          return ids;
                                        };
                                        const allToRemove = getAllChildren(val);
                                        setTempSelectedOfficeIds(prev => prev.filter(id => !allToRemove.includes(id)));
                                      }
                                    }}
                                  />
                                  <span className={`text-[11px] font-medium ${isSelected ? 'text-slate-900 font-bold' : 'text-slate-600'} group-hover:text-slate-900`}>
                                    {o.vcompanyname}
                                  </span>
                                </label>,
                                ...buildTree(o.ncode, level + 1)
                              ];
                            }).flat();
                        };
                        return buildTree('0', 0);
                      })())}
                    </div>
                    <div className="p-2 border-t border-slate-100 bg-slate-50 flex justify-end">
                      <button
                        onClick={() => {
                          setSelectedOfficeIds(tempSelectedOfficeIds);
                          setShowOfficeDropdown(false);
                        }}
                        className="bg-slate-900 text-white px-4 py-1 rounded text-[10px] hover:bg-slate-800 transition-colors ui-label"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center border-l border-slate-200 pl-4 h-6">
            <DateRangeSelector
              value={dateRange.label}
              onChange={(range) => {
                setDateRange(range);
              }}
            />
          </div>

          {/* Aging As Of — only relevant on Summary/Accounts tabs */}
          {(activeTab === 'summary' || activeTab === 'accounts') && (
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4 h-6">
              <span className="text-[10px] text-amber-600 whitespace-nowrap ui-label">Aging As Of</span>
              <input
                type="date"
                className="bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-xs text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-400 shadow-sm ui-label"
                value={agingAsOf}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setAgingAsOf(e.target.value)}
              />
            </div>
          )}

          {activeTab === 'register' && registerSummary && (
            <div className="flex items-center gap-4 border-l border-slate-200 pl-4 h-6">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-slate-400 ui-strong">Total</span>
                <span className="text-[13px] text-slate-900 ui-label">
                  {liveStats.total < (registerSummary.total || 0) ? (
                    <span>{liveStats.total.toLocaleString()}<span className="text-[10px] text-slate-400 font-normal">/{(registerSummary.total || 0).toLocaleString()}</span></span>
                  ) : (
                    (registerSummary.total || 0).toLocaleString()
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-emerald-500 ui-strong">Solved</span>
                <span className="text-[13px] text-emerald-600 ui-label">
                  {liveStats.total < (registerSummary.total || 0) ? (
                    <span>{liveStats.solved.toLocaleString()}<span className="text-[10px] text-emerald-400 font-normal">/{(registerSummary.solved || 0).toLocaleString()}</span></span>
                  ) : (
                    (registerSummary.solved || 0).toLocaleString()
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-blue-500 ui-strong">Open</span>
                <span className="text-[13px] text-blue-600 ui-label">
                  {liveStats.total < (registerSummary.total || 0) ? (
                    <span>{liveStats.open.toLocaleString()}<span className="text-[10px] text-blue-400 font-normal">/{(registerSummary.open || 0).toLocaleString()}</span></span>
                  ) : (
                    (registerSummary.open || 0).toLocaleString()
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-slate-400 ui-strong">Trf</span>
                <span className="text-[13px] text-slate-600 ui-label">
                  {liveStats.total < (registerSummary.total || 0) ? (
                    <span>{liveStats.transferred.toLocaleString()}<span className="text-[10px] text-slate-400 font-normal">/{(registerSummary.transferred || 0).toLocaleString()}</span></span>
                  ) : (
                    (registerSummary.transferred || 0).toLocaleString()
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-rose-500 ui-strong">Can</span>
                <span className="text-[13px] text-rose-600 ui-label">
                  {liveStats.total < (registerSummary.total || 0) ? (
                    <span>{liveStats.cancelled.toLocaleString()}<span className="text-[10px] text-rose-400 font-normal">/{(registerSummary.cancelled || 0).toLocaleString()}</span></span>
                  ) : (
                    (registerSummary.cancelled || 0).toLocaleString()
                  )}
                </span>
              </div>
            </div>
          )}

          {activeTab === 'register' && (
            <div className="flex-1 flex items-center gap-3 border-l border-slate-200 pl-4 h-6">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter records..."
                  className="w-full pl-8 pr-4 py-1.5 bg-slate-50 border-none rounded-md text-[11px] font-medium focus:ring-1 focus:ring-slate-200 transition-all"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
                />
              </div>
              <div className="relative flex-1 max-w-[150px]">
                <MapPin className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Pincode..."
                  className="w-full pl-8 pr-4 py-1.5 bg-slate-50 border-none rounded-md text-[11px] font-medium focus:ring-1 focus:ring-slate-200 transition-all font-mono"
                  value={pincodeSearch}
                  onChange={(e) => setPincodeSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cascading Geographic & Assignment Filter Panel */}
      {activeTab === 'register' && (() => {
        const isAnyFilterActive = selectedState !== 'All' || 
                                  selectedCity !== 'All' || 
                                  selectedBranch !== 'All' || 
                                  selectedFranchisee !== 'All' || 
                                  selectedTechnician !== 'All' || 
                                  search !== '' || 
                                  pincodeSearch !== '' ||
                                  selectedCallTypes.length > 0 ||
                                  selectedStatus !== 'All';

        return (
          <div className="bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center gap-4 text-xs shadow-[inset_0_-2px_4px_rgba(0,0,0,0.015)]">
            {/* 1. State Selector */}
            <div className={`group flex items-center gap-3 px-3 py-1.5 bg-white border rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 min-w-[160px] max-w-[200px] flex-1 ${
              selectedState !== 'All' 
                ? 'border-blue-200 bg-blue-50/20' 
                : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className={`p-1.5 rounded-lg transition-colors ${selectedState !== 'All' ? 'bg-blue-100 text-blue-600' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
                {/* Map/Globe Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mb-0.5 select-none text-[8.5px]">State</span>
                <div className="relative flex items-center pr-3">
                  <select
                    value={selectedState}
                    onChange={(e) => handleStateChange(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11.5px] text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer w-full select-none appearance-none"
                  >
                    <option value="All">All States ({statesList.reduce((acc, curr) => acc + curr.call_count, 0)})</option>
                    {statesList.map(s => (
                      <option key={s.vname} value={s.vname}>
                        {s.vname} ({s.call_count})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. City Selector */}
            <div className={`group flex items-center gap-3 px-3 py-1.5 bg-white border rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all focus-within:ring-2 focus-within:ring-teal-100 focus-within:border-teal-400 min-w-[170px] max-w-[210px] flex-1 ${
              selectedCity !== 'All' 
                ? 'border-teal-200 bg-teal-50/20' 
                : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className={`p-1.5 rounded-lg transition-colors ${selectedCity !== 'All' ? 'bg-teal-100 text-teal-600' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
                {/* MapPin Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mb-0.5 select-none text-[8.5px]">City</span>
                <div className="relative flex items-center pr-3">
                  <select
                    value={selectedCity}
                    onChange={(e) => handleCityChange(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11.5px] text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer w-full select-none appearance-none"
                  >
                    <option value="All">All Cities ({citiesList.reduce((acc, curr) => acc + curr.call_count, 0)})</option>
                    {citiesList.map(c => (
                      <option key={c.ncode} value={c.ncode}>
                        {c.vname} ({c.call_count})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Branch Selector */}
            <div className={`group flex items-center gap-3 px-3 py-1.5 bg-white border rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all focus-within:ring-2 focus-within:ring-violet-100 focus-within:border-violet-400 min-w-[200px] max-w-[260px] flex-1 ${
              selectedBranch !== 'All' 
                ? 'border-violet-200 bg-violet-50/20' 
                : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className={`p-1.5 rounded-lg transition-colors ${selectedBranch !== 'All' ? 'bg-violet-100 text-violet-600' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
                {/* Building2 Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="22" width="18" height="2" /><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="9" y1="22" x2="9" y2="16" /><line x1="15" y1="22" x2="15" y2="16" /><path d="M9 16h6" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M8 10h.01" /><path d="M16 10h.01" /></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mb-0.5 select-none text-[8.5px]">Branch</span>
                <div className="relative flex items-center pr-3">
                  <select
                    value={selectedBranch}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11.5px] text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer w-full select-none appearance-none"
                  >
                    <option value="All">All Branches ({branchesList.reduce((acc, curr) => acc + curr.call_count, 0)})</option>
                    {branchesList.map(b => (
                      <option key={b.ncode} value={b.ncode}>
                        {b.vcompanyname} ({b.call_count})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Franchisee Selector */}
            <div className={`group flex items-center gap-3 px-3 py-1.5 bg-white border rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all focus-within:ring-2 focus-within:ring-amber-100 focus-within:border-amber-400 min-w-[200px] max-w-[260px] flex-1 ${
              selectedFranchisee !== 'All' 
                ? 'border-amber-200 bg-amber-50/20' 
                : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className={`p-1.5 rounded-lg transition-colors ${selectedFranchisee !== 'All' ? 'bg-amber-100 text-amber-600' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
                {/* Users Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mb-0.5 select-none text-[8.5px]">Franchisee</span>
                <div className="relative flex items-center pr-3">
                  <select
                    value={selectedFranchisee}
                    onChange={(e) => handleFranchiseeChange(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11.5px] text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer w-full select-none appearance-none"
                  >
                    <option value="All">All Franchisees ({franchiseesList.reduce((acc, curr) => acc + curr.call_count, 0)})</option>
                    {franchiseesList.map(f => (
                      <option key={f.ncode} value={f.ncode}>
                        {f.vcompanyname} ({f.call_count})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Technician Selector */}
            <div className={`group flex items-center gap-3 px-3 py-1.5 bg-white border rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all focus-within:ring-2 focus-within:ring-emerald-100 focus-within:border-emerald-400 min-w-[200px] max-w-[260px] flex-1 ${
              selectedTechnician !== 'All' 
                ? 'border-emerald-200 bg-emerald-50/20' 
                : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className={`p-1.5 rounded-lg transition-colors ${selectedTechnician !== 'All' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-500'}`}>
                {/* Wrench Icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider leading-none mb-0.5 select-none text-[8.5px]">Technician</span>
                <div className="relative flex items-center pr-3">
                  <select
                    value={selectedTechnician}
                    onChange={(e) => setSelectedTechnician(e.target.value)}
                    className="bg-transparent border-none p-0 text-[11.5px] text-slate-700 font-bold focus:outline-none focus:ring-0 cursor-pointer w-full select-none appearance-none"
                  >
                    <option value="All">All Technicians ({techniciansList.reduce((acc, curr) => acc + curr.call_count, 0)})</option>
                    {techniciansList.map(t => (
                      <option key={t.ncode} value={t.ncode}>
                        {t.vname} ({t.call_count})
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* 6. Clear Filters Button */}
            <button
              onClick={() => {
                setSelectedState('All');
                setSelectedCity('All');
                setSelectedBranch('All');
                setSelectedFranchisee('All');
                setSelectedTechnician('All');
                setSearch('');
                setPincodeSearch('');
                setSelectedCallTypes([]);
                setSelectedStatus('All');
              }}
              disabled={!isAnyFilterActive}
              className={`ml-auto flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[11px] font-extrabold transition-all shadow-[0_1px_2px_rgba(0,0,0,0.02)] active:scale-95 ${
                isAnyFilterActive 
                  ? 'bg-rose-500 text-white hover:bg-rose-600 hover:shadow-[0_4px_12px_rgba(244,63,94,0.2)] cursor-pointer' 
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
              }`}
              title="Reset all search queries, status selectors and cascading options instantly"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              <span>Clear Filters</span>
            </button>
          </div>
        );
      })()}

      {/* Main Area */}
      <div className="flex-1 overflow-hidden bg-white relative flex flex-col">
        {loading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-100 overflow-hidden z-50">
            <div className="h-full bg-slate-900 animate-[loading_1.5s_infinite_linear] w-[30%] rounded-r" />
          </div>
        )}
        <style jsx global>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(333%); }
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 0px;
            height: 0px;
            display: none;
          }
          .custom-scrollbar {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .inner-scrollbar::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .inner-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .inner-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 10px;
          }
          .inner-scrollbar:hover::-webkit-scrollbar-thumb {
            background: #94a3b8;
          }
        `}</style>

        {activeTab === 'register' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto inner-scrollbar">
              <table className="w-full text-left border-collapse min-w-[2400px]">
              <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-medium text-slate-500 w-12 text-center border-r border-slate-100">#</th>
                  {[
                    { key: 'UniqueCallNo', label: 'ID' },
                    { key: 'callsntrnno', label: 'Reference' },
                    { key: 'calltype', label: 'Call Type' },
                    { key: 'callsdtrndate', label: 'Date' },
                    { key: 'PartyName', label: 'Customer' },
                    { key: 'officename', label: 'Branch' },
                    { key: 'Pincode', label: 'Pincode' },
                    { key: 'itemname', label: 'Product' },
                    { key: 'callsvserialno', label: 'Serial' },
                    { key: 'serviceman', label: 'Technician' },
                    { key: 'vcomplaint', label: 'Complaint' },
                    { key: 'Status', label: 'Status' },
                    { key: 'callsolveddate', label: 'Solved' },
                    { key: 'vsolveremarks', label: 'Remarks' },
                    { key: 'vpersoncalling', label: 'Contact Person' },
                    { key: 'vinsttel1', label: 'Phone' },
                    { key: 'vinstaddress', label: 'Address' }
                  ].map(col => (
                    <th key={col.key} className="px-4 py-2.5 text-[11px] font-medium text-slate-500 border-r border-slate-100 whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedData.length > 0 ? displayedData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-2 text-[11px] text-slate-400 border-r border-slate-50 text-center">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 text-[11px] font-mono text-slate-400 border-r border-slate-50">
                      <button onClick={() => handleSelectCall(String(row.id), row)} className="text-slate-700 hover:text-slate-900 underline text-[11px] font-mono">
                        {row.UniqueCallNo}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-[11px] font-medium text-slate-900 border-r border-slate-50 whitespace-nowrap">
                      <button onClick={() => handleSelectCall(String(row.id), row)} className="text-slate-900 hover:text-slate-700 underline">
                        {row.callsntrnno}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] text-slate-600 border border-slate-200 ui-strong">
                        {row.calltype || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap">
                      {formatDate(row.callsdtrndate)}
                    </td>
                    <td className="px-4 py-2 text-[11px] font-medium text-slate-800 border-r border-slate-50 max-w-[250px] truncate" title={row.PartyName}>{row.PartyName}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 border-r border-slate-50">{row.officename}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 border-r border-slate-50 font-mono">{row.Pincode || '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 border-r border-slate-50 whitespace-nowrap">{row.itemname}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-slate-500 border-r border-slate-50 whitespace-nowrap">{row.callsvserialno}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-900 border-r border-slate-50 whitespace-nowrap">{row.serviceman}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 max-w-[200px] truncate" title={row.vcomplaint}>{row.vcomplaint}</td>
                    <td className="px-4 py-2 border-r border-slate-50 whitespace-nowrap">
                      {(() => {
                        const isTransferred = (row.vtransfercallno && row.vtransfercallno !== '') || row.cancel_reason?.includes('Transfer');
                        const isSolved = row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True';
                        const isRejected = isSolved && (row.bmreject === 'Yes' || String(row.rejectionstatus) === '1' || String(row.rejectionstatus) === '2');
                        const isCancelled = (row.callstatus === 'Cancel' || row.Status === 'Cancel') && !isTransferred;
                        const isTechSolved = (row.bfastclose === 'True' || row.bfastclose === '1') && !isSolved && !isCancelled && !isTransferred;
                        const isAssigned = (row.nengineer && String(row.nengineer) !== '0') && !isSolved && !isCancelled && !isTransferred && !isTechSolved;

                        if (isTransferred) return <span className="badge-transferred">Transferred</span>;
                        if (isRejected) return <span className="badge-cancelled">Closed - Rejected</span>;
                        if (isSolved) return <span className="badge-solved">Solved</span>;
                        if (isCancelled) return <span className="badge-cancelled">Cancelled</span>;
                        if (isTechSolved) return <span className="badge-transferred">Tech. Solved</span>;
                        if (isAssigned) return <span className="badge-assigned">Assigned</span>;
                        return <span className="badge-open">Open</span>;
                      })()}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 whitespace-nowrap">
                      {formatDate(row.callsolveddate)}
                    </td>
                    <td className="px-4 py-2 text-[11px] border-r border-slate-50 max-w-[300px]" title={row.vcomment || row.vsolveremarks || row.cancel_reason}>
                      {(() => {
                        const rejectionRemark = row.vcomment || null;
                        const solveRemark = row.vsolveremarks || row.cancel_reason || null;
                        if (rejectionRemark) {
                          return (
                            <span className="text-rose-600 font-medium truncate block" title={rejectionRemark}>
                              ⚑ {rejectionRemark}
                            </span>
                          );
                        }
                        return <span className="text-slate-400 truncate block">{solveRemark || '—'}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-600 border-r border-slate-50 whitespace-nowrap">{row.vpersoncalling}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-900 border-r border-slate-50 whitespace-nowrap">{row.vinsttel1}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500 border-r border-slate-50 max-w-[400px] truncate">{row.vinstaddress}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={17} className="px-6 py-20 text-center">
                      <p className="text-xs font-medium text-slate-400">No matching records found</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination Controls */}
          <div className="h-16 flex-shrink-0 flex items-center justify-between px-6 bg-slate-50 border-t border-slate-200">
            <span className="text-xs text-slate-500 font-medium">
              Showing {data.length > 0 ? (page - 1) * limit + 1 : 0} to {Math.min(page * limit, total)} of {total.toLocaleString()} entries
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const newPage = Math.max(1, page - 1);
                  setPage(newPage);
                  fetchData(newPage);
                }}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium text-slate-700 mx-2 flex items-center gap-1.5">
                Page {page} of {Math.max(1, Math.ceil(total / limit))}
                {loading && (
                  <span className="inline-block w-3 h-3 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
                )}
              </span>
              <button
                onClick={() => {
                  const totalPages = Math.max(1, Math.ceil(total / limit));
                  const newPage = Math.min(totalPages, page + 1);
                  setPage(newPage);
                  fetchData(newPage);
                }}
                disabled={page >= Math.ceil(total / limit) || loading}
                className="p-1.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
        ) : activeTab === 'summary' ? (
          <div className="flex-1 overflow-y-auto inner-scrollbar p-6 space-y-8">
              {/* Region Summary Table */}
              <section className="mb-8">
                <h2 className="text-[11px] text-slate-500 mb-2 px-2 ui-label">Regional Performance (AI)</h2>
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0070c0] text-white text-[10px] ui-label">
                        <th className="p-2 border border-slate-300">Region</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center text-blue-200">Transferred</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'<2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>3 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        const totals = regionBranches.reduce((acc, b) => ({
                          total: acc.total + Number(b.total_calls || 0),
                          solved: acc.solved + Number(b.solved_calls || 0),
                          cancelled: acc.cancelled + Number(b.cancelled_calls || 0),
                          transferred: acc.transferred + Number(b.transferred_calls || 0),
                          open: acc.open + Number(b.open_calls || 0),
                          age2: acc.age2 + Number(b.age_2 || 0),
                          age3: acc.age3 + Number(b.age_3 || 0),
                          age7: acc.age7 + Number(b.age_7 || 0),
                          age15: acc.age15 + Number(b.age_15 || 0),
                          parts: acc.parts + Number(b.part_pending || 0),
                          engs: acc.engs + Number(b.active_eng || 0)
                        }), { total: 0, solved: 0, cancelled: 0, transferred: 0, open: 0, age2: 0, age3: 0, age7: 0, age15: 0, parts: 0, engs: 0 });

                        const getRegionBg = (reg: string) => {
                          const r = reg.toUpperCase();
                          if (r.includes('NORTH')) return 'bg-[#c6e0b4]';
                          if (r.includes('EAST')) return 'bg-[#bdd7ee]';
                          if (r.includes('WEST')) return 'bg-[#f8cbad]';
                          if (r.includes('SOUTH')) return 'bg-[#d9d9d9]';
                          return 'bg-slate-100';
                        };

                        return (
                          <tr key={region} className={`${getRegionBg(region)} text-slate-900 ui-strong`}>
                            <td className="p-2 border border-slate-300">{region}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${region} - Total Calls`, { region })}>{totals.total}</td>
                            <td className="p-2 border border-slate-300 text-center text-emerald-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${region} - Solved Calls`, { region })}>{totals.solved}</td>
                            <td className="p-2 border border-slate-300 text-center text-blue-600 cursor-pointer hover:bg-black/5 font-semibold" onClick={() => handleDrillDown('transferred_calls', `${region} - Transferred Calls`, { region })}>{totals.transferred}</td>
                            <td className="p-2 border border-slate-300 text-center text-rose-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('cancelled_calls', `${region} - Cancelled Calls`, { region })}>{totals.cancelled}</td>
                            <td className="p-2 border border-slate-300 text-center bg-slate-100/50 cursor-pointer hover:bg-black/5 ui-strong" onClick={() => handleDrillDown('open_calls', `${region} - Open Calls`, { region })}>{totals.open}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${region} - <2 Days`, { region })}>{totals.age2}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${region} - 2-7 Days`, { region })}>{totals.age3}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${region} - 7-15 Days`, { region })}>{totals.age7}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${region} - >15 Days`, { region })}>{totals.age15}</td>
                            <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${region} - Part Pending`, { region })}>{totals.parts}</td>
                            <td className="p-2 border border-slate-300 text-center">{totals.engs}</td>
                          </tr>
                        );
                      })}
                      {/* All India Total Row */}
                      <tr className="bg-[#ffff00] text-slate-900 group ui-strong">
                        <td className="p-2 border border-slate-300 flex items-center justify-between">
                          <span>AI</span>
                          <button
                            onClick={() => handleDrillDown('discrepancy', 'AI - Discrepancy Records', { region: 'AI' })}
                            className="p-1 hover:bg-black/10 rounded transition-colors"
                            title="View records handled by multiple branches"
                          >
                            <AlertCircle className="w-3 h-3 text-slate-700" />
                          </button>
                        </td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.total_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center text-blue-700">{summaryData.reduce((sum, b) => sum + Number(b.transferred_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center bg-slate-800/20">{summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)}</td>
                        <td className="p-2 border border-slate-300 text-center">{summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Branch Summary Table */}
              <section>
                <h2 className="text-[11px] text-slate-500 mb-2 px-2 ui-label">Branch Wise Performance</h2>
                <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0070c0] text-white text-[10px] ui-label">
                        <th className="p-2 border border-slate-300 min-w-[200px]">Branches</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center text-blue-200">Transferred</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'<2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>3 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        if (regionBranches.length === 0) return null;

                        const topLevel = regionBranches.filter(b =>
                          b.parentId === 0 || !regionBranches.find(p => p.officeId === b.parentId)
                        ).sort((a, b) => Number(b.total_calls) - Number(a.total_calls));

                        const getRegionBg = (reg: string) => {
                          const r = reg.toUpperCase();
                          if (r.includes('NORTH')) return 'bg-[#c6e0b4]';
                          if (r.includes('EAST')) return 'bg-[#bdd7ee]';
                          if (r.includes('WEST')) return 'bg-[#f8cbad]';
                          if (r.includes('SOUTH')) return 'bg-[#d9d9d9]';
                          return 'bg-slate-100';
                        };

                        const bgClass = getRegionBg(region);

                        return (
                          <React.Fragment key={region}>
                            {topLevel.map(branch => {
                              const children = regionBranches.filter(b => b.parentId === branch.officeId);
                              const hasChildren = children.length > 0;
                              const isExpanded = expandedBranches[branch.officeId];

                              const getAggregate = (item: any, key: string) => {
                                const getAllChildren = (id: number): any[] => {
                                  let direct = regionBranches.filter(b => b.parentId === id);
                                  let all = [...direct];
                                  direct.forEach(d => {
                                    all = [...all, ...getAllChildren(d.officeId)];
                                  });
                                  return all;
                                };
                                const allDescendants = getAllChildren(item.officeId);
                                return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
                              };

                              return (
                                <React.Fragment key={branch.officeId}>
                                  <tr className={`${bgClass} hover:brightness-95 transition-all font-medium text-slate-900`}>
                                    <td className="p-2 border border-slate-300">
                                      <div className="flex items-center gap-1">
                                        {hasChildren ? (
                                          <button
                                            onClick={() => setExpandedBranches(prev => ({ ...prev, [branch.officeId]: !prev[branch.officeId] }))}
                                            className="p-0.5 hover:bg-white/50 rounded transition-all text-slate-700"
                                          >
                                            {isExpanded ? <ChevronDown size={12} strokeWidth={3} /> : <ChevronRight size={12} strokeWidth={3} />}
                                          </button>
                                        ) : (
                                          <div className="w-4" />
                                        )}
                                        <span className="truncate">{branch.branch}</span>
                                      </div>
                                    </td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${branch.branch} - Total Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'total_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${branch.branch} - Solved Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'solved_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5 text-blue-600" onClick={() => handleDrillDown('transferred_calls', `${branch.branch} - Transferred Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'transferred_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5 text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${branch.branch} - Cancelled Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'cancelled_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5 ui-strong" onClick={() => handleDrillDown('open_calls', `${branch.branch} - Open Calls`, { officeId: branch.officeId })}>{getAggregate(branch, 'open_calls')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${branch.branch} - <2 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_2')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${branch.branch} - 2-7 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_3')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${branch.branch} - 7-15 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_7')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${branch.branch} - >15 Days`, { officeId: branch.officeId })}>{getAggregate(branch, 'age_15')}</td>
                                    <td className="p-2 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${branch.branch} - Part Pending`, { officeId: branch.officeId })}>{getAggregate(branch, 'part_pending')}</td>
                                    <td className="p-2 border border-slate-300 text-center">
                                      <div className="flex flex-col items-center justify-center leading-tight">
                                        <span className="text-blue-700 ui-strong">{getAggregate(branch, 'active_eng')}</span>
                                        <span className="text-[9px] text-slate-400 font-medium">of {getAggregate(branch, 'headcount')}</span>
                                      </div>
                                    </td>
                                  </tr>

                                  {isExpanded && children.map(child => (
                                    <tr key={child.officeId} className="bg-white/60 hover:bg-white transition-colors text-slate-600 italic">
                                      <td className="p-1.5 pl-8 border border-slate-300">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{child.branch}</span>
                                        </div>
                                      </td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${child.branch} - Total Calls`, { officeId: child.officeId })}>{child.total_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('solved_calls', `${child.branch} - Solved Calls`, { officeId: child.officeId })}>{child.solved_calls}</td>
                                      
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5 text-blue-600" onClick={() => handleDrillDown('transferred_calls', `${child.branch} - Transferred Calls`, { officeId: child.officeId })}>{child.transferred_calls || 0}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5 text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${child.branch} - Cancelled Calls`, { officeId: child.officeId })}>{child.cancelled_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5 ui-label" onClick={() => handleDrillDown('open_calls', `${child.branch} - Open Calls`, { officeId: child.officeId })}>{child.open_calls}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${child.branch} - <2 Days`, { officeId: child.officeId })}>{child.age_2}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${child.branch} - 2-7 Days`, { officeId: child.officeId })}>{child.age_3}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${child.branch} - 7-15 Days`, { officeId: child.officeId })}>{child.age_7}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${child.branch} - >15 Days`, { officeId: child.officeId })}>{child.age_15}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px] cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${child.branch} - Part Pending`, { officeId: child.officeId })}>{child.part_pending}</td>
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">
                                        <span className="text-blue-600 ui-strong">{child.active_eng}</span>
                                        <span className="text-slate-400 ml-1">/ {child.headcount}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto inner-scrollbar p-6 space-y-4">
              {(() => {
                const filteredAccounts = accountsData.filter(a => {
                  const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
                  const matchAccount = filterAccount.length === 0 || filterAccount.includes(a.account);
                  return matchRegion && matchAccount;
                });

                return (
                  <>
                    <div className="flex items-center justify-between px-2 mb-2">
                      <h2 className="text-[11px] text-slate-500 ui-label">Key Account Wise Performance</h2>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead>
                          {/* Category Headers */}
                          <tr className="bg-slate-800 text-white ui-strong">
                            <th className="p-1.5 border border-slate-600" colSpan={3}>Basics</th>
                            <th className="p-1.5 border border-slate-600 text-center" colSpan={5}>Calls Summary (Breakdown)</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-blue-600" colSpan={7}>Breakdown (Aging)</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-amber-600" colSpan={3}>Deployment</th>
                            <th className="p-1.5 border border-slate-600 text-center bg-emerald-600" colSpan={2}>Installation</th>
                          </tr>
                          <tr className="bg-slate-100 text-slate-700 ui-strong">
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1 relative">
                                <span>Region</span>
                                <button
                                  onClick={() => {
                                    if (!showRegionDropdown) {
                                      setTempFilterRegion(filterRegion);
                                    }
                                    setShowRegionDropdown(!showRegionDropdown);
                                  }}
                                  className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong"
                                >
                                  <span className="truncate">
                                    {filterRegion.length === 0 ? 'All' : `${filterRegion.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showRegionDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowRegionDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                      <div className="p-1 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterRegion([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterRegion(tempFilterRegion);
                                            setShowRegionDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(accountsData.map(a => a.region))).sort().map(r => (
                                          <label key={r} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterRegion.includes(r)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterRegion([...tempFilterRegion, r]);
                                                } else {
                                                  setTempFilterRegion(tempFilterRegion.filter(x => x !== r));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{r}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            <th className="p-1.5 border border-slate-300">
                              <div className="flex flex-col gap-1 relative">
                                <span>Key Account</span>
                                <button
                                  onClick={() => {
                                    if (!showAccountDropdown) {
                                      setTempFilterAccount(filterAccount);
                                    }
                                    setShowAccountDropdown(!showAccountDropdown);
                                  }}
                                  className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong font-medium"
                                >
                                  <span className="truncate">
                                    {filterAccount.length === 0 ? 'All' : `${filterAccount.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showAccountDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowAccountDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100 font-medium">
                                      <div className="p-1 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterAccount([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterAccount(tempFilterAccount);
                                            setShowAccountDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(accountsData.map(a => a.account))).sort().map(acc => (
                                          <label key={acc} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterAccount.includes(acc)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterAccount([...tempFilterAccount, acc]);
                                                } else {
                                                  setTempFilterAccount(tempFilterAccount.filter(x => x !== acc));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{acc}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Population</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total calls</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3">Total solved</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3 text-blue-700 font-semibold">Transferred</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3 text-rose-700 font-semibold">Cancelled</th>
                            <th className="p-1.5 border border-slate-300 text-center align-bottom pb-3"># open calls</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">&lt;2 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">2-7 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">7-15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">&gt;15 Days</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">% &gt;7 Days</th>

                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong">Part pending</th>
                            <th className="p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong"># of active Eng.</th>

                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Total</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-amber-700 ui-strong">Pending</th>

                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong">Done</th>
                            <th className="p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong">Pending</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredAccounts.map((a, i) => {
                            const open_calls_sum = Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0);
                            const perc_gt_7 = open_calls_sum > 0 ? (((Number(a.age_7 || 0) + Number(a.age_15 || 0)) / open_calls_sum) * 100).toFixed(0) + '%' : '0%';
                            const dep_pending = Number(a.deployment_total || 0) - Number(a.deployment_done || 0);
                            const inst_pending = Number(a.installation_total || 0) - Number(a.installation_done || 0);

                            // Dynamic colors for regions
                            const regColor = a.region === 'NORTH' ? 'bg-green-50 text-green-700' :
                              a.region === 'EAST' ? 'bg-blue-50 text-blue-700' :
                                a.region === 'WEST' ? 'bg-amber-50 text-amber-700' :
                                  a.region === 'SOUTH' ? 'bg-purple-50 text-purple-700' : 'bg-slate-50 text-slate-700';

                            return (
                              <tr key={i} className="hover:bg-slate-50 transition-colors text-slate-900 border-b border-slate-200">
                                <td className={`p-1.5 border border-slate-300 ${regColor} ui-strong`}>{a.region}</td>
                                <td className="p-1.5 border border-slate-300 font-medium text-[9px] bg-slate-50/30">{a.account}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-slate-500 ui-strong">{a.population || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_calls', `${a.account} - Total Calls`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.total_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('total_solved', `${a.account} - Solved Calls`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.total_solved}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-blue-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('transferred_calls', `${a.account} - Transferred Calls`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.transferred_calls || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-rose-600 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('cancelled_calls', `${a.account} - Cancelled Calls`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.cancelled_calls}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-slate-900 bg-slate-100/50 cursor-pointer hover:bg-black/5 ui-strong" onClick={() => handleDrillDown('open_calls', `${a.account} - Open Calls`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{open_calls_sum}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_2', `${a.account} - <2 Days`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.age_2 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_3', `${a.account} - 2-7 Days`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.age_3 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_7', `${a.account} - 7-15 Days`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.age_7 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-blue-50/30 cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('age_15', `${a.account} - >15 Days`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.age_15 || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-blue-700 bg-blue-100/20 ui-strong">{perc_gt_7}</td>

                                <td className="p-1.5 border border-slate-300 text-center cursor-pointer hover:bg-black/5" onClick={() => handleDrillDown('part_pending', `${a.account} - Part Pending`, { account: a.account, region: a.region, callType: 'BREAKDOWN' })}>{a.part_pending || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="text-blue-700 ui-strong">{a.active_eng || 0}</span>
                                    <span className="text-[9px] text-slate-400 font-medium">({a.headcount || 0})</span>
                                  </div>
                                </td>

                                <td className="p-1.5 border border-slate-300 text-center bg-amber-50/30">{a.deployment_total || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center bg-amber-50/30">{a.deployment_done || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-amber-700 bg-amber-100/20 ui-strong">{dep_pending}</td>

                                <td className="p-1.5 border border-slate-300 text-center bg-emerald-50/30">{a.installation_done || 0}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-700 bg-emerald-100/20 ui-strong">{inst_pending}</td>
                              </tr>
                            );
                          })}

                          {/* Account Total Row */}
                          <tr className="bg-slate-900 text-white text-[10px] ui-label">
                            <td className="p-1.5 border border-slate-700" colSpan={2}>GRAND TOTAL (AI)</td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.population || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('total_calls', `All India - Total Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('total_solved', `All India - Solved Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.total_solved || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400 cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('transferred_calls', `All India - Transferred Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.transferred_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-rose-400 cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('cancelled_calls', `All India - Cancelled Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.cancelled_calls || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center bg-slate-800 cursor-pointer hover:bg-white/10" onClick={() => handleDrillDown('open_calls', `All India - Open Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0)), 0).toLocaleString()}
                            </td>

                            {/* Aging Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_2 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_3 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_7 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.age_15 || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {(() => {
                                const t7 = filteredAccounts.reduce((sum, a) => sum + Number(a.age_7 || 0), 0);
                                const t15 = filteredAccounts.reduce((sum, a) => sum + Number(a.age_15 || 0), 0);
                                const topen = filteredAccounts.reduce((sum, a) => sum + (Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0)), 0);
                                return topen > 0 ? ((t7 + t15) / topen * 100).toFixed(0) + '%' : '0%';
                              })()}
                            </td>

                            {/* Support Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.part_pending || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.active_eng || 0), 0)}
                              <span className="text-[9px] text-slate-400 ml-1">({globalHeadcount})</span>
                            </td>

                            {/* Deployment Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_total || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-amber-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.deployment_total || 0) - Number(a.deployment_done || 0)), 0).toLocaleString()}
                            </td>

                            {/* Installation Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.installation_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-emerald-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.installation_total || 0) - Number(a.installation_done || 0)), 0).toLocaleString()}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
      </div>


      {/* Engineer Popup */}
      {isDrawerOpen && selectedCall && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 animate-in fade-in duration-200" onClick={() => setIsDrawerOpen(false)} />
          <div className="relative bg-white shadow rounded-lg w-full max-w-[900px] h-[min(760px,92vh)] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200">
            <CallDetail
              call={selectedCall}
              onClose={() => setIsDrawerOpen(false)}
              onFlagUpdate={handleFlagUpdate}
              onPostComment={handlePostComment}
            />
          </div>
        </div>
      )}

      {showEngPopup && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-sm text-slate-900 ui-label">Engineer List</h3>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">{showEngPopup}</p>
              </div>
              <button
                onClick={() => setShowEngPopup(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <ChevronLeft className="rotate-180" size={18} />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2">
              {fetchingEngs ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                  <p className="text-[10px] text-slate-400 ui-label">Fetching Names...</p>
                </div>
              ) : selectedBranchEngs.length > 0 ? (
                <div className="grid grid-cols-1 gap-1">
                  {selectedBranchEngs.map((name, i) => (
                    <div key={i} className="px-3 py-2 text-[11px] font-medium text-slate-700 bg-slate-50/50 rounded-lg border border-slate-100/50 hover:border-slate-200 hover:bg-white transition-all">
                      {name}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-[10px] text-slate-400 ui-label">
                  No engineers found
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowEngPopup(null)}
                className="px-4 py-1.5 bg-slate-900 text-white text-[10px] rounded-lg hover:bg-slate-800 transition-all ui-label"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill Down Side Panel */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[200] flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} />
          <div className="relative w-full max-w-5xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm text-slate-900 ui-label">{drillDown.title}</h3>
                <p className="text-[10px] text-slate-500 font-medium">Detailed breakdown of selected metric</p>
              </div>
              <button onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* SQL Query Runner */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Search size={14} />
                    <span className="text-[10px] ui-label">SQL Query Context</span>
                  </div>
                  <button
                    onClick={() => runCustomQuery(drillDown.sql)}
                    className="px-3 py-1 bg-slate-900 text-white rounded text-[10px] hover:bg-slate-800 transition-all flex items-center gap-2 ui-label"
                  >
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    Run Custom Query
                  </button>
                </div>
                <div className="relative group">
                  <textarea
                    className="w-full h-32 p-3 font-mono text-[11px] bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all"
                    value={drillDown.sql}
                    onChange={(e) => setDrillDown(prev => ({ ...prev, sql: e.target.value }))}
                  />
                </div>
              </div>

              {/* Results */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] text-slate-700 flex items-center gap-2 ui-label">
                    Detail Records
                    <span className="px-2 py-0.5 bg-slate-100 rounded-full text-[9px] ui-strong">{drillDown.data.length} Results</span>
                  </h4>
                  {drillDown.data.length > 0 && (
                    <button className="text-[10px] text-blue-600 hover:underline ui-label">Export Details</button>
                  )}
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                        <tr>
                          {drillDown.data.length > 0 && Object.keys(drillDown.data[0]).map(key => (
                            <th key={key} className="p-3 text-slate-500 border-r border-slate-100 whitespace-nowrap ui-strong">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drillDown.loading ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                                <p className="text-[10px] font-medium text-slate-400">Executing Query...</p>
                              </div>
                            </td>
                          </tr>
                        ) : drillDown.data.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <p className="text-xs font-medium text-slate-400">No data available for this metric</p>
                            </td>
                          </tr>
                        ) : (
                          drillDown.data.map((row, i) => {
                            const callId = row['Ref No'] || row['vtrnno'] || row['Ref. No'] || null;
                            return (
                              <tr 
                                key={i} 
                                className={`transition-colors group ${callId && callId !== '—' ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-slate-50'}`}
                                onClick={() => {
                                  if (callId && callId !== '—') {
                                    handleSelectCall(callId);
                                  }
                                }}
                              >
                                {Object.values(row).map((val: any, j) => (
                                  <td key={j} className="p-3 border-r border-slate-50 whitespace-nowrap text-slate-600 group-hover:text-slate-900 font-medium truncate max-w-[200px]">
                                    {String(val || '—')}
                                  </td>
                                ))}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
