'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { SortableTh } from '@/components/ui/SortableTh';
import {
  BarChart2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  X,
  Layers,
  ArrowRight,
  AlertTriangle,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

type CompressorCallItem = {
  id: string;
  call_no: string;
  call_date: string;
  solve_date: string | null;
  days_gap: number | null;
  office_name: string;
  branch_name: string | null;
  sap_vendor_code: string | null;
  old_item_code: string | null;
  old_item_name: string | null;
  new_item_code: string | null;
  new_item_name: string | null;
  derived_old_barcode: string;
  derived_new_barcode: string;
  call_status: string;
  cancel_reason: string | null;
  is_continuity_broken?: boolean;
  expected_old_barcode?: string | null;
};

type CompressorSerialGroup = {
  serial_number: string;
  total_calls: number;
  calls_in_range?: number;
  latest_call_date: string;
  latest_solve_date: string | null;
  avg_days_gap: number | null;
  latest_office: string;
  latest_branch: string | null;
  latest_sap_vendor_code: string | null;
  current_barcode: string;
  has_continuity_break?: boolean;
  calls: CompressorCallItem[];
  all_calls?: CompressorCallItem[];
};

type APIResponse = {
  data: CompressorSerialGroup[];
  total: number;
  page: number;
  limit: number;
  stats?: {
    total_machines: number;
    broken_machines: number;
    repeat_machines: number;
  };
};

function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB');
}

