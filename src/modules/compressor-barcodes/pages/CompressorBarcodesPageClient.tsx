'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import {
  AdminTableCard,
  AdminTable,
  AdminThead,
  AdminTr,
  AdminTd,
} from '@/components/admin/AdminUi';
import { SortableTh } from '@/components/ui/SortableTh';
import { AnimatedMetric } from '@/components/motion';
import { formatUiDate } from '@/lib/dates/ui-date';
import {
  ScanBarcode,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  ArrowRight,
  AlertTriangle,
  Calendar,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';

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
    three_plus_machines?: number;
  };
};

type SortKey = { field: string; dir: 'asc' | 'desc' };
type FilterTab = 'repeat' | 'broken' | 'repeat3' | 'all';

function formatDate(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return formatUiDate(val) || '—';
  } catch {
    const d = new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB');
  }
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

const SORT_LABELS: Record<string, string> = {
  serial_number: 'Serial',
  total_calls: 'Repairs',
  avg_days_gap: 'Avg Gap',
  current_barcode: 'Barcode',
  branch: 'Branch',
  office: 'Office',
  solve_date: 'Solved Date',
  call_date: 'Call Date',
};

export function CompressorBarcodesPageClient() {
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('repeat');
  const [dateType, setDateType] = useState<'call_date' | 'solve_date'>('call_date');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: 'solve_date', dir: 'desc' }]);
  const limit = 100;

  const [data, setData] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Set of currently expanded serial numbers
  const [expandedSerials, setExpandedSerials] = useState<Set<string>>(new Set());
  // Set of serial numbers toggled to view full history when date filter is active
  const [showAllHistorySerials, setShowAllHistorySerials] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Multi-sort handler
  const handleSort = (field: string) => {
    setSortKeys((prev) => {
      const idx = prev.findIndex((k) => k.field === field);
      if (idx === -1) {
        return [...prev, { field, dir: 'desc' as const }];
      }
      const next = [...prev];
      next[idx] = { field, dir: next[idx].dir === 'desc' ? 'asc' : 'desc' };
      return next;
    });
    setPage(1);
  };

  const removeSortKey = (field: string) => {
    setSortKeys((prev) => {
      const next = prev.filter((k) => k.field !== field);
      return next.length > 0 ? next : [{ field: 'solve_date', dir: 'desc' }];
    });
    setPage(1);
  };

  const buildSortParam = (keys: SortKey[]) =>
    keys.map((k) => `${k.field}:${k.dir}`).join(',');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch data
  useEffect(() => {
    let ignore = false;
    setIsLoading(true);

    const queryParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      filter: filterTab,
      dateType,
      sort: buildSortParam(sortKeys),
    });

    if (filterTab === 'all') {
      queryParams.set('minRepairs', '1');
    }
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
  }, [page, limit, activeSearch, filterTab, dateType, startDate, endDate, sortKeys]);

  // Background silent auto-refresh every 60s
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        filter: filterTab,
        dateType,
        sort: buildSortParam(sortKeys),
      });
      if (filterTab === 'all') queryParams.set('minRepairs', '1');
      if (activeSearch.trim()) queryParams.set('search', activeSearch.trim());
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);

      fetcher(`/api/compressor-barcodes?${queryParams.toString()}`)
        .then((res) => setData(res))
        .catch((err) => console.warn('[Auto-refresh] Silent poll error:', err));
    }, 60_000);

    return () => clearInterval(interval);
  }, [autoRefresh, page, limit, activeSearch, filterTab, dateType, startDate, endDate, sortKeys]);

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

  const handleClearDates = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setActiveSearch('');
    setStartDate('');
    setEndDate('');
    setFilterTab('repeat');
    setSortKeys([{ field: 'solve_date', dir: 'desc' }]);
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  const isDateFiltered = Boolean(startDate || endDate);

  const stats = data?.stats;

  return (
    <PageShell
      title="Compressor Barcodes Tracker"
      subtitle="Monitor repeat compressor replacements, barcode continuity, and repair lineage across CRM calls"
      icon={<ScanBarcode className="h-4 w-4" />}
      toolbar={
        <>
          <div className="register-filter-bar !px-3 !py-1.5 bg-white border-b border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Date Range Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center h-8 gap-1.5 bg-slate-50/80 hover:bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs text-slate-700 shadow-2xs transition-colors">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
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
                  <span className="text-slate-300">|</span>
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
                  <span className="text-slate-400 text-xs font-medium">to</span>
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
              </div>

              {/* Right Search Input & Result Count */}
              <div className="flex items-center gap-2 flex-1 max-w-sm justify-end">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search serial, barcode, call no, office..."
                    className="h-8 w-full pl-8 pr-7 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-400 shadow-2xs transition-all"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('');
                        setActiveSearch('');
                        setPage(1);
                      }}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      title="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {(activeSearch || isDateFiltered || filterTab !== 'repeat') && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="h-8 inline-flex items-center gap-1 px-2.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer shrink-0"
                    title="Reset all filters"
                  >
                    <RotateCcw className="h-3 w-3 text-slate-400" />
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Executive KPI Stats Bar */}
          {stats && (
            <div className="register-stats-bar !px-3 !py-2 border-b border-slate-200 bg-slate-50/60">
              {/* Card 1: 2+ Repeat Repairs */}
              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable ${
                  filterTab === 'repeat' ? 'register-stat-item--active' : ''
                }`}
                onClick={() => {
                  setFilterTab('repeat');
                  setPage(1);
                }}
                title="Filter machines with 2 or more compressor repairs"
              >
                <AnimatedMetric
                  value={stats.repeat_machines || 0}
                  className="register-stat-value text-slate-900"
                />
                <span className="register-stat-label">Repeat Machines (2+ Repairs)</span>
              </button>

              {/* Card 2: Broken Continuity */}
              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable ${
                  filterTab === 'broken' ? 'register-stat-item--active' : ''
                }`}
                onClick={() => {
                  setFilterTab('broken');
                  setPage(1);
                }}
                title="Filter machines where old barcode did not match previously installed barcode"
              >
                <div className="flex items-center justify-between w-full">
                  <AnimatedMetric
                    value={stats.broken_machines || 0}
                    className="register-stat-value text-amber-600"
                  />
                  <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                    Integrity Risk
                  </span>
                </div>
                <span className="register-stat-label flex items-center gap-1 text-amber-800">
                  <AlertTriangle className="h-2.5 w-2.5 text-amber-600" /> Broken Continuity
                </span>
              </button>

              {/* Card 3: 3+ Frequent Repairs */}
              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable ${
                  filterTab === 'repeat3' ? 'register-stat-item--active' : ''
                }`}
                onClick={() => {
                  setFilterTab('repeat3');
                  setPage(1);
                }}
                title="Filter machines with 3 or more compressor repairs"
              >
                <AnimatedMetric
                  value={stats.three_plus_machines || 0}
                  className="register-stat-value text-indigo-600"
                />
                <span className="register-stat-label">Frequent Repeat (3+ Repairs)</span>
              </button>

              {/* Card 4: Total Tracked Universe */}
              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable ${
                  filterTab === 'all' ? 'register-stat-item--active' : ''
                }`}
                onClick={() => {
                  setFilterTab('all');
                  setPage(1);
                }}
                title="View total compressor serial universe"
              >
                <AnimatedMetric
                  value={stats.total_machines || 0}
                  className="register-stat-value text-slate-700"
                />
                <span className="register-stat-label">Total Serial Universe</span>
              </button>
            </div>
          )}
        </>
      }
    >
      <PageScrollRegion className="p-3 bg-bg-soft/70">
        <div className="flex flex-col gap-2.5">
          {/* Main Table Card */}
          <AdminTableCard
            isEmpty={!isLoading && (!data?.data || data.data.length === 0)}
            empty={
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-sm font-semibold text-slate-700">No compressor records found</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {activeSearch
                    ? `No matches found for search "${activeSearch}".`
                    : isDateFiltered
                    ? 'No repairs match the selected date range.'
                    : filterTab === 'broken'
                    ? 'No machines with broken barcode continuity found.'
                    : 'No repeat compressor repair records found.'}
                </p>
                {(activeSearch || isDateFiltered || filterTab !== 'repeat') && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset all filters
                  </button>
                )}
              </div>
            }
          >
            {/* Multi-sort Chips Strip */}
            {sortKeys.length > 1 && (
              <div className="flex items-center gap-1.5 px-3.5 py-1.5 border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-600 flex-wrap">
                <span className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mr-1">
                  Active Sort Order:
                </span>
                {sortKeys.map((k, i) => (
                  <span
                    key={k.field}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50/90 border border-blue-200 text-blue-800 font-medium"
                  >
                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-600 text-white text-[9px] font-bold">
                      {i + 1}
                    </span>
                    <span>{SORT_LABELS[k.field] ?? k.field}</span>
                    <button
                      type="button"
                      onClick={() => handleSort(k.field)}
                      className="text-blue-600 hover:text-blue-900 font-bold px-0.5 cursor-pointer"
                      title={`Click to reverse direction (${k.dir === 'desc' ? 'ASC' : 'DESC'})`}
                    >
                      {k.dir === 'desc' ? '↓' : '↑'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSortKey(k.field)}
                      className="text-blue-400 hover:text-blue-700 ml-0.5 cursor-pointer font-bold leading-none"
                      title={`Remove ${SORT_LABELS[k.field]} from sort`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSortKeys([{ field: 'solve_date', dir: 'desc' }]);
                    setPage(1);
                  }}
                  className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer ml-auto"
                >
                  Reset to default
                </button>
              </div>
            )}

            <AdminTable>
              <AdminThead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] uppercase tracking-wider text-slate-500 font-semibold select-none">
                  <th className="w-10 px-3 py-2.5 text-center"></th>
                  {([
                    { field: 'serial_number',  label: 'Serial Number' },
                    { field: 'total_calls',     label: 'Total Repairs' },
                    { field: 'avg_days_gap',    label: 'Avg Days Gap' },
                    { field: 'current_barcode', label: 'Current Barcode' },
                    { field: 'branch',          label: 'Branch' },
                    { field: 'office',          label: 'Latest Office / Workshop' },
                    { field: 'solve_date',      label: 'Latest Solved Date' },
                    { field: 'call_date',       label: 'Latest Call Date' },
                  ] as const).map(({ field, label }) => {
                    const idx = sortKeys.findIndex((k) => k.field === field);
                    const active = idx !== -1;
                    const dir = active ? sortKeys[idx].dir : 'desc';
                    const priority = sortKeys.length > 1 && active ? idx + 1 : null;
                    return (
                      <SortableTh
                        key={field}
                        active={active}
                        dir={dir}
                        onClick={() => handleSort(field)}
                        className={`!bg-transparent hover:!bg-slate-100/70 transition-colors px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${
                          active ? '!text-slate-900 font-bold' : 'text-slate-500'
                        }`}
                        title={`Click to sort by ${label}. Click again to toggle ASC/DESC.`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span>{label}</span>
                          {priority !== null && (
                            <span className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold rounded-full bg-blue-600 text-white leading-none">
                              {priority}
                            </span>
                          )}
                        </span>
                      </SortableTh>
                    );
                  })}
                </tr>
              </AdminThead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="h-40 text-center align-middle">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                      <span className="text-xs text-slate-400 mt-2 block">Loading compressor records...</span>
                    </td>
                  </tr>
                ) : data?.data && data.data.length > 0 ? (
                  data.data.map((row) => {
                    const isExpanded = expandedSerials.has(row.serial_number);
                    const isBroken = row.has_continuity_break;
                    const displayedCalls =
                      showAllHistorySerials.has(row.serial_number) || !isDateFiltered
                        ? row.all_calls && row.all_calls.length > 0
                          ? row.all_calls
                          : row.calls
                        : row.calls || [];

                    return (
                      <React.Fragment key={row.serial_number}>
                        {/* Parent Machine Row */}
                        <AdminTr
                          onClick={() => toggleExpand(row.serial_number)}
                          className={`group transition-colors ${
                            isBroken
                              ? isExpanded
                                ? 'bg-amber-50/60 border-l-[3px] border-l-amber-500'
                                : 'bg-amber-50/20 hover:bg-amber-50/40 border-l-[3px] border-l-amber-400'
                              : isExpanded
                              ? 'bg-blue-50/30 hover:bg-blue-50/50'
                              : 'hover:bg-slate-50/70'
                          }`}
                        >
                          <td className="w-10 px-3 py-2 text-center align-middle">
                            <ChevronDown
                              className={`h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 inline-block ${
                                isExpanded ? 'transform rotate-180 text-blue-600' : ''
                              }`}
                            />
                          </td>
                          <AdminTd className="font-mono text-[12px] font-semibold text-slate-900 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="group-hover:text-blue-600 transition-colors">{row.serial_number}</span>
                              {isBroken && (
                                <span
                                  title="Continuity break detected midway in compressor replacement history"
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100/80 text-amber-800 border border-amber-300/80"
                                >
                                  <AlertTriangle className="h-2.5 w-2.5 text-amber-600 shrink-0" />
                                  Broken
                                </span>
                              )}
                            </div>
                          </AdminTd>
                          <AdminTd className="py-2.5">
                            <div className="flex items-center gap-1">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                  row.total_calls >= 5
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : row.total_calls >= 2
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
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
                          </AdminTd>
                          <AdminTd className="py-2.5">
                            {row.avg_days_gap != null ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                                {row.avg_days_gap} {row.avg_days_gap === 1 ? 'day' : 'days'}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </AdminTd>
                          <AdminTd className="py-2.5">
                            {row.current_barcode && row.current_barcode !== '-' ? (
                              <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-[11px] font-mono font-semibold">
                                {row.current_barcode}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-[11px] font-mono">-</span>
                            )}
                          </AdminTd>
                          <AdminTd className="text-slate-700 text-[12px] py-2.5 max-w-[190px]">
                            <span className="truncate block" title={row.latest_branch || ''}>
                              {row.latest_branch || '—'}
                            </span>
                          </AdminTd>
                          <AdminTd className="text-slate-800 text-[12px] font-medium py-2.5 max-w-[220px]">
                            <div className="truncate flex items-center" title={row.latest_office || ''}>
                              <span className="truncate">{row.latest_office || '—'}</span>
                              {row.latest_sap_vendor_code ? (
                                <span className="text-slate-400 font-mono text-[10px] ml-1 shrink-0">
                                  ({row.latest_sap_vendor_code})
                                </span>
                              ) : null}
                            </div>
                          </AdminTd>
                          <AdminTd className="text-slate-600 text-[12px] font-medium tabular-nums py-2.5">
                            {formatDate(row.latest_solve_date)}
                          </AdminTd>
                          <AdminTd className="text-slate-500 text-[12px] tabular-nums py-2.5">
                            {formatDate(row.latest_call_date)}
                          </AdminTd>
                        </AdminTr>

                        {/* Expanded Child Accordion Lineage Table */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={9} className="p-0">
                              <div className="p-3 sm:p-4 pl-6 sm:pl-10 bg-slate-50/90 border-t border-slate-200/80">
                                {/* Accordion Header Strip */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-2 flex-wrap">
                                    <span>Replacement Lineage for Serial:</span>
                                    <span className="font-mono text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 font-bold">
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
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                                        <span>Continuity break: technician entered unexpected old barcode</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Lineage Table */}
                                <div className="overflow-x-auto bg-white rounded-lg border border-slate-200/90 shadow-2xs">
                                  <table className="w-full text-xs text-left border-collapse">
                                    <thead className="bg-slate-100/70 text-slate-600 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-200">
                                      <tr>
                                        <th className="px-2.5 py-2 w-10 text-center">#</th>
                                        <th className="px-3 py-2">Call No</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Call Date</th>
                                        <th className="px-3 py-2">Solve Date</th>
                                        <th className="px-3 py-2">Days Gap</th>
                                        <th className="px-3 py-2">Branch</th>
                                        <th className="px-3 py-2">Office / Workshop</th>
                                        <th className="px-3 py-2">Old Barcode (Removed)</th>
                                        <th className="px-1 py-2 text-center w-6"></th>
                                        <th className="px-3 py-2">New Barcode (Installed)</th>
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
                                                ? 'bg-amber-50/70 hover:bg-amber-50 border-l-[3px] border-l-amber-500'
                                                : 'hover:bg-slate-50/60'
                                            }`}
                                          >
                                            <td className="px-2.5 py-2 text-center text-slate-400 font-mono text-[10px]">
                                              {idx + 1}
                                            </td>
                                            <td className="px-3 py-2 font-mono font-medium text-slate-900 text-[11px]">
                                              {call.call_no}
                                            </td>
                                            <td className="px-3 py-2">
                                              {renderCallStatusBadge(call.call_status, call.cancel_reason)}
                                            </td>
                                            <td className="px-3 py-2 text-slate-600 text-[11px] tabular-nums">
                                              {formatDate(call.call_date)}
                                            </td>
                                            <td className="px-3 py-2 text-slate-800 font-medium text-[11px] tabular-nums">
                                              {formatDate(call.solve_date)}
                                            </td>
                                            <td className="px-3 py-2">
                                              {call.call_status === 'Cancelled' ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                                                  NA
                                                </span>
                                              ) : call.days_gap != null ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                                  {call.days_gap} {call.days_gap === 1 ? 'day' : 'days'}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400 text-xs">—</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700 text-[11px]">
                                              {call.branch_name || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700 text-[11px]">
                                              <span>{call.office_name || '—'}</span>
                                              {call.sap_vendor_code ? (
                                                <span className="text-slate-400 font-mono text-[10px] ml-1">
                                                  ({call.sap_vendor_code})
                                                </span>
                                              ) : null}
                                            </td>
                                            <td className="px-3 py-2">
                                              <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  {call.derived_old_barcode && call.derived_old_barcode !== '-' ? (
                                                    <>
                                                      <span
                                                        className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-medium border ${
                                                          isCallBroken
                                                            ? 'bg-rose-50 text-rose-800 border-rose-300 font-semibold'
                                                            : 'bg-slate-100 text-slate-700 border-slate-200'
                                                        }`}
                                                      >
                                                        {call.derived_old_barcode}
                                                      </span>
                                                      {(call.old_item_code || call.old_item_name) && (
                                                        <span className="text-[10px] text-slate-500 font-normal">
                                                          ({call.old_item_code ? `${call.old_item_code}` : ''}
                                                          {call.old_item_code && call.old_item_name ? ' - ' : ''}
                                                          {call.old_item_name || ''})
                                                        </span>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <span className="text-slate-400 italic text-[11px]">
                                                      Initial / Blank
                                                    </span>
                                                  )}
                                                </div>

                                                {/* Highlight continuity mismatch */}
                                                {isCallBroken && call.expected_old_barcode && (
                                                  <span className="text-[10px] text-rose-600 font-medium leading-tight mt-0.5 flex items-center gap-1">
                                                    <span>⚠️ Expected:</span>
                                                    <span className="font-mono bg-rose-50 px-1 rounded border border-rose-200 font-bold">
                                                      {call.expected_old_barcode}
                                                    </span>
                                                  </span>
                                                )}
                                              </div>
                                            </td>
                                            <td className="px-1 py-2 text-center text-slate-400">
                                              <ArrowRight className="h-3 w-3 inline" />
                                            </td>
                                            <td className="px-3 py-2">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                {call.derived_new_barcode && call.derived_new_barcode !== '-' ? (
                                                  <>
                                                    <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold">
                                                      {call.derived_new_barcode}
                                                    </span>
                                                    {(call.new_item_code || call.new_item_name) && (
                                                      <span className="text-[10px] text-slate-500 font-normal">
                                                        ({call.new_item_code ? `${call.new_item_code}` : ''}
                                                        {call.new_item_code && call.new_item_name ? ' - ' : ''}
                                                        {call.new_item_name || ''})
                                                      </span>
                                                    )}
                                                  </>
                                                ) : (
                                                  <span className="text-slate-400 italic text-[11px] font-mono">-</span>
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
                ) : null}
              </tbody>
            </AdminTable>
          </AdminTableCard>

          {/* Standard Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between py-2 px-1 gap-3 text-xs text-slate-500 font-medium">
            <div>
              Showing {data && data.total > 0 ? (page - 1) * limit + 1 : 0} to{' '}
              {data ? Math.min(page * limit, data.total) : 0} of {data?.total?.toLocaleString() || 0} machines
              {filterTab === 'broken' && (
                <span className="ml-1 text-amber-700 font-semibold">(broken continuity)</span>
              )}
              {filterTab === 'repeat3' && (
                <span className="ml-1 text-indigo-700 font-semibold">(3+ repairs)</span>
              )}
              {activeSearch && <span className="ml-1 text-slate-400 font-medium">(search filtered)</span>}
              {isDateFiltered && <span className="ml-1 text-blue-600 font-medium">(date filtered)</span>}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 mr-2 text-xs">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
