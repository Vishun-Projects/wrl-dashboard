'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  MoreVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { useUser } from '@/components/DashboardLayout';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { CallDetail } from '@/components/CallDetail';
import { useRouter, usePathname } from 'next/navigation';
import { RegisterBranchFranchiseeFilters } from '@/components/RegisterBranchFranchiseeFilters';
import { RegisterColumnPicker } from '@/components/RegisterColumnPicker';
import { RegisterPageFilters } from '@/components/RegisterPageFilters';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  buildRegisterListQueryKey,
  buildSummaryQueryKey,
  filtersEqual,
  joinFilterParam,
  migrateStringFilter,
  resolveViewCallTypesParam,
  resolveSummaryOfficeIdsParam,
} from '@/lib/report-filters';
import {
  loadVisibleRegisterColumns,
  REGISTER_TABLE_COLUMNS,
  saveVisibleRegisterColumns,
  type RegisterTableColumnKey,
} from '@/lib/register-table-columns';
import { getCallTypeBadgeClass } from '@/lib/call-type-badge';
import { MAX_CLIENT_CORPUS_DAYS, resolveRegisterDateSqlColumn } from '@/lib/trhcalls-query';
import {
  findCallsInIndexedDb,
  findCallsInMemoryCaches,
  isIdentifierLookupSearch,
  registerRowMatchesViewFilters,
  summarizeRegisterRows,
  classifyRegisterRowStatus,
  isRegisterRowCancelled,
  normalizeRegisterSummary,
  type RegisterSummary,
  type RegisterSummaryBucket,
  type RegisterViewFilterParts,
} from '@/lib/report-search';
import { isAnyFilterActive, toDateString } from '@/lib/report-filters';
import { globalReportCache, setGlobalReportCache, distributionDataCache, setDistributionDataCache, callCorpusStore } from '@/lib/report-data-store';
import { indexRegisterRowsWithSerial, subscribeRegisterDelta } from '@/lib/report-sync';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  adoptCorpusStoreForScope,
  corpusStoreCoversFetchScope,
  deriveRegisterPageFromCorpus,
  filterCorpusCallsByViewDate,
  getFilteredCorpusCalls,
  getCorpusCallsArray,
  restoreCorpusFromIndexedDB,
} from '@/lib/report-corpus';
import { readCorpusMeta } from '@/lib/report-corpus-storage';
import { deriveSummaryDashboard, diagnoseSummaryDerivation } from '@/lib/report-summary-derive';
import { readRegisterFromPostgresClient, readSummaryFromPostgresClient } from '@/lib/read-model/client-flags';
import { deriveRegisterPageFromCalls, deriveRegisterView } from '@/lib/report-register-view';
import {
  collectRegisterRowsFromSessionCache,
  downloadRegisterCsvFromServer,
  fetchAllRegisterRowsForExport,
  isRegisterExportAbortError,
} from '@/lib/register-export-fetch';
import { ensurePortalAuditCache } from '@/lib/report-portal-cache';

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

type RegisterPageCacheEntry = {
  data: any[];
  total: number;
  registerSummary?: RegisterSummary | null;
  summaryData?: any[];
  accountsData?: any[];
  globalHeadcount?: number;
};

function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

function adjustRegisterSummaryBucket(
  summary: RegisterSummary,
  bucket: RegisterSummaryBucket,
  delta: 1 | -1
) {
  if (bucket === 'transferred') return;

  const step = delta === 1 ? 1 : -1;
  const bump = (value: number) => Math.max(0, value + step);

  if (bucket === 'closed') {
    summary.closed = bump(summary.closed);
    summary.solved = bump(summary.solved);
  } else if (bucket === 'techSolved') {
    summary.techSolved = bump(summary.techSolved);
    summary.solved = bump(summary.solved);
  } else if (bucket === 'assigned') {
    summary.assigned = bump(summary.assigned);
    summary.open = bump(summary.open);
  } else if (bucket === 'openUnallocated') {
    summary.openUnallocated = bump(summary.openUnallocated);
    summary.open = bump(summary.open);
  } else if (bucket === 'cancelled') {
    summary.cancelled = bump(summary.cancelled);
  }
}

function registerPageCachePut(
  root: Map<string, Map<number, RegisterPageCacheEntry>>,
  queryKey: string,
  page: number,
  entry: RegisterPageCacheEntry
) {
  let inner = root.get(queryKey);
  if (!inner) {
    inner = new Map();
    root.set(queryKey, inner);
  }
  inner.set(page, entry);
}

function registerPageCacheGet(
  root: Map<string, Map<number, RegisterPageCacheEntry>>,
  queryKey: string,
  page: number
): RegisterPageCacheEntry | undefined {
  return root.get(queryKey)?.get(page);
}

/** No-op — perf hooks kept so call sites stay stable without console noise. */
function logSummaryDebug(_label: string, _payload: Record<string, unknown>) {}

function corpusSpanDays(startDateStr: string, endDateStr: string): number {
  const spanStart = new Date(`${startDateStr}T00:00:00`);
  const spanEnd = new Date(`${endDateStr}T23:59:59`);
  if (Number.isNaN(spanStart.getTime()) || Number.isNaN(spanEnd.getTime())) return 0;
  return Math.floor((spanEnd.getTime() - spanStart.getTime()) / 86400000) + 1;
}

function reportPerfLogDocumentNavigationOnce() {}

function reportPerf(
  _phase: string,
  _action: string,
  _opStart: number,
  _extra?: Record<string, unknown>
) {}