function renderCallStatusBadge(status: string | null | undefined, cancelReason?: string | null) {
  const norm = String(status || '').trim().toLowerCase();

  if (norm === 'cancelled' || norm.includes('cancel')) {
    return (
      <div className="flex flex-col">
        <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          Cancelled
        </span>
        {cancelReason && (
          <span className="text-[10px] text-slate-400 mt-0.5 leading-tight font-normal">
            {cancelReason}
          </span>
        )}
      </div>
    );
  }

  if (norm === 'tech solved' || norm.includes('tech') || norm.includes('fast')) {
    return (
      <span
        className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200"
        title="Tech. Solved (Fast Close)"
      >
        Tech Solved
      </span>
    );
  }

  if (norm === 'assigned' || norm.includes('allocat')) {
    return (
      <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
        Assigned
      </span>
    );
  }

  if (norm === 'transferred' || norm.includes('transfer')) {
    return (
      <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
        Transferred
      </span>
    );
  }

  if (norm === 'open' || norm.includes('open') || norm === 'unallocated') {
    return (
      <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        Open
      </span>
    );
  }

  if (norm === 'closed' || norm.includes('close') || norm === 'solved') {
    return (
      <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        Closed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center w-fit px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {status || 'Unknown'}
    </span>
  );
}

export function CompressorBarcodesPageClient() {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  // Keep only 2 tabs: 1 broken continuity, 2 2+ repair calls
  const [filterTab, setFilterTab] = useState<'broken' | 'repeat'>('repeat');
  const [dateType, setDateType] = useState<'call_date' | 'solve_date'>('call_date');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState<string>('solve_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const limit = 25;

  const [data, setData] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();

  // Set of currently expanded serial numbers
  const [expandedSerials, setExpandedSerials] = useState<Set<string>>(new Set());
  // Set of serial numbers toggled to view full history when date filter is active
  const [showAllHistorySerials, setShowAllHistorySerials] = useState<Set<string>>(new Set());

  // Handle column header sort
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  // Fetch data from database API
  useEffect(() => {
    let ignore = false;
    setIsLoading(true);

    const queryParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      filter: filterTab,
      dateType,
      sortBy,
      sortOrder,
    });
    if (activeSearch.trim()) {
      queryParams.set('search', activeSearch.trim());
    }
    if (startDate) {
      queryParams.set('startDate', startDate);
    }
    if (endDate) {
      queryParams.set('endDate', endDate);
    }

    fetcher(`/api/compressor-barcodes?${queryParams.toString()}`)
      .then((res) => {
        if (!ignore) {
          setData(res);
          setIsLoading(false);
          setError(null);
          // If a single item matched, expand it automatically
          if (res.data?.length === 1) {
            setExpandedSerials(new Set([res.data[0].serial_number]));
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [page, limit, activeSearch, filterTab, dateType, startDate, endDate, sortBy, sortOrder]);

  const [autoRefresh, setAutoRefresh] = useState(true);

  // Periodic silent background auto-refresh every 60s
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        filter: filterTab,
        dateType,
        sortBy,
        sortOrder,
      });
      if (activeSearch.trim()) queryParams.set('search', activeSearch.trim());
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);

      fetcher(`/api/compressor-barcodes?${queryParams.toString()}`)
        .then((res) => {
          setData(res);
        })
        .catch((err) => {
          console.warn('[Auto-refresh] Silent poll error:', err);
        });
    }, 60_000);

    return () => clearInterval(interval);
  }, [autoRefresh, page, limit, activeSearch, filterTab, dateType, startDate, endDate, sortBy, sortOrder]);

  const toggleExpand = (serial: string) => {
    setExpandedSerials((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  };

  const expandAllOnPage = () => {
    if (!data?.data) return;
    setExpandedSerials(new Set(data.data.map((item) => item.serial_number)));
  };

  const collapseAllOnPage = () => {
    setExpandedSerials(new Set());
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActiveSearch(searchTerm);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    setActiveSearch('');
    setPage(1);
  };

  const handleClearDates = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const handleSyncData = () => {
    startSyncTransition(async () => {
      const toastId = toast.loading('Syncing compressor barcodes from Western CRM...');
      try {
        const res = await fetch('/api/admin/sync-compressor-barcodes', {
          method: 'POST',
        });
        const result = await res.json();
        if (!res.ok) {
          throw new Error(result.error || 'Failed to sync data');
        }
        toast.success(`Successfully synced ${result.count?.toLocaleString() ?? 0} compressor records!`, { id: toastId });
        setPage(1);
        setIsLoading(true);
        const queryParams = new URLSearchParams({
          page: '1',
          limit: String(limit),
          filter: filterTab,
          dateType,
          sortBy,
          sortOrder,
        });
        if (activeSearch) queryParams.set('search', activeSearch);
        if (startDate) queryParams.set('startDate', startDate);
        if (endDate) queryParams.set('endDate', endDate);

        const refreshed = await fetcher(`/api/compressor-barcodes?${queryParams.toString()}`);
        setData(refreshed);
        setIsLoading(false);
      } catch (err: unknown) {
        console.error('Sync failed:', err);
        toast.error(err instanceof Error ? err.message : 'Sync failed', { id: toastId });
      }
    });
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const allExpanded =
    data?.data && data.data.length > 0 && data.data.every((d) => expandedSerials.has(d.serial_number));

  return (
    <PageShell
      title="Compressor Barcodes Tracker"
      icon={<BarChart2 className="h-4 w-4" />}
    >
      <PageScrollRegion className="p-4 bg-slate-100/70">
        <div className="flex flex-col gap-4 p-5 bg-white rounded-xl shadow-xs border border-slate-200">
          {/* Header & Actions */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Repeat Compressor Barcodes Tracker</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Grouped by unique machine serial number &mdash; displaying machines with 2+ compressor repairs. Click any table header to sort ASC/DESC.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-600 shadow-2xs">
                <span className="relative flex h-2 w-2">
                  {autoRefresh ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
                  )}
                </span>
                <span className="font-medium text-[11px] text-slate-700">
                  {autoRefresh ? 'Live Auto-sync (1m)' : 'Auto-sync paused'}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className="text-[10px] text-blue-600 hover:text-blue-800 underline ml-1 cursor-pointer font-medium"
                >
                  {autoRefresh ? 'Pause' : 'Resume'}
                </button>
              </div>

              {data?.data && data.data.length > 0 && (
                <button
                  type="button"
                  onClick={allExpanded ? collapseAllOnPage : expandAllOnPage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-300 rounded-md shadow-2xs transition-colors cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5 text-slate-500" />
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              )}

              <button
                onClick={handleSyncData}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-md shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                title="Manually trigger immediate sync from CRM into PostgreSQL"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin text-blue-600' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          </div>

          {/* Filter Tabs & Controls Row */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-3 border-t border-slate-100">
            {/* Only 2 Tabs: 1 Broken Continuity, 2 2+ Repair Calls */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => {
                  setFilterTab('broken');
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  filterTab === 'broken'
                    ? 'bg-amber-500 text-white shadow-2xs'
                    : 'text-amber-800 hover:bg-amber-100/70'
                }`}
              >
                <AlertTriangle className="h-3 w-3" />
                Broken Continuity{' '}
                {data?.stats?.broken_machines != null ? (
                  <span
                    className={`text-[11px] font-semibold px-1.5 py-0.2 rounded-full ${
                      filterTab === 'broken' ? 'bg-amber-700 text-white' : 'bg-amber-200/80 text-amber-900'
                    }`}
                  >
                    {data.stats.broken_machines.toLocaleString()}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterTab('repeat');
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  filterTab === 'repeat'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                2+ Repair Calls
                {data?.stats?.repeat_machines != null ? (
                  <span className="text-[11px] font-normal text-slate-500 ml-1">
                    ({data.stats.repeat_machines.toLocaleString()})
                  </span>
                ) : null}
              </button>
            </div>

            {/* Date Range & Search Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              {/* Date Range Filter with Call Date vs Solved Date selector */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={dateType}
                  onChange={(e) => {
                    setDateType(e.target.value as 'call_date' | 'solve_date');
                    setPage(1);
                  }}
                  className="bg-transparent border-0 text-[11px] font-semibold text-slate-700 focus:outline-none cursor-pointer pr-1"
                  title="Filter by Call Date or Solved Date"
                >
                  <option value="call_date">Call Date</option>
                  <option value="solve_date">Solved Date</option>
                </select>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 text-xs text-slate-700 focus:outline-none cursor-pointer"
                  title="Filter start date"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 text-xs text-slate-700 focus:outline-none cursor-pointer"
                  title="Filter end date"
                />
                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={handleClearDates}
                    className="text-slate-400 hover:text-slate-600 ml-1 cursor-pointer"
                    title="Clear date filter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Search Input */}
              <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-xs w-full">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search serial, call, barcode, office..."
                    className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors cursor-pointer"
                >
                  Search
                </button>
              </form>
            </div>
          </div>

          {/* Table Content */}
          {error ? (
            <div className="text-rose-600 bg-rose-50 p-4 rounded-md text-sm border border-rose-200">
              Failed to load data. Please ensure you have permissions or try refreshing.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="text-xs text-slate-600 uppercase bg-slate-100/90 border-b border-slate-200">
                  <tr>
                    <th className="w-10 px-3 py-3 text-center"></th>
                    <SortableTh
                      active={sortBy === 'serial_number'}
                      dir={sortOrder}
                      onClick={() => handleSort('serial_number')}
                      className="px-4 py-3 font-semibold"
                    >
                      Serial Number
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'total_calls'}
                      dir={sortOrder}
                      onClick={() => handleSort('total_calls')}
                      className="px-4 py-3 font-semibold"
                    >
                      Total Repairs
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'avg_days_gap'}
                      dir={sortOrder}
                      onClick={() => handleSort('avg_days_gap')}
                      className="px-4 py-3 font-semibold"
                    >
                      Avg Days Gap
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'current_barcode'}
                      dir={sortOrder}
                      onClick={() => handleSort('current_barcode')}
                      className="px-4 py-3 font-semibold"
                    >
                      Current Barcode
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'branch'}
                      dir={sortOrder}
                      onClick={() => handleSort('branch')}
                      className="px-4 py-3 font-semibold"
                    >
                      Branch
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'office'}
                      dir={sortOrder}
                      onClick={() => handleSort('office')}
                      className="px-4 py-3 font-semibold"
                    >
                      Latest Office / Workshop
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'solve_date'}
                      dir={sortOrder}
                      onClick={() => handleSort('solve_date')}
                      className="px-4 py-3 font-semibold"
                    >
                      Latest Solved Date
                    </SortableTh>
                    <SortableTh
                      active={sortBy === 'call_date'}
                      dir={sortOrder}
                      onClick={() => handleSort('call_date')}
                      className="px-4 py-3 font-semibold"
                    >
                      Latest Call Date
                    </SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="h-32 text-center align-middle">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                        <span className="text-xs text-slate-400 mt-2 block">Loading records from database...</span>
                      </td>
                    </tr>
                  ) : data?.data && data.data.length > 0 ? (
                    data.data.map((row) => {
                      const isExpanded = expandedSerials.has(row.serial_number);
                      const isBroken = row.has_continuity_break;
                      const isDateFiltered = Boolean(startDate || endDate);
                      const displayedCalls =
                        showAllHistorySerials.has(row.serial_number) || !isDateFiltered
                          ? row.all_calls && row.all_calls.length > 0
                            ? row.all_calls
                            : row.calls
                          : row.calls || [];

                      return (
                        <React.Fragment key={row.serial_number}>
                          {/* Parent Machine Row */}
                          <tr
                            onClick={() => toggleExpand(row.serial_number)}
                            className={`cursor-pointer transition-colors border-b border-slate-100 ${
                              isBroken
                                ? isExpanded
                                  ? 'bg-amber-50/70 border-l-4 border-l-amber-500'
                                  : 'bg-amber-50/30 hover:bg-amber-50/50 border-l-4 border-l-amber-400'
                                : isExpanded
                                ? 'bg-blue-50/40 hover:bg-blue-50/60'
                                : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="px-3 py-3 text-center align-middle">
                              <ChevronDown
                                className={`h-4 w-4 text-slate-400 transition-transform duration-200 inline-block ${
                                  isExpanded ? 'transform rotate-180 text-blue-600' : ''
                                }`}
                              />
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-900 font-mono text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="hover:text-blue-600 transition-colors">{row.serial_number}</span>
                                {isBroken && (
                                  <span
                                    title="Continuity break detected midway in compressor replacement history"
                                    className="inline-flex items-center text-amber-600"
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border w-fit ${
                                    row.total_calls >= 5
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : row.total_calls >= 2
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-slate-100 text-slate-700 border-slate-200'
                                  }`}
                                >
                                  {row.total_calls} {row.total_calls === 1 ? 'Repair' : 'Repairs'}
                                </span>
                                {isDateFiltered && row.calls_in_range != null && row.calls_in_range !== row.total_calls && (
                                  <span className="text-[10px] text-blue-600 font-medium">
                                    ({row.calls_in_range} in period)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {row.avg_days_gap != null ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  {row.avg_days_gap} {row.avg_days_gap === 1 ? 'day' : 'days'}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {row.current_barcode && row.current_barcode !== '-' ? (
                                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-xs font-mono font-medium">
                                  {row.current_barcode}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic text-xs font-mono">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-700 text-xs">
                              {row.latest_branch || '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-700 text-xs font-medium">
                              <span>{row.latest_office || '—'}</span>
                              {row.latest_sap_vendor_code ? (
                                <span className="text-slate-400 font-mono text-[11px] ml-1">
                                  ({row.latest_sap_vendor_code})
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-slate-600 text-xs font-medium">
                              {formatDate(row.latest_solve_date)}
                            </td>
                            <td className="px-4 py-3 text-slate-600 text-xs">
                              {formatDate(row.latest_call_date)}
                            </td>
                          </tr>

                          {/* Expanded Child Accordion Lineage Table */}
                          {isExpanded && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={9} className="p-0 border-b border-slate-200">
                                <div className="p-4 pl-10 bg-slate-50/95 border-t border-slate-200">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                                    <div className="text-xs font-semibold text-slate-700 flex items-center gap-2 flex-wrap">
                                      <span>Compressor Replacement Lineage for Serial:</span>
                                      <span className="font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                        {row.serial_number}
                                      </span>
                                      {isDateFiltered && (
                                        <span className="text-xs text-slate-500 font-normal">
                                          (Showing {displayedCalls.length} call{displayedCalls.length === 1 ? '' : 's'} in selected period
                                          {row.total_calls > displayedCalls.length ? ` of ${row.total_calls} total` : ''})
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                      {isDateFiltered && row.total_calls > (row.calls?.length || 0) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setShowAllHistorySerials((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(row.serial_number)) next.delete(row.serial_number);
                                              else next.add(row.serial_number);
                                              return next;
                                            });
                                          }}
                                          className="text-[11px] font-medium text-blue-600 hover:text-blue-800 underline cursor-pointer"
                                        >
                                          {showAllHistorySerials.has(row.serial_number)
                                            ? `Show filtered period only (${row.calls?.length || 0} call${row.calls?.length === 1 ? '' : 's'})`
                                            : `View all ${row.total_calls} historical calls`}
                                        </button>
                                      )}
                                      {isBroken && (
                                        <div className="inline-flex items-center gap-1.5 text-xs text-amber-900 bg-amber-100/90 border border-amber-300 px-2.5 py-1 rounded-md font-medium">
                                          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                                          <span>Continuity break detected: technician recorded an unexpected old barcode midway</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-2xs">
                                    <table className="w-full text-xs text-left border-collapse">
                                      <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-semibold border-b border-slate-200">
                                        <tr>
                                          <th className="px-2.5 py-2.5 w-10 text-center">#</th>
                                          <th className="px-3 py-2.5">Call No</th>
                                          <th className="px-3 py-2.5">Status</th>
                                          <th className="px-3 py-2.5">Call Date</th>
                                          <th className="px-3 py-2.5">Solve Date</th>
                                          <th className="px-3 py-2.5">Days Gap</th>
                                          <th className="px-3 py-2.5">Branch</th>
                                          <th className="px-3 py-2.5">Office / Workshop</th>
                                          <th className="px-3 py-2.5">Old Barcode (Item)</th>
                                          <th className="px-1 py-2.5 text-center w-6"></th>
                                          <th className="px-3 py-2.5">New Barcode (Item)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {displayedCalls.map((call, idx) => {
                                          const isCallBroken = call.is_continuity_broken;

                                          return (
                                            <tr
                                              key={call.id || `${call.call_no}-${idx}`}
                                              className={`transition-colors ${
                                                isCallBroken
                                                  ? 'bg-amber-50/70 hover:bg-amber-50 border-l-4 border-l-amber-500'
                                                  : 'hover:bg-slate-50/60'
                                              }`}
                                            >
                                              <td className="px-2.5 py-2.5 text-center text-slate-400 font-mono text-[11px]">
                                                {idx + 1}
                                              </td>
                                              <td className="px-3 py-2.5 font-mono font-medium text-slate-900">
                                                {call.call_no}
                                              </td>
                                              <td className="px-3 py-2.5">
                                                {renderCallStatusBadge(call.call_status, call.cancel_reason)}
                                              </td>
                                              <td className="px-3 py-2.5 text-slate-600">
                                                {formatDate(call.call_date)}
                                              </td>
                                              <td className="px-3 py-2.5 text-slate-700 font-medium">
                                                {formatDate(call.solve_date)}
                                              </td>
                                              <td className="px-3 py-2.5">
                                                {call.call_status === 'Cancelled' ? (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                                                    NA
                                                  </span>
                                                ) : call.days_gap != null ? (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                                    {call.days_gap} {call.days_gap === 1 ? 'day' : 'days'}
                                                  </span>
                                                ) : (
                                                  <span className="text-slate-400 text-xs">—</span>
                                                )}
                                              </td>
                                              <td className="px-3 py-2.5 text-slate-700">
                                                {call.branch_name || '—'}
                                              </td>
                                              <td className="px-3 py-2.5 text-slate-700">
                                                <span>{call.office_name || '—'}</span>
                                                {call.sap_vendor_code ? (
                                                  <span className="text-slate-400 font-mono text-[10px] ml-1">
                                                    ({call.sap_vendor_code})
                                                  </span>
                                                ) : null}
                                              </td>
                                              <td className="px-3 py-2.5">
                                                <div className="flex flex-col gap-0.5">
                                                  <div className="flex items-center gap-1.5 flex-wrap">
                                                    {call.derived_old_barcode && call.derived_old_barcode !== '-' ? (
                                                      <>
                                                        <span
                                                          className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium border ${
                                                            isCallBroken
                                                              ? 'bg-rose-50 text-rose-800 border-rose-300 font-semibold'
                                                              : 'bg-slate-100 text-slate-700 border-slate-200'
                                                          }`}
                                                        >
                                                          {call.derived_old_barcode}
                                                        </span>
                                                        {(call.old_item_code || call.old_item_name) && (
                                                          <span className="text-[11px] text-slate-500 font-normal">
                                                            ({call.old_item_code ? `${call.old_item_code}` : ''}
                                                            {call.old_item_code && call.old_item_name ? ' - ' : ''}
                                                            {call.old_item_name || ''})
                                                          </span>
                                                        )}
                                                      </>
                                                    ) : (
                                                      <span className="text-slate-400 italic text-xs">
                                                        Initial / Blank
                                                      </span>
                                                    )}
                                                  </div>

                                                  {/* Highlight continuity mismatch */}
                                                  {isCallBroken && call.expected_old_barcode && (
                                                    <span className="text-[10px] text-rose-600 font-medium leading-tight mt-0.5 flex items-center gap-1">
                                                      <span>⚠️ Expected:</span>
                                                      <span className="font-mono bg-rose-50 px-1 rounded border border-rose-200">
                                                        {call.expected_old_barcode}
                                                      </span>
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="px-1 py-2.5 text-center text-slate-400">
                                                <ArrowRight className="h-3 w-3 inline" />
                                              </td>
                                              <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  {call.derived_new_barcode && call.derived_new_barcode !== '-' ? (
                                                    <>
                                                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded text-xs font-mono font-semibold">
                                                        {call.derived_new_barcode}
                                                      </span>
                                                      {(call.new_item_code || call.new_item_name) && (
                                                        <span className="text-[11px] text-slate-500 font-normal">
                                                          ({call.new_item_code ? `${call.new_item_code}` : ''}
                                                          {call.new_item_code && call.new_item_name ? ' - ' : ''}
                                                          {call.new_item_name || ''})
                                                        </span>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <span className="text-slate-400 italic text-xs font-mono">-</span>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="h-28 text-center align-middle text-slate-500 text-sm">
                        No compressor repair records found
                        {activeSearch ? ` matching "${activeSearch}"` : ''}
                        {startDate || endDate ? ` within selected date range` : ''}
                        {filterTab === 'broken' ? ' with broken continuity' : ''}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between py-2 gap-3 mt-1">
            <div className="text-xs text-slate-500">
              Showing {data && data.total > 0 ? (page - 1) * limit + 1 : 0} to{' '}
              {data ? Math.min(page * limit, data.total) : 0} of {data?.total?.toLocaleString() || 0} repeat machines (min. 2 repairs)
              {filterTab === 'broken' && (
                <span className="ml-1 text-amber-700 font-medium">(broken continuity)</span>
              )}
              {activeSearch && <span className="ml-1 text-slate-400 font-medium">(search filtered)</span>}
              {(startDate || endDate) && <span className="ml-1 text-blue-600 font-medium">(date filtered)</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 mr-2">
                Page {page} of {Math.max(1, totalPages)}
              </span>
              <button
                className="flex items-center justify-center px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" /> Prev
              </button>
              <button
                className="flex items-center justify-center px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