export default function ReportPage() {
  const [mounted, setMounted] = useState(false);
  const { userProfile } = useUser();
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const pageSessionStartRef = React.useRef<number>(typeof performance !== 'undefined' ? performance.now() : 0);

  const {
    search,
    setSearch,
    pincodeSearch,
    setPincodeSearch,
    dateRange,
    setDateRange,
    dateFilterColumn,
    selectedOfficeIds,
    setSelectedOfficeIds,
    selectedCallTypes,
    setSelectedCallTypes,
    selectedStatus,
    setSelectedStatus,
    priorityFilter,
    setPriorityFilter,
    portalFilter,
    setPortalFilter,
    selectedState,
    setSelectedState,
    selectedCity,
    setSelectedCity,
    selectedBranch,
    setSelectedBranch,
    selectedFranchisee,
    setSelectedFranchisee,
    selectedTechnician,
    setSelectedTechnician,
    setStatesList,
    setCitiesList,
    setTechniciansList,
    setBranchesList,
    setFranchiseesList,
    branchesList,
    franchiseesList,
    clearAllFilters,
    isAnyFilterActive: isAnyRegisterFilterActive,
    callTypes,
    offices,
    runBackgroundSync,
    lastSyncedAt,
    syncInProgress,
    ensureCorpusLoaded,
    corpusTick,
    corpusLoading,
    distributionCalls,
    ensureSharedCallsLoaded,
  } = useReportFilters();

  const summaryOfficeIdsParam = useMemo(
    () => resolveSummaryOfficeIdsParam(offices, selectedBranch, selectedFranchisee),
    [offices, selectedBranch, selectedFranchisee]
  );
  const registerOfficeIdsParam = 'All';

  const [debouncedSearch, setDebouncedSearch] = useState(globalReportCache?.search || '');
  const [debouncedPincodeSearch, setDebouncedPincodeSearch] = useState(globalReportCache?.pincodeSearch || '');
  const [dbInitialized, setDbInitialized] = useState(!!globalReportCache);
  const [activeTab, setActiveTab] = useState<'register' | 'summary' | 'accounts'>('register');
  const [visibleRegisterColumns, setVisibleRegisterColumns] = useState<RegisterTableColumnKey[]>(() =>
    loadVisibleRegisterColumns()
  );
  const [data, setData] = useState<any[]>(globalReportCache?.data || []);
  const [summaryData, setSummaryData] = useState<any[]>(globalReportCache?.summaryData || []);
  const [accountsData, setAccountsData] = useState<any[]>(globalReportCache?.accountsData || []);
  const [globalHeadcount, setGlobalHeadcount] = useState<number>(globalReportCache?.globalHeadcount || 0);
  const [loading, setLoading] = useState(!globalReportCache);
  const [filterUpdating, setFilterUpdating] = useState(false);
  const [total, setTotal] = useState<number>(globalReportCache?.total || 0);

  useEffect(() => {
    if (!globalReportCache?.data) {
      try {
        const cached = localStorage.getItem('report_fortnight_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.data) setData(parsed.data);
          if (parsed.total) setTotal(parsed.total);
        }
      } catch(e) {}
    }
    setMounted(true);
  }, []);
  const [page, setPage] = useState(globalReportCache?.page || 1);
  const [limit] = useState(10);
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const registerPagesCacheRef = React.useRef<Map<string, Map<number, RegisterPageCacheEntry>>>(new Map());
  const lastKnownRegisterTotalRef = React.useRef<number>(globalReportCache?.total || 0);
  const clearFiltersRef = React.useRef<boolean>(false);

  const viewCallTypesParam = useMemo(
    () => resolveViewCallTypesParam(selectedCallTypes),
    [selectedCallTypes]
  );

  const callTypeFilterLabel = useMemo(() => {
    if (selectedCallTypes.length === 0) return 'All Call Types';
    if (selectedCallTypes.length === 1) return selectedCallTypes[0];
    return `${selectedCallTypes.length} Types Selected`;
  }, [selectedCallTypes]);
  useEffect(() => {
    const scheduleT = performance.now();
    const timer = setTimeout(() => {
      const fireT = performance.now();
      reportPerf('debounce', 'search → debouncedSearch', fireT, {
        why: '300ms idle after last keystroke; filter effect compares debouncedSearch to last fetch.',
        waitMs: Number((fireT - scheduleT).toFixed(1)),
        len: search.length,
      });
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const scheduleT = performance.now();
    const timer = setTimeout(() => {
      const fireT = performance.now();
      reportPerf('debounce', 'pincode → debouncedPincodeSearch', fireT, {
        why: 'Same debounce pattern as search.',
        waitMs: Number((fireT - scheduleT).toFixed(1)),
        len: pincodeSearch.length,
      });
      setDebouncedPincodeSearch(pincodeSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [pincodeSearch]);

  useEffect(() => {
    reportPerfLogDocumentNavigationOnce();
    const tMount = performance.now();
    reportPerf('lifecycle', 'ReportPage mount effect (after paint)', tMount, {
      why: 'Runs after first paint; msSincePageSessionStart ≈ time from component render start to this effect.',
      msSincePageSessionStart: Number((tMount - pageSessionStartRef.current).toFixed(1)),
    });
  }, []);

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
  const [showCallTypeDropdown, setShowCallTypeDropdown] = useState(false);
  const [exportingDetailed, setExportingDetailed] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ fetched: number; total: number } | null>(
    null
  );
  const exportAbortRef = React.useRef<AbortController | null>(null);
  const [agingAsOf, setAgingAsOf] = useState<string>(() => {
    if (globalReportCache && typeof globalReportCache.agingAsOf === 'string' && globalReportCache.agingAsOf.includes('-') && !globalReportCache.agingAsOf.includes(':')) {
      return globalReportCache.agingAsOf;
    }
    return new Date().toISOString().split('T')[0];
  });

  const cancelRegisterExport = useCallback(() => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    setExportingDetailed(false);
    setExportProgress(null);
  }, []);

  const registerExportScopeKey = useMemo(
    () =>
      buildRegisterListQueryKey({
        officeIdsParam: summaryOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: debouncedSearch || '',
        pincodeForUrl: debouncedPincodeSearch || '',
        startDateStr: toDateString(dateRange.start),
        endDateStr: toDateString(dateRange.end),
        dateFilterColumn,
        selectedState,
        selectedCity,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
        selectedStatus,
        priorityFilter,
        portalFilter,
        agingAsOf: agingAsOf || '',
      }),
    [
      summaryOfficeIdsParam,
      viewCallTypesParam,
      debouncedSearch,
      debouncedPincodeSearch,
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      agingAsOf,
    ]
  );

  const prevRegisterExportScopeKeyRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (
      prevRegisterExportScopeKeyRef.current !== null &&
      prevRegisterExportScopeKeyRef.current !== registerExportScopeKey
    ) {
      cancelRegisterExport();
    }
    prevRegisterExportScopeKeyRef.current = registerExportScopeKey;
  }, [registerExportScopeKey, cancelRegisterExport]);

  useEffect(() => () => cancelRegisterExport(), [cancelRegisterExport]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const handleFlagUpdate = async (id: string, flag: string) => {
    setData(prev => prev.map(d => (String(d.id) === String(id) ? { ...d, audit_flag: flag } : d)));
    setSelectedCall((prev: any) => (prev && String(prev.id) === String(id) ? { ...prev, audit_flag: flag } : prev));
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
      setData(prev => prev.map(d => (String(d.id) === String(id) ? {
        ...d,
        comments: [newComment, ...(d.comments || [])],
        comment_count: (d.comment_count || 0) + 1,
      } : d)));
      await axios.post('/api/comments', { call_id: id, text, office_id: targetCall?.nofficeid }, { headers: { 'Authorization': `Bearer ${session?.access_token}` } });
    } catch (err) {
      // ignore
    }
  };

  const handleSelectCall = async (id: string, row?: any) => {
    setSelectedCallId(id);
    setIsDrawerOpen(true);
    const targetCall = row || data.find(d => String(d.id) === String(id));
    setSelectedCall(targetCall ? {
      ...targetCall,
      id: String(targetCall.id),
      office_id: targetCall.office_id || String(targetCall.nofficeid || ''),
      customer_name: targetCall.customer_name || targetCall.PartyName,
      branch_name: targetCall.branch_name || targetCall.officename,
      engineer_name: targetCall.engineer_name || targetCall.serviceman,
      vtrnno: targetCall.vtrnno || targetCall.UniqueCallNo,
    } : { id });
    
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


  // We no longer sync data to localStorage here to avoid overwriting base cache with filtered data.

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
  const [registerSummary, setRegisterSummary] = useState<RegisterSummary | null>(
    normalizeRegisterSummary(globalReportCache?.registerSummary)
  );

  useEffect(() => {
    saveVisibleRegisterColumns(visibleRegisterColumns);
  }, [visibleRegisterColumns]);

  const visibleRegisterColumnDefs = React.useMemo(
    () => REGISTER_TABLE_COLUMNS.filter((col) => visibleRegisterColumns.includes(col.key)),
    [visibleRegisterColumns]
  );

  const renderRegisterCell = (key: RegisterTableColumnKey, row: any) => {
    switch (key) {
      case 'UniqueCallNo':
        return (
          <button onClick={() => handleSelectCall(String(row.id), row)} className="text-slate-700 underline hover:text-slate-900">
            {row.UniqueCallNo}
          </button>
        );
      case 'vcclid':
        return (
          <button onClick={() => handleSelectCall(String(row.id), row)} className="underline hover:text-slate-700">
            {row.vcclid ?? '—'}
          </button>
        );
      case 'calltype':
        return (
          <span className={`ui-strong ${getCallTypeBadgeClass(row.calltype)}`}>
            {row.calltype || 'N/A'}
          </span>
        );
      case 'callsdtrndate':
        return formatDate(row.callsdtrndate);
      case 'PartyName':
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.PartyName}
            {priorityFilter.length === 0 && row.is_major_repair === 'True' && (
              <span className="rounded bg-rose-500 px-1 py-0.5 text-[8px] text-white ui-strong">MAJOR</span>
            )}
          </span>
        );
      case 'officename':
        return row.officename && row.officename !== 'UNKNOWN' ? row.officename : '—';
      case 'franchisee_name':
        return row.franchisee_name && row.franchisee_name !== 'Unallocated'
          ? row.franchisee_name
          : '—';
      case 'Pincode':
        return row.Pincode ?? row.pincode ?? '—';
      case 'itemname':
        return row.itemname;
      case 'callsvserialno':
        return row.callsvserialno;
      case 'serviceman':
        return row.serviceman;
      case 'vcomplaint':
        return row.vcomplaint;
      case 'Status':
        return (() => {
          const isCancelled = isRegisterRowCancelled(row);
          const isSolved =
            !isCancelled &&
            (row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True');
          const isRejected =
            isSolved &&
            (row.bmreject === 'Yes' || String(row.rejectionstatus) === '1' || String(row.rejectionstatus) === '2');
          const isTechSolved =
            (row.bfastclose === 'True' || row.bfastclose === '1') && !isSolved && !isCancelled;
          const isAssigned =
            (row.nengineer && String(row.nengineer) !== '0') && !isSolved && !isCancelled && !isTechSolved;

          if (isRejected) return <span className="badge-cancelled">Closed - Rejected</span>;
          if (isCancelled) return <span className="badge-cancelled">Cancelled</span>;
          if (isSolved) return <span className="badge-solved">Solved</span>;
          if (isTechSolved) return <span className="badge-assigned">Tech. Solved</span>;
          if (isAssigned) return <span className="badge-assigned">Assigned</span>;
          return <span className="badge-open">Open</span>;
        })();
      case 'portal_action':
        return (() => {
          const flag = row.audit_flag || 'unseen';
          const label = flag === 'noted' ? 'Verified' : flag === 'query' ? 'Hold' : flag === 'escalate' ? 'Rejected' : 'Unseen';
          const badgeClass = flag === 'noted' ? 'badge-solved' : flag === 'query' ? 'badge-assigned' : flag === 'escalate' ? 'badge-cancelled' : 'badge-unseen';
          const commentCount = row.comment_count ?? row.comments?.length ?? 0;
          return (
            <div className="flex flex-col items-start gap-1">
              <span className={`text-[10px] px-2 py-0.5 rounded ui-label ${badgeClass}`}>{label}</span>
              {commentCount > 0 && (
                <span className="text-[9px] text-slate-400 font-medium">{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
              )}
            </div>
          );
        })();
      case 'callsolveddate':
        return formatDate(row.callsolveddate);
      case 'vsolveremarks':
        return (() => {
          const rejectionRemark = row.vcomment || null;
          const solveRemark = row.vsolveremarks || row.cancel_reason || null;
          if (rejectionRemark) {
            return <span className="font-medium text-rose-600">⚑ {rejectionRemark}</span>;
          }
          return <span className="text-slate-400">{solveRemark || '—'}</span>;
        })();
      case 'vpersoncalling':
        return row.vpersoncalling;
      case 'vinsttel1':
        return row.vinsttel1;
      case 'vinstaddress':
        return row.vinstaddress;
      default:
        return '—';
    }
  };

  const getRegisterCellClassName = (key: RegisterTableColumnKey) => {
    if (key === 'UniqueCallNo') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-mono text-slate-400';
    if (key === 'vcclid') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-900';
    if (key === 'PartyName') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-800';
    if (key === 'Pincode' || key === 'callsvserialno') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700';
    if (key === 'officename' || key === 'franchisee_name' || key === 'itemname') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-700';
    if (key === 'serviceman' || key === 'vinsttel1') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-900';
    if (key === 'vpersoncalling') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-600';
    if (key === 'vsolveremarks') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px]';
    if (key === 'vinstaddress') return 'whitespace-nowrap px-3 py-2 text-[11px] text-slate-500';
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-500';
  };

  const fetchControllerRef = React.useRef<AbortController | null>(null);
  const drillDownControllerRef = React.useRef<AbortController | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const lastSummaryQueryKeyRef = React.useRef<string | null>(globalReportCache?.summaryQueryKey ?? null);
  const lastRegisterListQueryKeyRef = React.useRef<string | null>(null);
  const lastAppliedFilterSnapshotRef = React.useRef<string | null>(null);
  const filterEffectInFlightRef = React.useRef(false);
  const dataRef = React.useRef(data);
  const totalRef = React.useRef(total);
  const registerSummaryRef = React.useRef(registerSummary);
  const summaryDataRef = React.useRef(summaryData);
  const accountsDataRef = React.useRef(accountsData);
  const globalHeadcountRef = React.useRef(globalHeadcount);
  dataRef.current = data;
  totalRef.current = total;
  registerSummaryRef.current = registerSummary;
  summaryDataRef.current = summaryData;
  accountsDataRef.current = accountsData;
  globalHeadcountRef.current = globalHeadcount;
  const registerViewFilterRef = React.useRef<RegisterViewFilterParts>({
    search: debouncedSearch,
    pincodeSearch: debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedCallTypes,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
  });
  registerViewFilterRef.current = {
    search: debouncedSearch,
    pincodeSearch: debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedCallTypes,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
  };

  // Client-side cascades computation removed in favor of server-side cascades

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
      const isBaseFilter = 
        selectedState.length === 0 &&
        selectedCity.length === 0 &&
        selectedBranch.length === 0 &&
        selectedFranchisee.length === 0 &&
        selectedTechnician.length === 0 &&
        search === '' &&
        pincodeSearch === '' &&
        selectedStatus.length === 0 &&
        priorityFilter.length === 0 &&
        portalFilter.length === 0 &&
        selectedOfficeIds.length === 0 &&
        selectedCallTypes.length === 0 &&
        !filterAccount && filterRegion.length === 0;

      if (isBaseFilter) {
        try {
          localStorage.setItem('report_fortnight_cache', JSON.stringify({
            data: calls.slice(0, 100),
            total,
            summaryData,
            accountsData,
            globalHeadcount
          }));
        } catch(e) {}
          
        const officeIdsParam = summaryOfficeIdsParam;
        const startDateStr = toDateString(dateRange.start);
        const endDateStr = toDateString(dateRange.end);

        await saveCallsToDB(calls);
        await saveMeta('cacheParams', {
          startDate: startDateStr,
          endDate: endDateStr,
          dateFilterColumn,
          officeIds: officeIdsParam,
          callTypes: viewCallTypesParam,
          lastRefreshed: lastRefreshedDate.toISOString(),
          total,
          registerSummary,
          summaryData,
          accountsData,
          globalHeadcount,
          summaryQueryKey: lastSummaryQueryKeyRef.current ?? globalReportCache?.summaryQueryKey,
        });
      }
    } catch (err) {
      console.error('Failed to persist cache to IndexedDB:', err);
    }
  };

  const getEffectiveViewFilters = useCallback((): RegisterViewFilterParts => {
    return registerViewFilterRef.current;
  }, []);

  /** Summary/Accounts rows must include region hierarchy and headcount. */
  const isApiShapedSummary = (rows: unknown[]): boolean =>
    rows.length > 0 &&
    rows.some(
      (r) =>
        typeof r === 'object' &&
        r != null &&
        'headcount' in r &&
        (r as { headcount?: unknown }).headcount != null &&
        'region' in r
    );

  const buildCurrentSummaryQueryKey = () => {
    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);
    const agingStr =
      agingAsOf.includes(' ') || agingAsOf.includes(':')
        ? new Date(agingAsOf).toISOString().split('T')[0]
        : agingAsOf;
    return buildSummaryQueryKey({
      officeIdsParam: summaryOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      startDateStr,
      endDateStr,
      agingAsOf: agingStr,
    });
  };

  const hydrateSummaryFromCache = (): boolean => {
    const summaryQueryKey = buildCurrentSummaryQueryKey();
    const cachedSummary = globalReportCache?.summaryData?.length
      ? globalReportCache.summaryData
      : summaryDataRef.current;
    const cachedAccounts = globalReportCache?.accountsData?.length
      ? globalReportCache.accountsData
      : accountsDataRef.current;

    if (!cachedSummary.length || !isApiShapedSummary(cachedSummary)) {
      return false;
    }

    const exactKeyMatch =
      globalReportCache?.summaryQueryKey === summaryQueryKey ||
      lastSummaryQueryKeyRef.current === summaryQueryKey;
    const datesMatch =
      !!globalReportCache?.dateRange &&
      globalReportCache.dateRange.start.getTime() === dateRange.start.getTime() &&
      globalReportCache.dateRange.end.getTime() === dateRange.end.getTime();

    if (!exactKeyMatch && !datesMatch) {
      return false;
    }

    if (summaryDataRef.current !== cachedSummary) setSummaryData(cachedSummary);
    if (accountsDataRef.current !== cachedAccounts) setAccountsData(cachedAccounts || []);
    if (globalReportCache?.globalHeadcount !== undefined) {
      setGlobalHeadcount(globalReportCache.globalHeadcount);
    }
    if (exactKeyMatch) {
      lastSummaryQueryKeyRef.current = summaryQueryKey;
    }
    return exactKeyMatch;
  };

  const commitSummaryResult = useCallback(
    (
      branchSummary: ReturnType<typeof deriveSummaryDashboard>['branchSummary'],
      accountSummary: ReturnType<typeof deriveSummaryDashboard>['accountSummary'],
      headcount: number,
      startDateStr: string,
      endDateStr: string,
      agingStr: string
    ) => {
      const summaryQueryKey = buildSummaryQueryKey({
        officeIdsParam: summaryOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        startDateStr,
        endDateStr,
        agingAsOf: agingStr,
      });

      setSummaryData(branchSummary);
      setAccountsData(accountSummary);
      setGlobalHeadcount(headcount);
      lastSummaryQueryKeyRef.current = summaryQueryKey;

      if (globalReportCache) {
        globalReportCache.summaryData = branchSummary;
        globalReportCache.accountsData = accountSummary;
        globalReportCache.globalHeadcount = headcount;
        globalReportCache.summaryQueryKey = summaryQueryKey;
      }

      void persistCurrentCache(
        globalReportCache?.data || dataRef.current,
        branchSummary,
        accountSummary,
        headcount,
        totalRef.current,
        registerSummaryRef.current,
        callCorpusStore?.lastSyncedAt ? new Date(callCorpusStore.lastSyncedAt) : new Date()
      );
    },
    [
      summaryOfficeIdsParam,
      viewCallTypesParam,
      callCorpusStore?.lastSyncedAt,
    ]
  );

  const applySummaryFromCorpus = useCallback((): boolean => {
    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);
    const agingStr =
      agingAsOf.includes(' ') || agingAsOf.includes(':')
        ? new Date(agingAsOf).toISOString().split('T')[0]
        : agingAsOf;
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
    const spanDays = corpusSpanDays(startDateStr, endDateStr);
    const deriveOpts = {
      agingAsOf: agingStr,
      endDate: endDateStr,
      officeIdsParam: summaryOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
    };

    if (!callCorpusStore?.calls.size || callCorpusStore.cacheKey !== corpusKey) {
      logSummaryDebug('corpus not ready — summary cannot derive client-side', {
        reason: !callCorpusStore?.calls.size ? 'empty_or_missing_corpus' : 'cache_key_mismatch',
        expectedCorpusKey: corpusKey,
        actualCorpusKey: callCorpusStore?.cacheKey ?? null,
        corpusCallCount: callCorpusStore?.calls.size ?? 0,
        dateRange: `${startDateStr} → ${endDateStr}`,
        spanDays,
        maxClientCorpusDays: MAX_CLIENT_CORPUS_DAYS,
        exceedsCorpusLimit: spanDays > MAX_CLIENT_CORPUS_DAYS,
        officeFilter: summaryOfficeIdsParam,
        callTypeFilter: viewCallTypesParam,
        nextStep:
          spanDays > MAX_CLIENT_CORPUS_DAYS
            ? 'Will fetch /api/report/summary (full SQL range; client corpus capped at 120 days)'
            : 'Will retry after corpus load or fall back to /api/report/summary',
      });
      return false;
    }

    const calls = filterCorpusCallsByViewDate(getCorpusCallsArray(callCorpusStore), viewDateFilter);
    const diagnostic = diagnoseSummaryDerivation(calls, deriveOpts);
    const { branchSummary, accountSummary, globalHeadcount: headcount } = deriveSummaryDashboard(
      calls,
      deriveOpts
    );

    logSummaryDebug('derived from corpus', {
      ...diagnostic,
      corpusTruncated: callCorpusStore.truncated ?? false,
      branchRows: branchSummary.length,
      accountRows: accountSummary.length,
      globalHeadcount: headcount,
      emptyReason:
        branchSummary.length === 0
          ? diagnostic.afterCallTypeFilter === 0
            ? diagnostic.afterOfficeFilter === 0
              ? diagnostic.eligibleCalls === 0
                ? 'no_eligible_calls_in_corpus'
                : 'office_filter_excluded_all_calls'
              : 'call_type_filter_excluded_all_calls'
            : 'aggregation_produced_no_branch_rows'
          : null,
    });

    commitSummaryResult(branchSummary, accountSummary, headcount, startDateStr, endDateStr, agingStr);

    return branchSummary.length > 0 || callCorpusStore.calls.size > 0;
  }, [
    dateRange.start,
    dateRange.end,
    agingAsOf,
    summaryOfficeIdsParam,
    viewCallTypesParam,
    dateFilterColumn,
    callCorpusStore,
    commitSummaryResult,
  ]);

  const fetchSummaryFromApi = useCallback(async (): Promise<boolean> => {
    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);
    const agingStr =
      agingAsOf.includes(' ') || agingAsOf.includes(':')
        ? new Date(agingAsOf).toISOString().split('T')[0]
        : agingAsOf;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await axios.get('/api/report/summary', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        params: {
          officeId: summaryOfficeIdsParam,
          callType: viewCallTypesParam,
          startDate: startDateStr,
          endDate: endDateStr,
          agingAsOf: agingStr,
        },
      });

      const branchSummary = res.data?.branchSummary ?? [];
      const accountSummary = res.data?.accountSummary ?? [];
      const headcount = Number(res.data?.globalHeadcount ?? 0);

      logSummaryDebug('loaded from /api/report/summary', {
        branchRows: branchSummary.length,
        accountRows: accountSummary.length,
        globalHeadcount: headcount,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIdsParam,
        callTypeFilter: viewCallTypesParam,
        emptyReason:
          branchSummary.length === 0
            ? 'API returned zero branch rows — check office/date filters or DB data'
            : null,
      });

      commitSummaryResult(branchSummary, accountSummary, headcount, startDateStr, endDateStr, agingStr);
      return branchSummary.length > 0 || accountSummary.length > 0;
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Summary API failed';
      logSummaryDebug('API fallback failed', {
        error: message,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIdsParam,
        callTypeFilter: viewCallTypesParam,
      });
      return false;
    }
  }, [
    dateRange.start,
    dateRange.end,
    agingAsOf,
    summaryOfficeIdsParam,
    viewCallTypesParam,
    supabase,
    commitSummaryResult,
  ]);

  const applyRegisterFromCorpus = useCallback(
    (pageNum = 1): boolean => {
      if (readRegisterFromPostgresClient()) return false;
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);
      const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
      const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);

      let store = callCorpusStore;
      if (store?.calls.size && store.cacheKey !== corpusKey) {
        if (corpusStoreCoversFetchScope(store, startDateStr, endDateStr, dateFilterColumn)) {
          store = adoptCorpusStoreForScope(store, startDateStr, endDateStr, dateFilterColumn);
        }
      }
      if (!store?.calls.size || store.cacheKey !== corpusKey) {
        return false;
      }

      const viewFilters = registerViewFilterRef.current;
      const derived = deriveRegisterPageFromCorpus(
        store,
        corpusKey,
        viewFilters,
        pageNum,
        limit,
        viewDateFilter
      );
      if (!derived) return false;

      const allFiltered = getFilteredCorpusCalls(viewFilters, store, viewDateFilter);
      const summary = summarizeRegisterRows(allFiltered);
      const queryKey = buildRegisterListQueryKey({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: viewFilters.search || '',
        pincodeForUrl: viewFilters.pincodeSearch || '',
        startDateStr,
        endDateStr,
        dateFilterColumn,
        selectedState: viewFilters.selectedState,
        selectedCity: viewFilters.selectedCity,
        selectedBranch: viewFilters.selectedBranch,
        selectedFranchisee: viewFilters.selectedFranchisee,
        selectedTechnician: viewFilters.selectedTechnician,
        selectedStatus: viewFilters.selectedStatus,
        priorityFilter: viewFilters.priorityFilter,
        portalFilter: viewFilters.portalFilter,
        agingAsOf: agingAsOf || '',
      });

      setData(derived.rows);
      setTotal(derived.total);
      setPage(pageNum);
      setRegisterSummary(summary);
      setLastRefreshed(
        store.lastSyncedAt ? new Date(store.lastSyncedAt) : new Date()
      );
      lastRegisterListQueryKeyRef.current = queryKey;
      lastKnownRegisterTotalRef.current = derived.total;
      registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
        data: derived.rows,
        total: derived.total,
        registerSummary: summary,
      });

      const refreshedDate = store.lastSyncedAt
        ? new Date(store.lastSyncedAt)
        : new Date();
      setGlobalReportCache({
        data: derived.rows,
        summaryData: globalReportCache?.summaryData ?? summaryData,
        accountsData: globalReportCache?.accountsData ?? accountsData,
        globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
        total: derived.total,
        registerSummary: summary,
        page: pageNum,
        search: viewFilters.search || '',
        pincodeSearch: viewFilters.pincodeSearch || '',
        selectedCallTypes,
        selectedState,
        selectedCity,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
        selectedStatus,
        priorityFilter,
        portalFilter,
        selectedOfficeIds,
        agingAsOf,
        dateRange,
        dateFilterColumn,
        filterRegion,
        filterAccount,
        lastRefreshed: refreshedDate,
        summaryQueryKey: globalReportCache?.summaryQueryKey,
      });

      return true;
    },
    [
      dateRange.start,
      dateRange.end,
      dateFilterColumn,
      viewCallTypesParam,
      agingAsOf,
      limit,
      selectedCallTypes,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      selectedOfficeIds,
    ]
  );

  const getSharedCallsForScope = useCallback(() => {
    if (!readRegisterFromPostgresClient()) return null;
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
    if (distributionDataCache?.cacheKey !== corpusKey) return null;
    const calls =
      (distributionDataCache.allCalls?.length ?? 0) > 0
        ? distributionDataCache.allCalls
        : distributionCalls.length > 0
          ? distributionCalls
          : null;
    if (!calls?.length) return null;
    return { calls, corpusKey, startDateStr, endDateStr };
  }, [dateRange.start, dateRange.end, dateFilterColumn, distributionCalls]);

  const applyRegisterFromSharedCalls = useCallback(
    (pageNum = 1): boolean => {
      if (!readRegisterFromPostgresClient()) return false;
      const scope = getSharedCallsForScope();
      if (!scope) return false;

      const { calls, startDateStr, endDateStr } = scope;
      const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
      const viewFilters = registerViewFilterRef.current;
      const derived = deriveRegisterPageFromCalls(
        calls,
        viewFilters,
        pageNum,
        limit,
        viewDateFilter
      );
      const { summary } = deriveRegisterView(calls, viewFilters, viewDateFilter);
      const queryKey = buildRegisterListQueryKey({
        officeIdsParam: registerOfficeIdsParam,
        callTypesParam: viewCallTypesParam,
        searchForUrl: viewFilters.search || '',
        pincodeForUrl: viewFilters.pincodeSearch || '',
        startDateStr,
        endDateStr,
        dateFilterColumn,
        selectedState: viewFilters.selectedState,
        selectedCity: viewFilters.selectedCity,
        selectedBranch: viewFilters.selectedBranch,
        selectedFranchisee: viewFilters.selectedFranchisee,
        selectedTechnician: viewFilters.selectedTechnician,
        selectedStatus: viewFilters.selectedStatus,
        priorityFilter: viewFilters.priorityFilter,
        portalFilter: viewFilters.portalFilter,
        agingAsOf: agingAsOf || '',
      });

      setData(derived.rows);
      setTotal(derived.total);
      setPage(pageNum);
      setRegisterSummary(summary);
      setLastRefreshed(
        distributionDataCache?.lastSyncedAt
          ? new Date(distributionDataCache.lastSyncedAt)
          : new Date()
      );
      lastRegisterListQueryKeyRef.current = queryKey;
      lastKnownRegisterTotalRef.current = derived.total;
      registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
        data: derived.rows,
        total: derived.total,
        registerSummary: summary,
      });

      const refreshedDate = distributionDataCache?.lastSyncedAt
        ? new Date(distributionDataCache.lastSyncedAt)
        : new Date();
      setGlobalReportCache({
        data: derived.rows,
        summaryData: globalReportCache?.summaryData ?? summaryData,
        accountsData: globalReportCache?.accountsData ?? accountsData,
        globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
        total: derived.total,
        registerSummary: summary,
        page: pageNum,
        search: viewFilters.search || '',
        pincodeSearch: viewFilters.pincodeSearch || '',
        selectedCallTypes,
        selectedState,
        selectedCity,
        selectedBranch,
        selectedFranchisee,
        selectedTechnician,
        selectedStatus,
        priorityFilter,
        portalFilter,
        selectedOfficeIds,
        agingAsOf,
        dateRange,
        dateFilterColumn,
        filterRegion,
        filterAccount,
        lastRefreshed: refreshedDate,
        summaryQueryKey: globalReportCache?.summaryQueryKey,
      });

      return true;
    },
    [
      getSharedCallsForScope,
      dateFilterColumn,
      viewCallTypesParam,
      agingAsOf,
      limit,
      selectedCallTypes,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      selectedOfficeIds,
      dateRange,
      filterRegion,
      filterAccount,
      summaryData,
      accountsData,
      globalHeadcount,
    ]
  );

  useEffect(() => {
    if (!dbInitialized) return;
    if (debouncedSearch?.trim() || debouncedPincodeSearch?.trim()) return;
    if (!loading && data.length > 0) return;
    if (readRegisterFromPostgresClient()) {
      void (async () => {
        if (!getSharedCallsForScope()) {
          await ensureSharedCallsLoaded(false);
        }
        if (applyRegisterFromSharedCalls(1)) {
          setLoading(false);
          setFilterUpdating(false);
          return;
        }
        await fetchData(1, { silent: false });
      })();
      return;
    }
    if (applyRegisterFromCorpus(1)) {
      setLoading(false);
      setFilterUpdating(false);
    }
  }, [
    dbInitialized,
    corpusTick,
    loading,
    data.length,
    debouncedSearch,
    debouncedPincodeSearch,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    ensureSharedCallsLoaded,
    getSharedCallsForScope,
    distributionCalls,
  ]);

  const fetchData = async (
    p = 1,
    opts?: {
      silent?: boolean;
      skipCache?: boolean;
      forceCorpus?: boolean;
      searchOverride?: string;
      pincodeOverride?: string;
    }
  ) => {
    const opStart = performance.now();
    const opId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const hadPriorRequest = !!fetchControllerRef.current;
    reportPerf('fetchData', 'start', opStart, {
      opId,
      page: p,
      opts: opts || {},
      hadPriorRequest,
      why: hadPriorRequest
        ? 'Aborts any in-flight report request (pagination/filter race).'
        : 'Cold start for this invocation.',
    });

    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
    }

    const officeIdsParam = registerOfficeIdsParam;
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);

    const searchForUrl = opts?.searchOverride !== undefined ? opts.searchOverride : debouncedSearch;
    const pincodeForUrl = opts?.pincodeOverride !== undefined ? opts.pincodeOverride : debouncedPincodeSearch;
    let skipCache = !!opts?.skipCache;
    const searchActive = !!(searchForUrl?.trim() || pincodeForUrl?.trim());
    if (searchActive) {
      skipCache = true;
    }

    const queryKey = buildRegisterListQueryKey({
      officeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: searchForUrl || '',
      pincodeForUrl: pincodeForUrl || '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      agingAsOf: agingAsOf || '',
    });

    if (p === 1 && searchForUrl?.trim() && isIdentifierLookupSearch(searchForUrl) && !pincodeForUrl) {
      let cachedHits = findCallsInMemoryCaches(searchForUrl);
      if (cachedHits.length === 0) {
        cachedHits = await findCallsInIndexedDb(searchForUrl, getCallsFromDB);
      }

      if (cachedHits.length > 0) {
        const summary = summarizeRegisterRows(cachedHits);
        setData(cachedHits);
        setTotal(cachedHits.length);
        setPage(1);
        setRegisterSummary(summary);
        setLastRefreshed(new Date());
        lastRegisterListQueryKeyRef.current = queryKey;
        if (globalReportCache) {
          globalReportCache.search = searchForUrl || '';
          globalReportCache.pincodeSearch = pincodeForUrl || '';
          globalReportCache.data = cachedHits;
          globalReportCache.total = cachedHits.length;
          globalReportCache.registerSummary = summary;
        }
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        reportPerf('fetchData', 'identifier search cache HIT (no network)', opStart, {
          opId,
          rows: cachedHits.length,
          why: 'Matched ID/TRN/call ID/serial in shared/distribution/IndexedDB before API.',
        });
        return;
      }

      skipCache = true;
      reportPerf('fetchData', 'identifier search cache MISS → database', opStart, {
        opId,
        search: searchForUrl,
        why: 'Identifier not in local caches; force API lookup.',
      });
    }

    if (!skipCache) {
      const cached = registerPageCacheGet(registerPagesCacheRef.current, queryKey, p);
      if (cached) {
        setData(cached.data);
        setTotal(cached.total);
        setPage(p);
        if (cached.registerSummary !== undefined) {
          setRegisterSummary(cached.registerSummary ?? null);
        }
        if (cached.summaryData) setSummaryData(cached.summaryData);
        if (cached.accountsData) setAccountsData(cached.accountsData);
        if (cached.globalHeadcount !== undefined) setGlobalHeadcount(cached.globalHeadcount);
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        setLastRefreshed(new Date());
        lastRegisterListQueryKeyRef.current = queryKey;
        reportPerf('fetchData', 'session page cache HIT (no network)', opStart, {
          opId,
          page: p,
          rows: cached.data.length,
          why: 'In-memory Map for this queryKey+page; avoids waiting on SQL/API again.',
        });
        return;
      }
    }

    if (!searchActive && readRegisterFromPostgresClient()) {
      if (!getSharedCallsForScope()) {
        await ensureSharedCallsLoaded(false);
      }
      if (applyRegisterFromSharedCalls(p)) {
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        reportPerf('fetchData', 'postgres shared calls client slice HIT (no network)', opStart, {
          opId,
          page: p,
          why: 'Filtered/paginated from bulk register preload; skips /api/report.',
        });
        if (p === 1) {
          const scope = getSharedCallsForScope();
          if (scope) {
            const viewDateFilter = buildCorpusViewDateFilter(
              scope.startDateStr,
              scope.endDateStr,
              dateFilterColumn
            );
            const page2 = deriveRegisterPageFromCalls(
              scope.calls,
              registerViewFilterRef.current,
              2,
              limit,
              viewDateFilter
            );
            const { summary } = deriveRegisterView(
              scope.calls,
              registerViewFilterRef.current,
              viewDateFilter
            );
            registerPageCachePut(registerPagesCacheRef.current, queryKey, 2, {
              data: page2.rows,
              total: page2.total,
              registerSummary: summary,
            });
          }
        }
        return;
      }
    }

    if (!searchActive && !readRegisterFromPostgresClient()) {
      const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
      const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
      const hasCorpus =
        (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) ||
        corpusStoreCoversFetchScope(callCorpusStore, startDateStr, endDateStr, dateFilterColumn);
      if (!hasCorpus || opts?.forceCorpus) {
        await ensureCorpusLoaded({
          silent: !!opts?.silent,
          force: !!opts?.forceCorpus,
        });
      }
      await ensurePortalAuditCache(supabase);
      const viewFilters = registerViewFilterRef.current;
      let corpusStore = callCorpusStore;
      if (corpusStore?.calls.size && corpusStore.cacheKey !== corpusKey) {
        if (corpusStoreCoversFetchScope(corpusStore, startDateStr, endDateStr, dateFilterColumn)) {
          corpusStore = adoptCorpusStoreForScope(corpusStore, startDateStr, endDateStr, dateFilterColumn);
        }
      }
      const corpusDerived = deriveRegisterPageFromCorpus(
        corpusStore,
        corpusKey,
        viewFilters,
        p,
        limit,
        viewDateFilter
      );
      if (corpusDerived) {
        const allFiltered = getFilteredCorpusCalls(viewFilters, corpusStore, viewDateFilter);
        const summary = p === 1 ? summarizeRegisterRows(allFiltered) : registerSummaryRef.current;
        setData(corpusDerived.rows);
        setTotal(corpusDerived.total);
        setPage(p);
        if (p === 1 && summary) {
          setRegisterSummary(summary);
        }
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        setLastRefreshed(
          corpusStore?.lastSyncedAt ? new Date(corpusStore.lastSyncedAt) : new Date()
        );
        lastRegisterListQueryKeyRef.current = queryKey;
        lastKnownRegisterTotalRef.current = corpusDerived.total;
        registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
          data: corpusDerived.rows,
          total: corpusDerived.total,
          registerSummary: summary ?? undefined,
        });
        if (p === 1) {
          const page2 = deriveRegisterPageFromCorpus(
            callCorpusStore,
            corpusKey,
            viewFilters,
            2,
            limit,
            viewDateFilter
          );
          if (page2) {
            registerPageCachePut(registerPagesCacheRef.current, queryKey, 2, {
              data: page2.rows,
              total: page2.total,
              registerSummary: summary ?? undefined,
            });
          }
        }
        reportPerf('fetchData', 'corpus client slice HIT (no network)', opStart, {
          opId,
          page: p,
          rows: corpusDerived.rows.length,
          total: corpusDerived.total,
        });
        return;
      }

      const spanDays = corpusSpanDays(startDateStr, endDateStr);
      if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
        reportPerf('fetchData', 'corpus-only window — skip /api/report fallback', opStart, {
          opId,
          corpusCalls: callCorpusStore?.calls.size ?? 0,
          why: 'Date range is served from in-memory corpus; paginated SQL register is not used.',
        });
        if (!opts?.silent) {
          setLoading(false);
          setLoadingPage(null);
        }
        return;
      }
    }

    const controller = new AbortController();
    fetchControllerRef.current = controller;

    if (!opts?.silent) {
      setLoading(true);
      setLoadingPage(p);
    } else {
      setLoadingPage(null);
    }

    const appendRegisterFilters = (basePath: string) => {
      let u = basePath;
      if (searchForUrl) u += `&search=${encodeURIComponent(searchForUrl)}`;
      if (pincodeForUrl) u += `&pincode=${encodeURIComponent(pincodeForUrl)}`;
      if (!searchActive) {
        if (startDateStr) u += `&startDate=${startDateStr}`;
        if (endDateStr) u += `&endDate=${endDateStr}`;
        u += `&dateFilterColumn=${encodeURIComponent(dateFilterColumn)}`;
      }
      const stateParam = joinFilterParam(selectedState);
      const cityParam = joinFilterParam(selectedCity);
      const technicianParam = joinFilterParam(selectedTechnician);
      const statusParam = joinFilterParam(selectedStatus);
      const priorityParam = joinFilterParam(priorityFilter);
      const portalParam = joinFilterParam(portalFilter);
      if (stateParam) u += `&state=${encodeURIComponent(stateParam)}`;
      if (cityParam) u += `&city=${encodeURIComponent(cityParam)}`;
      const branchParam = joinFilterParam(selectedBranch);
      const franchiseeParam = joinFilterParam(selectedFranchisee);
      if (branchParam) u += `&branch=${encodeURIComponent(branchParam)}`;
      if (franchiseeParam) u += `&franchisee=${encodeURIComponent(franchiseeParam)}`;
      if (technicianParam) u += `&technician=${encodeURIComponent(technicianParam)}`;
      if (statusParam) u += `&status=${encodeURIComponent(statusParam)}`;
      if (priorityParam) u += `&priority=${encodeURIComponent(priorityParam)}`;
      if (portalParam) u += `&portalFilter=${encodeURIComponent(portalParam)}`;
      u += '&fetchFilterOptions=false';
      return u;
    };

    try {
      const tBeforeSession = performance.now();
      const { data: { session } } = await supabase.auth.getSession();
      const tAfterSession = performance.now();
      reportPerf('fetchData', 'supabase.getSession done', opStart, {
        opId,
        getSessionMs: Number((tAfterSession - tBeforeSession).toFixed(1)),
        why: 'Auth token for API Authorization header.',
      });
      const headers = {
        Authorization: `Bearer ${session?.access_token}`,
      };

      const prefetchAdjacentPages = (currentPage: number) => {
        const prefetchSessionStart = performance.now();
        reportPerf('prefetch', 'adjacent pages scheduled', prefetchSessionStart, {
          opId,
          centerPage: currentPage,
          why: 'Background GET for page±1 with fetchTotals=false to warm session cache.',
        });
        const totalSnap = lastKnownRegisterTotalRef.current;
        const storePrefetched = (
          pageNum: number,
          payload: { data?: any[]; total?: number },
          summary?: RegisterSummary | null
        ) => {
          const rows = payload.data || [];
          const tot =
            payload.total !== undefined && payload.total !== null ? payload.total : totalSnap;
          registerPageCachePut(registerPagesCacheRef.current, queryKey, pageNum, {
            data: rows,
            total: tot,
            registerSummary: summary,
          });
        };

        const maxPage = totalSnap > 0 ? Math.ceil(totalSnap / limit) : 1;
        const nextPage = currentPage + 1;
        if (nextPage <= maxPage) {
          const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
          const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
          const fromCorpus = deriveRegisterPageFromCorpus(
            callCorpusStore,
            corpusKey,
            registerViewFilterRef.current,
            nextPage,
            limit,
            viewDateFilter
          );
          if (fromCorpus) {
            storePrefetched(nextPage, { data: fromCorpus.rows, total: fromCorpus.total });
            return;
          }
          if (readRegisterFromPostgresClient()) {
            const scope = getSharedCallsForScope();
            if (scope) {
              const fromShared = deriveRegisterPageFromCalls(
                scope.calls,
                registerViewFilterRef.current,
                nextPage,
                limit,
                viewDateFilter
              );
              storePrefetched(nextPage, { data: fromShared.rows, total: fromShared.total });
              return;
            }
          }
          const nextUrl = appendRegisterFilters(
            `/api/report?page=${nextPage}&limit=${limit}&fetchTotals=false&officeId=${officeIdsParam}&callType=${viewCallTypesParam}`
          );
          axios
            .get(nextUrl, { headers, signal: controller.signal })
            .then((res) => {
              storePrefetched(nextPage, res.data);
              reportPerf('prefetch', `page ${nextPage} response stored`, prefetchSessionStart, {
                opId,
                rows: (res.data?.data || []).length,
                sincePrefetchScheduleMs: Number((performance.now() - prefetchSessionStart).toFixed(1)),
              });
            })
            .catch(() => {});
        }
      };

      let url = appendRegisterFilters(
        `/api/report?page=${p}&limit=${limit}&officeId=${officeIdsParam}&callType=${viewCallTypesParam}`
      );

      const newDate = new Date();

      if (p === 1) {
        const tBeforeRegister = performance.now();
        const regRes = await axios.get(url, { headers, signal: controller.signal });
        const tAfterRegister = performance.now();
        reportPerf('fetchData', 'network: /api/report (page 1) complete', opStart, {
          opId,
          registerRows: (regRes.data.data || []).length,
          axiosMs: Number((tAfterRegister - tBeforeRegister).toFixed(1)),
          why: 'Register-only fetch; summary tab data loaded lazily on tab switch.',
        });

        const regTotal = regRes.data.total ?? 0;
        lastKnownRegisterTotalRef.current = regTotal;

        const pageRows = regRes.data.data || [];
        indexRegisterRowsWithSerial(pageRows as Record<string, unknown>[]);

        setData(pageRows);
        setTotal(regTotal);
        setPage(p);
        setRegisterSummary(normalizeRegisterSummary(regRes.data.summary));

        if (regRes.data.statesList) setStatesList(regRes.data.statesList);
        if (regRes.data.citiesList) setCitiesList(regRes.data.citiesList);
        if (regRes.data.branchesList) setBranchesList(regRes.data.branchesList);
        if (regRes.data.franchiseesList) setFranchiseesList(regRes.data.franchiseesList);
        if (regRes.data.techniciansList) setTechniciansList(regRes.data.techniciansList);

        registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
          data: regRes.data.data,
          total: regTotal,
          registerSummary: regRes.data.summary || null,
          summaryData: globalReportCache?.summaryData,
          accountsData: globalReportCache?.accountsData,
          globalHeadcount: globalReportCache?.globalHeadcount,
        });

        setGlobalReportCache({
          data: regRes.data.data,
          summaryData: globalReportCache?.summaryData || summaryData,
          accountsData: globalReportCache?.accountsData || accountsData,
          globalHeadcount: globalReportCache?.globalHeadcount ?? globalHeadcount,
          total: regTotal,
          page: p,
          search: searchForUrl || '',
          pincodeSearch: pincodeForUrl || '',
          selectedOfficeIds,
          dateRange,
          dateFilterColumn,
          filterRegion,
          filterAccount,
          selectedCallTypes,
          registerSummary: regRes.data.summary || null,
          lastRefreshed: newDate,
          agingAsOf,
          selectedStatus,
          priorityFilter,
          portalFilter,
          selectedState,
          selectedCity,
          selectedBranch,
          selectedFranchisee,
          selectedTechnician,
        });

        persistCurrentCache(
          regRes.data.data,
          globalReportCache?.summaryData || summaryData,
          globalReportCache?.accountsData || accountsData,
          globalReportCache?.globalHeadcount ?? globalHeadcount,
          regTotal,
          regRes.data.summary || null,
          newDate
        );

        lastRegisterListQueryKeyRef.current = queryKey;
      } else {
        url += `&fetchTotals=false`;
        const tBeforePage = performance.now();
        const regRes = await axios.get(url, { headers, signal: controller.signal });
        const tAfterPage = performance.now();
        reportPerf('fetchData', 'network: /api/report (page>1, fetchTotals=false) complete', opStart, {
          opId,
          parallelAxiosMs: Number((tAfterPage - tBeforePage).toFixed(1)),
          registerRows: (regRes.data.data || []).length,
          why: 'Lighter query without full totals block; totals reused from lastKnownRegisterTotalRef when API omits total.',
        });
        const newChunk = regRes.data.data || [];
        indexRegisterRowsWithSerial(newChunk as Record<string, unknown>[]);
        const apiTotal = regRes.data.total;
        const effectiveTotal =
          apiTotal !== undefined && apiTotal !== null ? apiTotal : lastKnownRegisterTotalRef.current;

        if (apiTotal !== undefined && apiTotal !== null) {
          lastKnownRegisterTotalRef.current = apiTotal;
        }

        setData(newChunk);
        if (apiTotal !== undefined && apiTotal !== null) {
          setTotal(apiTotal);
        }
        setPage(p);
        if (regRes.data.summary !== undefined) {
          setRegisterSummary(normalizeRegisterSummary(regRes.data.summary));
        }

        registerPageCachePut(registerPagesCacheRef.current, queryKey, p, {
          data: newChunk,
          total: effectiveTotal,
          registerSummary: regRes.data.summary ?? null,
        });

        if (globalReportCache) {
          globalReportCache.data = newChunk;
          globalReportCache.total = effectiveTotal;
          globalReportCache.page = p;
          globalReportCache.registerSummary = regRes.data.summary ?? null;
          globalReportCache.lastRefreshed = newDate;
          globalReportCache.search = searchForUrl || '';
          globalReportCache.pincodeSearch = pincodeForUrl || '';

          if (distributionDataCache) {
            setDistributionDataCache({
              ...distributionDataCache,
              lastSyncedAt: newDate.getTime(),
            });
          }

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

      prefetchAdjacentPages(p);
    } catch (err: any) {
      if (axios.isCancel(err)) {
        reportPerf('fetchData', 'aborted (axios cancel)', opStart, {
          opId,
          why: 'AbortController: newer fetchData or navigation cancelled this request.',
        });
        return;
      }
      reportPerf('fetchData', 'request failed (error toast)', opStart, {
        opId,
        message: err?.message || String(err),
      });
      toast.error('Failed to fetch report data');
    } finally {
      const isActiveController = fetchControllerRef.current === controller;
      if (isActiveController) {
        if (!opts?.silent) {
          setLoading(false);
        }
        setLoadingPage(null);
        setLastRefreshed(new Date());
      }
      reportPerf('fetchData', isActiveController ? 'done (this request owned controller)' : 'done (superseded)', opStart, {
        opId,
        isActiveController,
        silent: !!opts?.silent,
        why: isActiveController
          ? 'Spinner cleared; last successful or failed path for this opId.'
          : 'Another fetchData replaced fetchControllerRef before finally ran.',
      });
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

  const isTransferred = (rec: any) => {
    return (rec.vtransfercallno && String(rec.vtransfercallno).trim() !== '') || String(rec.ncancelreason) === '2';
  };

  const isSolved = (rec: any) => {
    if (isRegisterRowCancelled(rec) || isTransferred(rec)) return false;
    const statusStr = String(rec.Status || rec.callstatus || '').toLowerCase();
    return String(rec.callsolved).toLowerCase() === 'true' || String(rec.callsolved) === '1' || statusStr === 'closed' || statusStr === 'solved';
  };

  const isCancelled = (rec: any) => {
    if (isTransferred(rec)) return false;
    return isRegisterRowCancelled(rec);
  };

  const isOpen = (rec: any) => {
    return !isSolved(rec) && !isCancelled(rec) && !isTransferred(rec);
  };

  const fetchDelta = async () => {
    await runBackgroundSync({ showToast: true });
  };

  const applyRegisterDeltaRecords = (newRecords: any[], syncTime: Date) => {
    setLastRefreshed(syncTime);
    if (globalReportCache) {
      globalReportCache.lastRefreshed = syncTime;
    }
    if (newRecords.length === 0) return;

    const filterCtx = registerViewFilterRef.current;
    const viewFiltered = isAnyFilterActive(filterCtx);
    const findRowIndex = (rows: any[], rec: any) =>
      rows.findIndex(
        (r) =>
          String(r.UniqueCallNo) === String(rec.UniqueCallNo) ||
          String(r.vcclid) === String(rec.vcclid)
      );

    const currentData = dataRef.current;
    const currentTotal = totalRef.current;
    const currentRegisterSummary = registerSummaryRef.current;
    const currentSummaryData = summaryDataRef.current;
    const currentAccountsData = accountsDataRef.current;
    const currentGlobalHeadcount = globalHeadcountRef.current;

    const updatedData = [...currentData];
    let newAddedCount = 0;
    let dataChanged = false;

    newRecords.forEach((newRec: any) => {
      const idx = findRowIndex(updatedData, newRec);
      if (idx > -1) {
        updatedData[idx] = newRec;
        dataChanged = true;
        return;
      }

      if (viewFiltered) {
        if (registerRowMatchesViewFilters(newRec, filterCtx)) {
          updatedData.unshift(newRec);
          newAddedCount++;
          dataChanged = true;
        }
        return;
      }

      updatedData.unshift(newRec);
      newAddedCount++;
      dataChanged = true;
    });

    if (!dataChanged) return;

    if (!viewFiltered) {
      updatedData.sort((a, b) => {
        const dateA = new Date(a.callsdtrndate || 0).getTime();
        const dateB = new Date(b.callsdtrndate || 0).getTime();
        return dateB - dateA;
      });
    }

    const recordsForSummary = viewFiltered
      ? newRecords.filter((rec) => findRowIndex(currentData, rec) > -1)
      : newRecords;

    if (viewFiltered) {
      setData(updatedData);
      return;
    }

    const nextSummaryData = [...currentSummaryData];
    recordsForSummary.forEach((newRec: any) => {
      if (isTransferred(newRec)) return;
      const branchRowIdx = nextSummaryData.findIndex(
        (b) =>
          b.officeId === newRec.nofficeid ||
          b.branch?.toLowerCase() === newRec.officename?.toLowerCase()
      );
      if (branchRowIdx > -1) {
        const row = { ...nextSummaryData[branchRowIdx] };
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          if (isSolved(oldRec)) row.solved_calls = Math.max(0, (row.solved_calls || 0) - 1);
          else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
          else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
        }
        if (isSolved(newRec)) row.solved_calls = (row.solved_calls || 0) + 1;
        else if (isCancelled(newRec)) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
        else if (isOpen(newRec)) row.open_calls = (row.open_calls || 0) + 1;
        nextSummaryData[branchRowIdx] = row;
      }
    });

    const nextAccountsData = [...currentAccountsData];
    recordsForSummary.forEach((newRec: any) => {
      if (isTransferred(newRec)) return;
      const accRowIdx = nextAccountsData.findIndex(
        (a) => a.account?.toLowerCase() === newRec.PartyName?.toLowerCase()
      );
      if (accRowIdx > -1) {
        const row = { ...nextAccountsData[accRowIdx] };
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          if (isSolved(oldRec)) row.total_solved = Math.max(0, (row.total_solved || 0) - 1);
          else if (isCancelled(oldRec)) row.cancelled_calls = Math.max(0, (row.cancelled_calls || 0) - 1);
          else if (isOpen(oldRec)) row.open_calls = Math.max(0, (row.open_calls || 0) - 1);
        }
        if (isSolved(newRec)) row.total_solved = (row.total_solved || 0) + 1;
        else if (isCancelled(newRec)) row.cancelled_calls = (row.cancelled_calls || 0) + 1;
        else if (isOpen(newRec)) row.open_calls = (row.open_calls || 0) + 1;
        nextAccountsData[accRowIdx] = row;
      }
    });

    let nextSummary = currentRegisterSummary ? { ...currentRegisterSummary } : null;
    if (nextSummary) {
      let newTotal = nextSummary.total;

      recordsForSummary.forEach((newRec: any) => {
        if (classifyRegisterRowStatus(newRec) === 'transferred') return;
        const oldRec = currentData.find(
          (r) =>
            String(r.UniqueCallNo) === String(newRec.UniqueCallNo) ||
            String(r.vcclid) === String(newRec.vcclid)
        );
        if (oldRec) {
          adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(oldRec), -1);
        } else {
          newTotal++;
        }

        adjustRegisterSummaryBucket(nextSummary!, classifyRegisterRowStatus(newRec), 1);
      });

      nextSummary = {
        ...nextSummary!,
        total: newTotal,
      };
    }

    const nextTotal = currentTotal + newAddedCount;
    setData(updatedData);
    setTotal(nextTotal);
    setRegisterSummary(nextSummary);
    setSummaryData(nextSummaryData);
    setAccountsData(nextAccountsData);
    registerPagesCacheRef.current.clear();

    if (globalReportCache) {
      globalReportCache.data = updatedData;
      globalReportCache.total = nextTotal;
      globalReportCache.registerSummary = nextSummary;
      globalReportCache.summaryData = nextSummaryData;
      globalReportCache.accountsData = nextAccountsData;
    }

    persistCurrentCache(
      updatedData,
      nextSummaryData,
      nextAccountsData,
      currentGlobalHeadcount,
      nextTotal,
      nextSummary,
      syncTime
    );
  };

  useEffect(() => {
    return subscribeRegisterDelta((records, syncTime) => {
      applyRegisterDeltaRecords(records as any[], syncTime);
    });
  }, []);

  useEffect(() => {
    if (lastSyncedAt) {
      setLastRefreshed(lastSyncedAt);
    }
  }, [lastSyncedAt]);

  const handleDrillDown = async (type: string, title: string, params: any) => {
    if (drillDownControllerRef.current) {
      drillDownControllerRef.current.abort();
    }
    const controller = new AbortController();
    drillDownControllerRef.current = controller;

    setDrillDown(prev => ({ ...prev, isOpen: true, loading: true, type, title, params, data: [], sql: '' }));
    const d0 = performance.now();
    reportPerf('drillDown', 'POST /api/report/drilldown start', d0, { type, title });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);
      const res = await axios.post('/api/report/drilldown', {
        type,
        callType: params.callType || viewCallTypesParam,
        ...params,
        startDate: startDateStr,
        endDate: endDateStr
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
      reportPerf('drillDown', 'POST /api/report/drilldown complete', d0, {
        rowCount: (res.data.data || []).length,
      });
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
    const q0 = performance.now();
    reportPerf('drillDown', 'custom SQL POST start', q0, { why: 'Ad-hoc drilldown from SQL editor.' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post('/api/report/drilldown', {
        customQuery: customSql
      }, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        signal: controller.signal
      });
      setDrillDown(prev => ({ ...prev, loading: false, data: res.data.data, sql: res.data.sql }));
      reportPerf('drillDown', 'custom SQL POST complete', q0, { rowCount: (res.data.data || []).length });
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
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);
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
      const i0 = performance.now();
      reportPerf('initDB', 'IndexedDB bootstrap start', i0, {
        why: 'Reads meta + optional cached calls so UI can paint before network; may schedule fetchDelta.',
      });
      try {
        const tBeforeMeta = performance.now();
        const cacheParams = await getMeta('cacheParams');
        reportPerf('initDB', 'getMeta(cacheParams) done', i0, {
          hasMeta: !!cacheParams,
          getMetaMs: Number((performance.now() - tBeforeMeta).toFixed(1)),
        });

        const startDateStr = toDateString(dateRange.start);
        const endDateStr = toDateString(dateRange.end);
        if (!readRegisterFromPostgresClient()) {
          const corpusMeta = await readCorpusMeta();
          const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
          if (corpusMeta?.cacheKey === corpusKey && (corpusMeta.callCount ?? 0) > 0) {
            const tBeforeCorpus = performance.now();
            const restored = await restoreCorpusFromIndexedDB(corpusKey);
            reportPerf('initDB', 'corpus IDB restore on reload', i0, {
              callCount: corpusMeta.callCount,
              restored: !!restored,
              restoreMs: Number((performance.now() - tBeforeCorpus).toFixed(1)),
            });
            if (restored) {
              const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
              const derived = deriveRegisterPageFromCorpus(
                restored,
                corpusKey,
                {
                  search: '',
                  pincodeSearch: '',
                  selectedState: [],
                  selectedCity: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                },
                1,
                10,
                viewDateFilter
              );
              if (derived) {
                const allFiltered = getFilteredCorpusCalls(
                  {
                    search: '',
                    pincodeSearch: '',
                    selectedState: [],
                    selectedCity: [],
                    selectedBranch: [],
                    selectedFranchisee: [],
                    selectedTechnician: [],
                    selectedCallTypes,
                    selectedOfficeIds,
                    selectedStatus: [],
                    priorityFilter: [],
                    portalFilter: [],
                  },
                  restored,
                  viewDateFilter
                );
                setData(derived.rows);
                setTotal(derived.total);
                setRegisterSummary(summarizeRegisterRows(allFiltered));
                setLastRefreshed(new Date(restored.lastSyncedAt));
                lastKnownRegisterTotalRef.current = derived.total;
                lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
                  officeIdsParam: registerOfficeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  searchForUrl: '',
                  pincodeForUrl: '',
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedState: [],
                  selectedCity: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                  agingAsOf: agingAsOf || '',
                });
                lastAppliedFilterSnapshotRef.current = JSON.stringify({
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedState: [],
                  selectedCity: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                  agingAsOf,
                  debouncedSearch: '',
                  debouncedPincodeSearch: '',
                });
                setGlobalReportCache({
                  data: derived.rows,
                  summaryData: [],
                  accountsData: [],
                  globalHeadcount: 0,
                  total: derived.total,
                  page: 1,
                  search: '',
                  pincodeSearch: '',
                  selectedOfficeIds,
                  dateRange,
                  dateFilterColumn,
                  filterRegion,
                  filterAccount,
                  selectedCallTypes,
                  registerSummary: summarizeRegisterRows(allFiltered),
                  lastRefreshed: new Date(restored.lastSyncedAt),
                  agingAsOf,
                  selectedStatus: [],
                  priorityFilter: [],
                  portalFilter: [],
                  selectedState: [],
                  selectedCity: [],
                  selectedBranch: [],
                  selectedFranchisee: [],
                  selectedTechnician: [],
                });
              }
            }
            setLoading(false);
            return;
          }

          if (cacheParams) {
          const officeIdsParam = summaryOfficeIdsParam;

          if (
            cacheParams.startDate === startDateStr &&
            cacheParams.endDate === endDateStr &&
            (cacheParams.dateFilterColumn || 'dtrndate') === dateFilterColumn &&
            cacheParams.officeIds === officeIdsParam &&
            cacheParams.callTypes === viewCallTypesParam
          ) {
            const hydrateFromIdb = async () => {
              const tBeforeCalls = performance.now();
              const cachedCalls = await getCallsFromDB();
              reportPerf('initDB', 'getCallsFromDB done (deferred)', i0, {
                rowCount: cachedCalls?.length ?? 0,
                getCallsMs: Number((performance.now() - tBeforeCalls).toFixed(1)),
              });
              if (!cachedCalls?.length) return;
              setData(cachedCalls);
              setSummaryData(cacheParams.summaryData || []);
              setAccountsData(cacheParams.accountsData || []);
              setGlobalHeadcount(cacheParams.globalHeadcount || 0);
              setTotal(cacheParams.total || 0);
              setRegisterSummary(cacheParams.registerSummary || null);
              
              const refreshedDate = new Date(cacheParams.lastRefreshed);
              setLastRefreshed(refreshedDate);

              setGlobalReportCache({
                data: cachedCalls,
                summaryData: cacheParams.summaryData || [],
                accountsData: cacheParams.accountsData || [],
                globalHeadcount: cacheParams.globalHeadcount || 0,
                total: cacheParams.total || 0,
                page: 1,
                search: '',
                pincodeSearch: '',
                selectedOfficeIds,
                dateRange,
                dateFilterColumn: resolveRegisterDateSqlColumn(cacheParams.dateFilterColumn),
                filterRegion,
                filterAccount,
                selectedCallTypes,
                registerSummary: cacheParams.registerSummary || null,
                lastRefreshed: refreshedDate,
                agingAsOf,
                selectedStatus: [],
                priorityFilter: [],
                portalFilter: [],
                selectedState: [],
                selectedCity: [],
                selectedBranch: [],
                selectedFranchisee: [],
                selectedTechnician: [],
                summaryQueryKey: cacheParams.summaryQueryKey,
              });

              if (cacheParams.summaryQueryKey) {
                lastSummaryQueryKeyRef.current = cacheParams.summaryQueryKey;
              } else if (cacheParams.summaryData?.length) {
                const agingStr =
                  agingAsOf.includes(' ') || agingAsOf.includes(':')
                    ? new Date(agingAsOf).toISOString().split('T')[0]
                    : agingAsOf;
                lastSummaryQueryKeyRef.current = buildSummaryQueryKey({
                  officeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  startDateStr,
                  endDateStr,
                  agingAsOf: agingStr,
                });
              }

              lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
                officeIdsParam,
                callTypesParam: viewCallTypesParam,
                searchForUrl: '',
                pincodeForUrl: '',
                startDateStr,
                endDateStr,
                dateFilterColumn,
                selectedState: [],
                selectedCity: [],
                selectedBranch: [],
                selectedFranchisee: [],
                selectedTechnician: [],
                selectedStatus: [],
                priorityFilter: [],
                portalFilter: [],
                agingAsOf: agingAsOf || '',
              });

              lastKnownRegisterTotalRef.current = cacheParams.total || 0;

              // Let the UI render the loaded cache first
              setLoading(false);
            };
            window.setTimeout(() => {
              void hydrateFromIdb();
            }, 0);
          }
        }
        }
      } catch (err) {
        console.error('Error initializing cache from IndexedDB:', err);
        reportPerf('initDB', 'error', i0, { err: String(err) });
      } finally {
        setDbInitialized(true);
        reportPerf('initDB', 'dbInitialized=true (filter effect can run)', i0, {
          why: 'Gate removed: auto-fetch-on-filter useEffect waits for this flag.',
        });
      }
    };
    initDBAndCache();
  }, []);

  // Automatically fetch data when filters change, but skip the first fetch if the cache is already present and matches the filters
  useEffect(() => {
    const t0 = performance.now();
    if (!dbInitialized) {
      return;
    }
    const changedFields: string[] = [];
    if (!globalReportCache) changedFields.push('no_globalReportCache');
    else {
      if (globalReportCache.dateRange.start.getTime() !== dateRange.start.getTime()) changedFields.push('dateRange.start');
      if (globalReportCache.dateRange.end.getTime() !== dateRange.end.getTime()) changedFields.push('dateRange.end');
      if ((globalReportCache.dateFilterColumn || 'dtrndate') !== dateFilterColumn) changedFields.push('dateFilterColumn');
      if (!filtersEqual(globalReportCache.selectedCallTypes, selectedCallTypes)) changedFields.push('callTypes');
      if (!filtersEqual(globalReportCache.selectedOfficeIds, selectedOfficeIds)) changedFields.push('officeIds');
      if (!filtersEqual(migrateStringFilter(globalReportCache.selectedState), selectedState)) changedFields.push('state');
      if (!filtersEqual(migrateStringFilter(globalReportCache.selectedCity), selectedCity)) changedFields.push('city');
      if (!filtersEqual(migrateStringFilter(globalReportCache.selectedBranch), selectedBranch)) changedFields.push('branch');
      if (!filtersEqual(migrateStringFilter(globalReportCache.selectedFranchisee), selectedFranchisee)) changedFields.push('franchisee');
      if (!filtersEqual(globalReportCache.selectedTechnician, selectedTechnician)) changedFields.push('technician');
      if (!filtersEqual(globalReportCache.selectedStatus, selectedStatus)) changedFields.push('status');
      if (!filtersEqual(globalReportCache.priorityFilter, priorityFilter)) changedFields.push('priorityFilter');
      if (!filtersEqual(globalReportCache.portalFilter, portalFilter)) changedFields.push('portalFilter');
      if (globalReportCache.agingAsOf !== agingAsOf) changedFields.push('agingAsOf');
      if ((globalReportCache.search || '') !== (debouncedSearch || '')) changedFields.push('debouncedSearch');
      if ((globalReportCache.pincodeSearch || '') !== (debouncedPincodeSearch || '')) changedFields.push('debouncedPincode');
    }
    const filtersChanged = changedFields.length > 0;
    const searchOrPinActive = !!(debouncedSearch?.trim() || debouncedPincodeSearch?.trim());
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    const filterSnapshot = JSON.stringify({
      startDateStr,
      endDateStr,
      dateFilterColumn,
      selectedCallTypes,
      selectedOfficeIds,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      agingAsOf,
      debouncedSearch: debouncedSearch || '',
      debouncedPincodeSearch: debouncedPincodeSearch || '',
    });
    const prevScopeKey = globalReportCache
      ? buildCorpusCacheKey(
          toDateString(globalReportCache.dateRange.start),
          toDateString(globalReportCache.dateRange.end),
          globalReportCache.dateFilterColumn || 'dtrndate'
        )
      : null;
    const currentScopeKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
    const corpusFetchScopeChanged =
      changedFields.includes('no_globalReportCache') ||
      !prevScopeKey ||
      prevScopeKey !== currentScopeKey;
    const fetchOpts = {
      skipCache: corpusFetchScopeChanged || searchOrPinActive,
      searchOverride: debouncedSearch,
      pincodeOverride: debouncedPincodeSearch,
    };

    if (filtersChanged) {
      if (filterSnapshot === lastAppliedFilterSnapshotRef.current || filterEffectInFlightRef.current) {
        return;
      }
      filterEffectInFlightRef.current = true;

      reportPerf('filterEffect', 'filters changed → clear page cache + setPage(1) + fetchData(1)', t0, {
        changedFields,
        why: 'Compared last successful fetch snapshot (globalReportCache) to current UI/debounced state.',
      });
      registerPagesCacheRef.current.clear();
      if (page !== 1) {
        setPage(1);
      }
      if (clearFiltersRef.current) {
        clearFiltersRef.current = false;
      }

      setFilterUpdating(true);

      if (searchOrPinActive) {
        void fetchData(1, fetchOpts).finally(() => {
          filterEffectInFlightRef.current = false;
          lastAppliedFilterSnapshotRef.current = filterSnapshot;
          setFilterUpdating(false);
        });
        return;
      }

      void (async () => {
        try {
          if (readRegisterFromPostgresClient()) {
            if (!getSharedCallsForScope()) {
              await ensureSharedCallsLoaded(false);
            }
            if (applyRegisterFromSharedCalls(1)) {
              lastAppliedFilterSnapshotRef.current = filterSnapshot;
              return;
            }
            await fetchData(1, fetchOpts);
            lastAppliedFilterSnapshotRef.current = filterSnapshot;
            return;
          }

          const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
          const hasCorpus =
            (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) ||
            corpusStoreCoversFetchScope(callCorpusStore, startDateStr, endDateStr, dateFilterColumn);

          if (!hasCorpus) {
            await ensureCorpusLoaded({ silent: false, force: false });
          }
          await ensurePortalAuditCache(supabase);
          applyRegisterFromCorpus(1);
          if (activeTab === 'summary' || activeTab === 'accounts') {
            applySummaryFromCorpus();
          }
          if (corpusSpanDays(startDateStr, endDateStr) > MAX_CLIENT_CORPUS_DAYS) {
            await fetchData(1, fetchOpts);
          }
          lastAppliedFilterSnapshotRef.current = filterSnapshot;
        } finally {
          filterEffectInFlightRef.current = false;
          setFilterUpdating(false);
        }
      })();
      return;
    } else if (
      searchOrPinActive &&
      lastRegisterListQueryKeyRef.current === null
    ) {
      reportPerf('filterEffect', 'search active but never fetched → fetchData(1, skipCache)', t0, {
        search: debouncedSearch,
        pincode: debouncedPincodeSearch,
        why: 'globalReportCache.search matched UI but no successful register fetch recorded for this query.',
      });
      registerPagesCacheRef.current.clear();
      setPage(1);
      fetchData(1, fetchOpts);
    } else {
      reportPerf('filterEffect', 'no fetch (cache matches UI)', t0, {
        why: 'globalReportCache aligns with current filters; avoids redundant /api/report.',
      });
    }
  }, [
    dbInitialized,
    dateRange,
    dateFilterColumn,
    filterAccount,
    selectedCallTypes,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus,
    priorityFilter,
    portalFilter,
    agingAsOf,
    debouncedSearch,
    debouncedPincodeSearch,
    activeTab,
    page,
    applyRegisterFromCorpus,
    applyRegisterFromSharedCalls,
    applySummaryFromCorpus,
    ensureCorpusLoaded,
    ensureSharedCallsLoaded,
    getSharedCallsForScope,
    supabase,
  ]);

  useEffect(() => {
    if (!dbInitialized || lastRegisterListQueryKeyRef.current) return;
    if (debouncedSearch?.trim() || debouncedPincodeSearch?.trim()) return;
    if (!globalReportCache) return;

    const officeIdsParam = summaryOfficeIdsParam;
    const startDateStr =
      toDateString(dateRange.start);
    const endDateStr =
      toDateString(dateRange.end);

    lastRegisterListQueryKeyRef.current = buildRegisterListQueryKey({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: '',
      pincodeForUrl: '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      agingAsOf: agingAsOf || '',
    });
  }, [
    dbInitialized,
    debouncedSearch,
    debouncedPincodeSearch,
    dateRange,
    dateFilterColumn,
    selectedOfficeIds,
    selectedCallTypes,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus,
    priorityFilter,
    portalFilter,
    agingAsOf,
  ]);

  useEffect(() => {
    if (!dbInitialized) return;
    if (activeTab !== 'summary' && activeTab !== 'accounts') return;

    hydrateSummaryFromCache();

    void (async () => {
      const startDateStr =
        toDateString(dateRange.start);
      const endDateStr =
        toDateString(dateRange.end);

      if (readSummaryFromPostgresClient()) {
        await fetchSummaryFromApi();
        return;
      }

      const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
      const hasCorpus =
        callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0;

      if (!hasCorpus) {
        await ensureCorpusLoaded({ silent: true });
      }
      if (applySummaryFromCorpus()) return;
      await fetchSummaryFromApi();
    })();
  }, [
    dbInitialized,
    activeTab,
    viewCallTypesParam,
    selectedBranch,
    selectedFranchisee,
    dateRange.start,
    dateRange.end,
    dateFilterColumn,
    agingAsOf,
    corpusTick,
    applySummaryFromCorpus,
    fetchSummaryFromApi,
    ensureCorpusLoaded,
  ]);

  useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort();
      drillDownControllerRef.current?.abort();
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t0 = performance.now();
    reportPerf('searchForm', 'submit (skipCache, raw search+pincode)', t0, {
      why: 'Bypasses debounce and session cache for explicit search.',
    });
    fetchData(1, {
      searchOverride: search,
      pincodeOverride: pincodeSearch,
      skipCache: true,
    });
  };

  const getRegisterExportAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Unauthorized');
    return { Authorization: `Bearer ${token}` };
  }, [supabase]);

  const refreshRegisterExportAuth = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      throw new Error('Unauthorized');
    }
  }, [supabase]);

  const buildCurrentRegisterQueryKey = useCallback(() => {
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    return buildRegisterListQueryKey({
      officeIdsParam: registerOfficeIdsParam,
      callTypesParam: viewCallTypesParam,
      searchForUrl: debouncedSearch || '',
      pincodeForUrl: debouncedPincodeSearch || '',
      startDateStr,
      endDateStr,
      dateFilterColumn,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedTechnician,
      selectedStatus,
      priorityFilter,
      portalFilter,
      agingAsOf: agingAsOf || '',
    });
  }, [
    dateRange.start,
    dateRange.end,
    dateFilterColumn,
    debouncedSearch,
    debouncedPincodeSearch,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus,
    priorityFilter,
    portalFilter,
    agingAsOf,
    viewCallTypesParam,
  ]);

  const handleExportDetailed = async (format: 'excel' | 'csv' = 'excel') => {
    cancelRegisterExport();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportingDetailed(true);
    setExportProgress(null);
    try {
      await supabase.auth.refreshSession();
      const startDateStr = toDateString(dateRange.start);
      const endDateStr = toDateString(dateRange.end);
      const exportQuery = {
        officeId: summaryOfficeIdsParam,
        callType: viewCallTypesParam,
        startDate: startDateStr,
        endDate: endDateStr,
        dateFilterColumn,
        search: debouncedSearch || undefined,
        pincode: debouncedPincodeSearch || undefined,
        state: joinFilterParam(selectedState),
        city: joinFilterParam(selectedCity),
        branch: joinFilterParam(selectedBranch),
        franchisee: joinFilterParam(selectedFranchisee),
        technician: joinFilterParam(selectedTechnician),
        status: joinFilterParam(selectedStatus),
        priority: joinFilterParam(priorityFilter),
        portalFilter: joinFilterParam(portalFilter),
        account: activeTab === 'accounts' ? joinFilterParam(filterAccount) : undefined,
        region:
          activeTab === 'accounts' && filterRegion.length
            ? filterRegion.join(',')
            : undefined,
      };

      if (format === 'csv') {
        await downloadRegisterCsvFromServer({
          getAuthHeaders: getRegisterExportAuthHeaders,
          refreshAuth: refreshRegisterExportAuth,
          knownTotal: total,
          signal: controller.signal,
          onProgress: (fetched, exportTotal) => {
            setExportProgress({ fetched, total: exportTotal });
          },
          query: exportQuery,
        });
        return;
      }

      const rawData = await fetchAllRegisterRowsForExport({
        getAuthHeaders: getRegisterExportAuthHeaders,
        refreshAuth: refreshRegisterExportAuth,
        knownTotal: total,
        signal: controller.signal,
        onProgress: (fetched, exportTotal) => {
          setExportProgress({ fetched, total: exportTotal });
        },
        query: exportQuery,
      });

      if (rawData.length === 0) {
        alert("No data to export");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Detailed Breakdown');
      const fileName = `WRL_Detailed_Breakdown_${new Date().toISOString().split('T')[0]}.xlsx`;

      sheet.columns = [
        { header: 'ID', key: 'id', width: 15 },
        { header: 'Call Centre ID', key: 'vcclid', width: 15 },
        { header: 'Call Type', key: 'type', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Franchisee', key: 'franchisee', width: 20 },
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
        const isCancelled = isRegisterRowCancelled(row);
        const isSolved =
          !isCancelled &&
          (row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True' || row.callsolved === '1');
        const isAssigned =
          !isCancelled &&
          !isSolved &&
          (row.Status === 'Assigned' || row.callstatus === 'Assigned');
        const statusText = isCancelled
          ? 'Cancelled'
          : row.Status === 'UNKNOWN'
            ? 'PENDING'
            : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          id: row.UniqueCallNo,
          vcclid: row.vcclid ?? '—',
          type: row.calltype,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          branch: row.officename ?? row.resolved_branch_name ?? '—',
          franchisee:
            row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '—',
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

      const buffer = await workbook.xlsx.writeBuffer();
      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const blob = new Blob([buffer], { type: mimeType });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

    } catch (err) {
      if (isRegisterExportAbortError(err)) return;
      console.error("Failed to export detailed breakdown:", err);
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Export failed';
      alert(`Failed to export detailed breakdown: ${message}`);
    } finally {
      if (exportAbortRef.current === controller) {
        exportAbortRef.current = null;
      }
      setExportingDetailed(false);
      setExportProgress(null);
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
        { header: 'Call Centre ID', key: 'vcclid', width: 15 },
        { header: 'Call Type', key: 'type', width: 15 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Customer', key: 'customer', width: 30 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Franchisee', key: 'franchisee', width: 20 },
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

      let exportData: Record<string, unknown>[] = data;
      const needsFullFetch = total > limit || data.length < total;
      if (needsFullFetch) {
        cancelRegisterExport();
        const controller = new AbortController();
        exportAbortRef.current = controller;
        setExportingDetailed(true);
        setExportProgress(null);
        try {
          const startDateStr = toDateString(dateRange.start);
          const endDateStr = toDateString(dateRange.end);
          const queryKey = buildCurrentRegisterQueryKey();

          const cachedAllPages = collectRegisterRowsFromSessionCache(
            registerPagesCacheRef.current,
            queryKey,
            total,
            limit
          );
          if (cachedAllPages?.length) {
            exportData = cachedAllPages;
          }

          if (!readRegisterFromPostgresClient() && exportData.length < total) {
            const spanDays = corpusSpanDays(startDateStr, endDateStr);
            if (spanDays <= MAX_CLIENT_CORPUS_DAYS) {
              const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
              if (callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0) {
                const viewDateFilter = buildCorpusViewDateFilter(
                  startDateStr,
                  endDateStr,
                  dateFilterColumn
                );
                exportData = getFilteredCorpusCalls(
                  registerViewFilterRef.current,
                  callCorpusStore,
                  viewDateFilter
                );
              }
            }
          }

            if (exportData.length < total) {
              const exportQuery = {
                officeId: summaryOfficeIdsParam,
                callType: viewCallTypesParam,
                startDate: startDateStr,
                endDate: endDateStr,
                dateFilterColumn,
                search: debouncedSearch || undefined,
                pincode: debouncedPincodeSearch || undefined,
                state: joinFilterParam(selectedState),
                city: joinFilterParam(selectedCity),
                branch: joinFilterParam(selectedBranch),
                franchisee: joinFilterParam(selectedFranchisee),
                technician: joinFilterParam(selectedTechnician),
                status: joinFilterParam(selectedStatus),
                priority: joinFilterParam(priorityFilter),
                portalFilter: joinFilterParam(portalFilter),
              };

              toast.info(
                `Register shows ${limit} rows per page — exporting all ${total.toLocaleString()} matching rows as CSV…`
              );
              await supabase.auth.refreshSession();
              await downloadRegisterCsvFromServer({
                getAuthHeaders: getRegisterExportAuthHeaders,
                refreshAuth: refreshRegisterExportAuth,
                knownTotal: total,
                signal: controller.signal,
                onProgress: (fetched, exportTotal) => {
                  setExportProgress({ fetched, total: exportTotal });
                },
                query: exportQuery,
              });
              return;
            }
        } catch (err) {
          if (isRegisterExportAbortError(err)) return;
          console.error('Full register export fetch failed:', err);
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Export failed';
          alert(`Failed to export register: ${message}`);
          return;
        } finally {
          if (exportAbortRef.current === controller) {
            exportAbortRef.current = null;
          }
          setExportingDetailed(false);
          setExportProgress(null);
        }
      }

      if (!exportData.length) {
        alert('No data to export');
        return;
      }

      exportData.forEach((row: any) => {
        const isCancelled = isRegisterRowCancelled(row);
        const isSolved =
          !isCancelled &&
          (row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True' || row.callsolved === '1');
        const isAssigned =
          !isCancelled &&
          !isSolved &&
          (row.Status === 'Assigned' || row.callstatus === 'Assigned');
        const statusText = isCancelled
          ? 'Cancelled'
          : row.Status === 'UNKNOWN'
            ? 'PENDING'
            : (row.Status || row.callstatus || 'OPEN');

        const r = sheet.addRow({
          id: row.UniqueCallNo,
          vcclid: row.vcclid ?? '—',
          type: row.calltype,
          date: formatDate(row.callsdtrndate),
          customer: row.PartyName,
          branch: row.officename ?? row.resolved_branch_name ?? '—',
          franchisee:
            row.franchisee_name && row.franchisee_name !== 'Unallocated' ? row.franchisee_name : '—',
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
        statusCell.font = {
          bold: true,
          color: { argb: isCancelled ? 'FFDC2626' : isSolved ? 'FF059669' : isAssigned ? 'FF1D4ED8' : 'FF64748B' },
        };
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
      const regHeader = sheet.addRow(['Region', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(regHeader);

      regions.forEach(region => {
        const rb = summaryData.filter(b => b.region === region);
        const t = rb.reduce((acc, b) => ({
          t: acc.t + Number(b.total_calls || 0), s: acc.s + Number(b.solved_calls || 0), c: acc.c + Number(b.cancelled_calls || 0), o: acc.o + Number(b.open_calls || 0),
          a2: acc.a2 + Number(b.age_2 || 0), a3: acc.a3 + Number(b.age_3 || 0), a7: acc.a7 + Number(b.age_7 || 0), a15: acc.a15 + Number(b.age_15 || 0),
          p: acc.p + Number(b.part_pending || 0), e: acc.e + Number(b.active_eng || 0)
        }), { t: 0, s: 0, c: 0, o: 0, a2: 0, a3: 0, a7: 0, a15: 0, p: 0, e: 0 });

        const r = sheet.addRow([region, t.t, t.s, t.c, t.o, t.a2, t.a3, t.a7, t.a15, t.p, t.e]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(3).font = { color: { argb: 'FF059669' } };
        r.getCell(4).font = { color: { argb: 'FFDC2626' } };
        r.getCell(5).font = { bold: true };
      });

      // AI Total
      const aiRow = sheet.addRow([
        'AI TOTAL',
        summaryData.reduce((s, b) => s + Number(b.total_calls || 0), 0),
        summaryData.reduce((s, b) => s + Number(b.solved_calls || 0), 0),
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
      const brHeader = sheet.addRow(['Branch', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(brHeader);

      topLevelBranches
        .sort((a, b) => a.region.localeCompare(b.region))
        .forEach(b => {
          const rb = summaryData.filter(x => x.region === b.region);
          const r = sheet.addRow([
            b.branch,
            getAggregate(b, 'total_calls', rb),
            getAggregate(b, 'solved_calls', rb),
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
          r.getCell(4).font = { color: { argb: 'FFDC2626' } };
          r.getCell(5).font = { bold: true };
        });

    } else {
      // Key Account MIS
      const filtered = accountsData.filter(a => {
        const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
        const matchAccount = filterAccount.length === 0 || filterAccount.includes(a.account);
        return matchRegion && matchAccount;
      }).sort((a, b) => a.region.localeCompare(b.region));

      const kaHeader = sheet.addRow(['Region', 'Account', 'Population', 'Total', 'Solved', 'Cancelled', 'Open', '<2 Days', '2-7 Days', '7-15 Days', '>15 Days', 'Parts', 'Engineers']);
      applyHeaderStyle(kaHeader);

      filtered.forEach(a => {
        const openCalls = Number(a.age_2 || 0) + Number(a.age_3 || 0) + Number(a.age_7 || 0) + Number(a.age_15 || 0);
        const r = sheet.addRow([
          a.region, a.account, a.population || 0, a.total_calls, a.total_solved, a.cancelled_calls, openCalls,
          a.age_2, a.age_3, a.age_7, a.age_15, a.part_pending, a.active_eng
        ]);
        r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: getRegionColor(a.region) } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        r.getCell(5).font = { color: { argb: 'FF059669' } };
        r.getCell(6).font = { color: { argb: 'FFDC2626' } };
        r.getCell(7).font = { bold: true };
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
    let total = 0;
    let solved = 0;
    let open = 0;
    let cancelled = 0;

    localFilteredData.forEach(row => {
      const isTransferred = (row.vtransfercallno && row.vtransfercallno !== '') || row.cancel_reason?.includes('Transfer');
      if (isTransferred) return;

      total++;
      const isCancelled = isRegisterRowCancelled(row);
      const isSolved =
        !isCancelled &&
        (row.Status === 'Closed' || row.callstatus === 'Solved' || row.callsolved === 'True' || row.callsolved === '1');

      if (isCancelled) cancelled++;
      else if (isSolved) solved++;
      else open++;
    });

    return { total, solved, open, cancelled };
  }, [localFilteredData]);


  if (!mounted) {
    return <div className="flex h-full min-h-0 flex-1 flex-col bg-white" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white text-slate-900">
      {/* Page Header / Controls — h-14 matches sidebar header */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-6">
          <div className="flex">
            {[
              { id: 'register', label: 'Call Register' },
              { id: 'summary', label: 'Summary Dashboard' },
              { id: 'accounts', label: 'Key Account MIS' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  const nextTab = tab.id as 'register' | 'summary' | 'accounts';
                  if (nextTab === 'summary' || nextTab === 'accounts') {
                    hydrateSummaryFromCache();
                  }
                  setActiveTab(nextTab);
                }}
                className={`relative flex h-14 items-center px-3 text-xs font-medium transition-all ${activeTab === tab.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600' }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {lastRefreshed && (
            <span
              className="text-[10px] text-slate-400 font-medium"
              title={`Last refreshed: ${lastRefreshed.toLocaleString()}`}
            >
              {formatRelativeTime(lastRefreshed)}
            </span>
          )}
          {filterUpdating && (
            <span className="text-[10px] font-medium text-blue-600 animate-pulse">
              Updating filters…
            </span>
          )}
          {(activeTab === 'summary' || activeTab === 'accounts') &&
            (syncInProgress || corpusLoading || filterUpdating) && (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              title="Updating summary from corpus"
            />
          )}
          <button
            onClick={() => {
              const t0 = performance.now();
              reportPerf('ui', 'Sync button → fetchDelta()', t0, {
                why: 'Incremental lastSync poll; see fetchDelta logs.',
              });
              fetchDelta();
            }}
            disabled={syncInProgress}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50"
            title="Sync now (manual refresh from server)"
          >
            <div className={`${syncInProgress ? 'animate-spin' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
            </div>
          </button>
          <button
            onClick={() => {
              if (exportingDetailed) {
                cancelRegisterExport();
                toast.info('Export cancelled');
                return;
              }
              void handleExport('excel');
            }}
            disabled={false}
            className="flex items-center gap-2 bg-white text-slate-900 px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
            title={
              exportingDetailed
                ? exportProgress && exportProgress.total > 0
                  ? `Exporting ${exportProgress.fetched.toLocaleString()} / ${exportProgress.total.toLocaleString()} — click to cancel`
                  : 'Export in progress — click to cancel'
                : 'Export filtered register to Excel'
            }
          >
            <FileSpreadsheet size={14} className={exportingDetailed ? 'animate-pulse text-amber-600' : 'text-emerald-600'} />
            {exportingDetailed
              ? exportProgress && exportProgress.total > 0
                ? `Exporting ${Math.min(100, Math.round((exportProgress.fetched / exportProgress.total) * 100))}%`
                : 'Exporting…'
              : 'Export'}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setHeaderMenuOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-all hover:bg-slate-50"
              title="More actions"
            >
              <MoreVertical size={14} />
            </button>
            {headerMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHeaderMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      const t0 = performance.now();
                      reportPerf('ui', 'Full Reload → fetchData(1, skipCache)', t0, {
                        why: 'Forces network + summary; ignores session page cache.',
                      });
                      fetchData(1, { skipCache: true });
                    }}
                    disabled={loading}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Full reload
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {exportingDetailed && (
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            <span className="font-medium">
              {exportProgress && exportProgress.total > 0
                ? `Exporting ${exportProgress.fetched.toLocaleString()} / ${exportProgress.total.toLocaleString()} rows (${Math.min(100, Math.round((exportProgress.fetched / exportProgress.total) * 100))}%)`
                : 'Preparing export…'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              cancelRegisterExport();
              toast.info('Export cancelled');
            }}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-amber-100"
          >
            Cancel export
          </button>
        </div>
      )}

      {/* Control Bar */}
      {activeTab === 'register' ? (
        <RegisterPageFilters
          summary={registerSummary}
          loading={loading}
          loadingLabel="Loading call register…"
          onSearchEnter={() => fetchData(1, { searchOverride: search, skipCache: true })}
          onPincodeEnter={() => fetchData(1, { pincodeOverride: pincodeSearch, skipCache: true })}
          onClearAll={() => { clearFiltersRef.current = true; }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          {/* Call Type Filter — summary / accounts tabs */}
          <div className="relative">
            <button
              onClick={() => {
                if (!showCallTypeDropdown) setTempSelectedCallTypes(selectedCallTypes);
                setShowCallTypeDropdown(!showCallTypeDropdown);
              }}
              className="register-filter-btn max-w-[11rem]"
            >
              <span className="truncate">{callTypeFilterLabel}</span>
              <ChevronDown size={14} className={`transition-transform duration-200 ${showCallTypeDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showCallTypeDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCallTypeDropdown(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-2">
                    <span className="text-[10px] text-slate-500 ui-label">Select Call Type</span>
                    <button onClick={() => setTempSelectedCallTypes([])} className="rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-white hover:text-slate-900 ui-label">Clear All</button>
                  </div>
                  <div className="custom-scrollbar max-h-72 overflow-y-auto p-1">
                    {callTypes.map((type) => {
                      const isSelected = tempSelectedCallTypes.includes(type);
                      return (
                        <label key={type} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 transition-colors hover:bg-slate-50">
                          <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900" checked={isSelected} onChange={(e) => {
                            if (e.target.checked) setTempSelectedCallTypes((prev) => [...prev, type]);
                            else setTempSelectedCallTypes((prev) => prev.filter((t) => t !== type));
                          }} />
                          <span className={`text-[11px] font-medium ${isSelected ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{type}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex justify-end border-t border-slate-100 bg-slate-50 p-2">
                    <button
                      onClick={() => {
                        setSelectedCallTypes(tempSelectedCallTypes);
                        setShowCallTypeDropdown(false);
                      }}
                      className="rounded bg-slate-900 px-4 py-1 text-[10px] text-white hover:bg-slate-800 ui-label"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <RegisterBranchFranchiseeFilters />
          <DateRangeSelector value={dateRange.label} startDate={dateRange.start} endDate={dateRange.end} onChange={(range) => setDateRange(range)} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] whitespace-nowrap text-amber-600 ui-label">Aging As Of</span>
            <input
              type="date"
              className="register-filter-select w-auto bg-amber-50/80 text-amber-900"
              value={agingAsOf}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setAgingAsOf(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {(activeTab === 'register' && (loading || filterUpdating)) && (
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
          <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
            <div className="register-table-meta">
              <span className="text-[11px] font-medium text-slate-700">
                {total.toLocaleString()} {total === 1 ? 'call' : 'calls'}
              </span>
              <RegisterColumnPicker
                visibleColumns={visibleRegisterColumns}
                onChange={setVisibleRegisterColumns}
              />
            </div>
            <div className="register-table-wrap inner-scrollbar">
              <table className="register-table">
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="register-table-sticky-col register-table-sticky-col-1 border-r border-slate-100 px-2 py-2.5 text-center text-[11px] font-medium whitespace-nowrap text-slate-500">#</th>
                  {visibleRegisterColumnDefs.map((col, colIdx) => (
                    <th
                      key={col.key}
                      className={`border-r border-slate-100 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap text-slate-500 ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {displayedData.length > 0 ? displayedData.map((row, idx) => (
                  <tr key={idx} className="transition-colors hover:bg-slate-50/50">
                    <td className="register-table-sticky-col register-table-sticky-col-1 whitespace-nowrap border-r border-slate-50 px-2 py-2 text-center text-[11px] text-slate-400">
                      {(page - 1) * limit + idx + 1}
                    </td>
                    {visibleRegisterColumnDefs.map((col, colIdx) => (
                      <td
                        key={col.key}
                        className={`${getRegisterCellClassName(col.key)} ${colIdx === 0 ? 'register-table-sticky-col register-table-sticky-col-2' : ''}`}
                      >
                        {renderRegisterCell(col.key, row)}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={visibleRegisterColumnDefs.length + 1} className="register-table-empty">
                      <p className="text-sm font-medium text-slate-700">No calls match your filters</p>
                      {isAnyRegisterFilterActive && (
                        <button
                          type="button"
                          onClick={() => { clearFiltersRef.current = true; clearAllFilters(); }}
                          className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination Controls */}
          <div className="flex h-11 flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span className="font-medium text-slate-700">
                {data.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} of {total.toLocaleString()}
              </span>
            </div>
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
              
              <div className="flex items-center gap-1 mx-2">
                {(() => {
                  const totalPages = Math.max(1, Math.ceil(total / limit));
                  const pages = [];
                  const windowSize = 2;

                  pages.push(1);
                  if (page > windowSize + 2) pages.push('...');
                  
                  const start = Math.max(2, page - windowSize);
                  const end = Math.min(totalPages - 1, page + windowSize);
                  for (let p = start; p <= end; p++) {
                    pages.push(p);
                  }
                  
                  if (page < totalPages - (windowSize + 1)) pages.push('...');
                  if (totalPages > 1) pages.push(totalPages);

                  return pages.map((p, idx) => {
                    if (p === '...') return <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 text-[12px]">...</span>;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setPage(p as number);
                          fetchData(p as number);
                        }}
                        className={`w-8 h-8 flex items-center justify-center rounded text-[12px] transition-all font-medium ${page === p ? 'bg-slate-900 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                      >
                        {p}
                      </button>
                    );
                  });
                })()}
              </div>

              {loading && (
                <span className="inline-block w-3 h-3 border-2 border-slate-600 border-t-transparent rounded-full animate-spin ml-2" />
              )}
              
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
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/10">
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(70vh,1fr)] gap-3 p-4">
              {/* Region Summary Table — fixed compact block, always visible */}
              <section>
                <h2 className="mb-2 px-2 text-[11px] text-slate-500 ui-label">Regional Performance (AI)</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-[#0070c0]">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30">Region</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
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
                          open: acc.open + Number(b.open_calls || 0),
                          age2: acc.age2 + Number(b.age_2 || 0),
                          age3: acc.age3 + Number(b.age_3 || 0),
                          age7: acc.age7 + Number(b.age_7 || 0),
                          age15: acc.age15 + Number(b.age_15 || 0),
                          parts: acc.parts + Number(b.part_pending || 0),
                          engs: acc.engs + Number(b.active_eng || 0)
                        }), { total: 0, solved: 0, cancelled: 0, open: 0, age2: 0, age3: 0, age7: 0, age15: 0, parts: 0, engs: 0 });

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

              {/* Branch table — grid 1fr row + tall scroll panel; header stays sticky inside */}
              <section className="flex h-full min-h-0 flex-col overflow-hidden">
                <h2 className="mb-2 flex-shrink-0 px-2 text-[11px] text-slate-500 ui-label">Branch Wise Performance</h2>
                <div className="h-full min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm inner-scrollbar">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="sticky top-0 z-20 bg-[#0070c0] shadow-sm outline outline-1 outline-[#0070c0]">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30 min-w-[200px]">Branches</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
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
          </div>
        ) : activeTab === 'accounts' ? (
            <div className="flex-1 flex flex-col min-h-0 p-6 space-y-4 bg-slate-50/10">
              {(() => {
                const filteredAccounts = accountsData.filter(a => {
                  const matchRegion = filterRegion.length === 0 || filterRegion.includes(a.region);
                  const matchAccount = filterAccount.length === 0 || filterAccount.includes(a.account);
                  return matchRegion && matchAccount;
                });

                return (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between px-2 mb-2 flex-shrink-0">
                      <h2 className="text-[11px] text-slate-500 ui-label">Key Account Wise Performance</h2>
                    </div>
                    <div className="flex-1 bg-white border border-slate-200 rounded-lg shadow-sm overflow-auto custom-scrollbar relative">
                      <table className="w-full text-left border-collapse text-[10px]">
                        <thead className="sticky top-0 z-20 outline outline-1 outline-slate-800 shadow-sm">
                          {/* Category Headers */}
                          <tr className="bg-slate-800 text-white ui-strong">
                            <th className="p-1.5 border-r border-slate-600/50" colSpan={3}>Basics</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center" colSpan={4}>Calls Summary (Breakdown)</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center bg-blue-600" colSpan={7}>Breakdown (Aging)</th>
                            <th className="p-1.5 border-r border-slate-600/50 text-center bg-amber-600" colSpan={3}>Deployment</th>
                            <th className="p-1.5 text-center bg-emerald-600" colSpan={2}>Installation</th>
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
                  </div>
                );
              })()}
            </div>
          ) : null}
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
