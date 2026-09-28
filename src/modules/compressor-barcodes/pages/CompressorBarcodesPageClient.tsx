'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import {
  AdminTableCard,
  AdminTable,
  AdminThead,
  AdminTr,
  AdminTd,
} from '@/components/admin/AdminUi';
import { SortableTh } from '@/components/ui/SortableTh';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { DateRangeSelector } from '@/modules/mis/register/components/DateRangeSelector';
import {
  defaultDateRange,
  isDefaultDateRange,
  toDateString,
  type ReportDateRange,
} from '@/modules/mis';
import { AnimatedMetric } from '@/components/motion';
import { formatUiDate } from '@/lib/dates/ui-date';
import {
  Repeat,
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
  MapPin,
  Download,
  GitCommit,
  Zap,
  Clock,
  History,
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
  repair_kind?: 'compressor' | 'gas';
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
    premature_machines?: number;
    top_branches?: { branch_name: string; repeat_count: number }[];
    all_branches?: string[];
  };
};

type SortKey = { field: string; dir: 'asc' | 'desc' };
type FilterTab = 'repeat' | 'broken' | 'repeat3' | 'premature' | 'all';
type RepeatKind = 'compressor' | 'gas' | 'all';

const KIND_TABS: Array<{ value: RepeatKind; label: string }> = [
  { value: 'all', label: 'All work done' },
  { value: 'compressor', label: 'Compressor replaced' },
  { value: 'gas', label: 'Gas charging' },
];

const DATE_COLUMN_OPTIONS = [
  { value: 'call_date', label: 'Call Date' },
  { value: 'solve_date', label: 'Solved Date' },
];

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


function callRepairKind(call: CompressorCallItem | null | undefined): 'compressor' | 'gas' {
  return call?.repair_kind === 'gas' ? 'gas' : 'compressor';
}

function RepairKindBadge({ kind }: { kind: 'compressor' | 'gas' }) {
  const gas = kind === 'gas';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold border whitespace-nowrap ${
        gas
          ? 'bg-sky-50 text-sky-800 border-sky-200'
          : 'bg-violet-50 text-violet-800 border-violet-200'
      }`}
    >
      {gas ? 'Gas charging' : 'Compressor replaced'}
    </span>
  );
}

function isCancelledCall(call: CompressorCallItem | null | undefined): boolean {
  const norm = String(call?.call_status || '').trim().toLowerCase();
  return norm === 'cancelled' || norm.includes('cancel');
}

function getActiveCalls(calls: CompressorCallItem[] | null | undefined): CompressorCallItem[] {
  return (calls || []).filter((call) => !isCancelledCall(call));
}

/**
 * Remove cancelled CRM calls before the data reaches the UI.
 *
 * This keeps cancelled calls out of:
 * - repair counts
 * - date-range counts
 * - lineage tables/timelines
 * - rapid re-fail calculations
 * - latest-call metadata shown on the parent row
 */
function normalizeCompressorResponse(res: APIResponse): APIResponse {
  const data = (res.data || [])
    .map((row) => {
      const allCalls = getActiveCalls(row.all_calls && row.all_calls.length > 0 ? row.all_calls : row.calls);
      const rangeCalls = getActiveCalls(row.calls);

      const latestCall = [...allCalls].sort((a, b) => {
        const aDate = new Date(a.call_date || a.solve_date || 0).getTime();
        const bDate = new Date(b.call_date || b.solve_date || 0).getTime();
        return bDate - aDate;
      })[0];

      return {
        ...row,
        total_calls: allCalls.length,
        calls_in_range: rangeCalls.length,
        latest_call_date: latestCall?.call_date || '',
        latest_solve_date: latestCall?.solve_date || null,
        latest_office: latestCall?.office_name || row.latest_office,
        latest_branch: latestCall?.branch_name || row.latest_branch,
        latest_sap_vendor_code: latestCall?.sap_vendor_code || row.latest_sap_vendor_code,
        current_barcode:
          latestCall?.derived_new_barcode && latestCall.derived_new_barcode !== '-'
            ? latestCall.derived_new_barcode
            : row.current_barcode,
        calls: rangeCalls,
        all_calls: allCalls,
      };
    })
    // A serial containing only cancelled calls is not a tracked repair serial.
    .filter((row) => row.total_calls > 0);

  return {
    ...res,
    data,
  };
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
  const [selectedBranch, setSelectedBranch] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('repeat');
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('all');
  const [dateType, setDateType] = useState<'call_date' | 'solve_date'>('call_date');
  const [dateRange, setDateRange] = useState<ReportDateRange>(() => defaultDateRange());
  const startDate = useMemo(
    () => (dateRange.label === 'All Time' ? '' : toDateString(dateRange.start)),
    [dateRange]
  );
  const endDate = useMemo(
    () => (dateRange.label === 'All Time' ? '' : toDateString(dateRange.end)),
    [dateRange]
  );
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: 'solve_date', dir: 'desc' }]);
  const limit = 100;

  const [data, setData] = useState<APIResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Set of currently expanded serial numbers
  const [expandedSerials, setExpandedSerials] = useState<Set<string>>(new Set());
  // Set of serial numbers toggled to view full history when date filter is active
  const [showAllHistorySerials, setShowAllHistorySerials] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

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
      kind: repeatKind,
      dateType,
      sort: buildSortParam(sortKeys),
      excludeCancelled: '1',
    });

    if (filterTab === 'all') {
      queryParams.set('minRepairs', '1');
    }
    if (selectedBranch) {
      queryParams.set('branch', selectedBranch);
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
          const cleanRes = normalizeCompressorResponse(res);
          setData(cleanRes);
          setIsLoading(false);
          if (cleanRes.data?.length === 1) {
            setExpandedSerials(new Set([cleanRes.data[0].serial_number]));
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error('[Compressor Barcodes] Fetch error:', err);
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [page, limit, activeSearch, selectedBranch, filterTab, repeatKind, dateType, startDate, endDate, sortKeys]);

  // Background silent auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        filter: filterTab,
        kind: repeatKind,
        dateType,
        sort: buildSortParam(sortKeys),
        excludeCancelled: '1',
      });
      if (filterTab === 'all') queryParams.set('minRepairs', '1');
      if (selectedBranch) queryParams.set('branch', selectedBranch);
      if (activeSearch.trim()) queryParams.set('search', activeSearch.trim());
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);

      fetcher(`/api/compressor-barcodes?${queryParams.toString()}`)
        .then((res) => setData(normalizeCompressorResponse(res)))
        .catch((err) => console.warn('[Auto-refresh] Silent poll error:', err));
    }, 60_000);

    return () => clearInterval(interval);
  }, [page, limit, activeSearch, selectedBranch, filterTab, repeatKind, dateType, startDate, endDate, sortKeys]);

  const toggleExpand = (serial: string) => {
    setExpandedSerials((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setActiveSearch('');
    setSelectedBranch('');
    setDateRange(defaultDateRange());
    setDateType('call_date');
    setFilterTab('repeat');
    setRepeatKind('all');
    setSortKeys([{ field: 'solve_date', dir: 'desc' }]);
    setPage(1);
  };

  const handleExportCsv = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);

      const queryParams = new URLSearchParams({
        filter: filterTab,
        kind: repeatKind,
        dateType,
        sort: buildSortParam(sortKeys),
        format: 'csv',
        excludeCancelled: '1',
      });

      if (filterTab === 'all') {
        queryParams.set('minRepairs', '1');
      }
      if (selectedBranch) {
        queryParams.set('branch', selectedBranch);
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

      const res = await fetch(`/api/compressor-barcodes?${queryParams.toString()}`);
      if (!res.ok) {
        throw new Error(`Export failed with HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `repeat_calls_${repeatKind}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV Export Error:', err);
      alert('Failed to export CSV. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  const isDateFiltered = dateRange.label !== 'All Time';
  const isGas = repeatKind === 'gas';
  const showBarcodes = repeatKind !== 'gas';
  const tableColSpan = showBarcodes ? 9 : 8;
  const kindCaption =
    repeatKind === 'gas'
      ? 'gas charging'
      : repeatKind === 'compressor'
        ? 'compressor replaced'
        : 'all work done';
  const filtersDirty =
    Boolean(activeSearch) ||
    Boolean(selectedBranch) ||
    filterTab !== 'repeat' ||
    repeatKind !== 'all' ||
    dateType !== 'call_date' ||
    !isDefaultDateRange(dateRange);

  const stats = data?.stats;

  return (
    <PageShell
      title="Repeat calls"
      subtitle={
        isGas
          ? 'Machines with gas charging done more than once on the same serial'
          : repeatKind === 'compressor'
            ? 'Machines with compressor replaced more than once, including barcode continuity'
            : 'Repeat compressor replacements and gas charging on the same machine'
      }
      icon={<Repeat className="h-4 w-4" />}
      toolbar={
        <>
          <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
            <div className="report-toolbar-filters-row items-center">
              <div className="flex items-center gap-1 self-center">
                {KIND_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                      repeatKind === tab.value
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-600'
                    }`}
                    onClick={() => {
                      setRepeatKind(tab.value);
                      if (tab.value === 'gas' && filterTab === 'broken') setFilterTab('repeat');
                      setPage(1);
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <FilterSelect
                label="Date column"
                emptyLabel="Call Date"
                mode="single"
                searchable={false}
                options={DATE_COLUMN_OPTIONS}
                selected={[dateType]}
                onChange={(values) => {
                  setDateType(values[0] === 'solve_date' ? 'solve_date' : 'call_date');
                  setPage(1);
                }}
                layout="inline"
                panelClassName="w-44"
              />
              <div className="report-toolbar-filters-date shrink-0">
                <DateRangeSelector
                  value={dateRange.label}
                  startDate={dateRange.start}
                  endDate={dateRange.end}
                  includeAllTime
                  onChange={(range) => {
                    setDateRange(range);
                    setPage(1);
                  }}
                />
              </div>
              {stats?.all_branches && stats.all_branches.length > 0 && (
                <FilterSelect
                  label="Branch"
                  emptyLabel="All Branches"
                  mode="single"
                  options={stats.all_branches.map((b) => ({ value: b, label: b }))}
                  selected={selectedBranch ? [selectedBranch] : []}
                  onChange={(values) => {
                    setSelectedBranch(values[values.length - 1] ?? '');
                    setPage(1);
                  }}
                  searchPlaceholder="Search branch…"
                  layout="inline"
                  panelClassName="w-72"
                />
              )}
              <div className="relative min-w-[14rem] flex-[1.4_1_14rem]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search serial, barcode, call no, office..."
                  className="h-8 w-full pl-8 pr-7 bg-white border border-slate-200 rounded-md text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:border-slate-400"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setActiveSearch('');
                      setPage(1);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {filtersDirty && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="h-8 inline-flex items-center gap-1 px-2 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md shrink-0 cursor-pointer"
                  title="Reset all filters"
                >
                  <RotateCcw className="h-2.5 w-2.5 text-slate-400" />
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Top Repeat Branches Hotspot Strip */}
          {stats?.top_branches && stats.top_branches.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1 bg-white border-b border-slate-200 overflow-x-auto custom-scrollbar shrink-0 text-xs">
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5 text-slate-400" /> Hotspots:
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedBranch('');
                  setPage(1);
                }}
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-medium transition-colors shrink-0 cursor-pointer ${!selectedBranch
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                All
              </button>
              {stats.top_branches.map((b) => {
                const isSelected = selectedBranch === b.branch_name;
                const cleanName = b.branch_name.replace(/^\d+\s*-\s*/, '').replace(/\s*BRANCH$/i, '');
                return (
                  <button
                    key={b.branch_name}
                    type="button"
                    onClick={() => {
                      setSelectedBranch(isSelected ? '' : b.branch_name);
                      setPage(1);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-medium transition-all shrink-0 cursor-pointer border ${isSelected
                        ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    title={`Filter repeat machines in ${b.branch_name}`}
                  >
                    <span>{cleanName}</span>
                    <span
                      className={`text-[9px] px-1 rounded-full font-bold ${isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                      {b.repeat_count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* KPI Stats Bar — counts follow kind, branch, and date range */}
          {stats && (
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/60">
              <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[10px] text-slate-500">
                <span>
                  KPIs for <span className="font-semibold text-slate-700">{kindCaption}</span>
                  {selectedBranch ? (
                    <>
                      {' · '}
                      <span className="font-semibold text-slate-700">
                        {selectedBranch.replace(/^\d+\s*-\s*/, '').replace(/\s*BRANCH$/i, '')}
                      </span>
                    </>
                  ) : null}
                  {isDateFiltered ? (
                    <>
                      {' · '}
                      <span className="font-semibold text-slate-700">{dateRange.label}</span>
                    </>
                  ) : (
                    ' · all time'
                  )}
                </span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5">
              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable min-w-0 flex-1 !min-h-0 !py-1.5 !px-2.5 ${filterTab === 'repeat' ? 'register-stat-item--active' : ''}`}
                onClick={() => {
                  setFilterTab('repeat');
                  setPage(1);
                }}
                title={isGas ? 'Filter machines with 2 or more gas charging calls in the date range' : 'Filter machines with 2 or more compressor repairs in the date range'}
              >
                <AnimatedMetric
                  value={stats.repeat_machines || 0}
                  className="register-stat-value !text-base font-bold text-slate-900"
                />
                <span className="register-stat-label truncate">
                  Repeat machines (2+)
                </span>
              </button>

              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable min-w-0 flex-1 !min-h-0 !py-1.5 !px-2.5 ${filterTab === 'premature' ? 'register-stat-item--active' : ''}`}
                onClick={() => {
                  setFilterTab('premature');
                  setPage(1);
                }}
                title="Filter machines with a repeat gap under 90 days"
              >
                <AnimatedMetric
                  value={stats.premature_machines || 0}
                  className="register-stat-value !text-base font-bold text-rose-600"
                />
                <span className="register-stat-label truncate text-rose-800">
                  Rapid re-fail (&lt;90d)
                </span>
              </button>

              {!isGas && (
                <button
                  type="button"
                  className={`register-stat-item register-stat-item--clickable min-w-0 flex-1 !min-h-0 !py-1.5 !px-2.5 ${filterTab === 'broken' ? 'register-stat-item--active' : ''}`}
                  onClick={() => {
                    setFilterTab('broken');
                    setPage(1);
                  }}
                  title="Filter machines where old barcode did not match previously installed barcode"
                >
                  <AnimatedMetric
                    value={stats.broken_machines || 0}
                    className="register-stat-value !text-base font-bold text-amber-600"
                  />
                  <span className="register-stat-label truncate text-amber-800">
                    Broken continuity
                  </span>
                </button>
              )}

              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable min-w-0 flex-1 !min-h-0 !py-1.5 !px-2.5 ${filterTab === 'repeat3' ? 'register-stat-item--active' : ''}`}
                onClick={() => {
                  setFilterTab('repeat3');
                  setPage(1);
                }}
                title={isGas ? 'Filter machines with 3 or more gas charging calls in the date range' : 'Filter machines with 3 or more compressor repairs in the date range'}
              >
                <AnimatedMetric
                  value={stats.three_plus_machines || 0}
                  className="register-stat-value !text-base font-bold text-indigo-600"
                />
                <span className="register-stat-label truncate">
                  Frequent repeat (3+)
                </span>
              </button>

              <button
                type="button"
                className={`register-stat-item register-stat-item--clickable min-w-0 flex-1 !min-h-0 !py-1.5 !px-2.5 ${filterTab === 'all' ? 'register-stat-item--active' : ''}`}
                onClick={() => {
                  setFilterTab('all');
                  setPage(1);
                }}
                title={isGas ? 'View all serials with gas charging in the date range' : 'View compressor serials in the date range'}
              >
                <AnimatedMetric
                  value={stats.total_machines || 0}
                  className="register-stat-value !text-base font-bold text-slate-700"
                />
                <span className="register-stat-label truncate">
                  {isDateFiltered ? 'Serials in period' : 'Total serials'}
                </span>
              </button>
            </div>
            </div>
          )}
        </>
      }
    >
      <PageScrollRegion className="p-2 sm:p-2.5 bg-bg-soft/70">
        <div className="flex flex-col gap-2 min-w-0 w-full max-w-full">
          {/* Main Table Card */}
          <AdminTableCard
            isEmpty={!isLoading && (!data?.data || data.data.length === 0)}
            empty={
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <AlertCircle className="h-8 w-8 text-slate-300 mb-2" />
                <p className="text-sm font-semibold text-slate-700">
                  {isGas
                    ? 'No gas charging records found'
                    : repeatKind === 'compressor'
                      ? 'No compressor records found'
                      : 'No repeat call records found'}
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {activeSearch
                    ? `No matches found for search "${activeSearch}".`
                    : isDateFiltered
                      ? 'No repairs match the selected date range.'
                      : filterTab === 'broken'
                        ? 'No machines with broken barcode continuity found.'
                        : isGas
                          ? 'No repeat gas charging records found.'
                          : repeatKind === 'compressor'
                            ? 'No repeat compressor repair records found.'
                            : 'No repeat compressor or gas charging records found.'}
                </p>
                {filtersDirty && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="mt-3 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset all filters
                  </button>
                )}
              </div>
            }
          >
            {/* Table Action Bar: Multi-sort Chips & CSV Export */}
            <div className="flex items-center justify-between gap-2 px-3 py-1 border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-600 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {sortKeys.length > 1 ? (
                  <>
                    <span className="font-semibold text-slate-500 uppercase tracking-wide text-[9.5px] mr-1">
                      Active Sort:
                    </span>
                    {sortKeys.map((k, i) => (
                      <span
                        key={k.field}
                        className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-blue-50/90 border border-blue-200 text-blue-800 text-[10px] font-medium"
                      >
                        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-blue-600 text-white text-[8px] font-bold">
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
                      className="text-[10px] text-slate-500 hover:text-slate-800 underline cursor-pointer ml-1"
                    >
                      Reset sort
                    </button>
                  </>
                ) : (
                  <span className="text-[10.5px] text-slate-500 font-medium">
                    Sorted by {SORT_LABELS[sortKeys[0]?.field] || 'Solved Date'} ({sortKeys[0]?.dir?.toUpperCase() || 'DESC'})
                  </span>
                )}
              </div>

              {/* Right Action: Export to CSV */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={!data?.total || isExporting}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                  title="Export all matching compressor records to CSV based on current filters (not limited to this page)"
                >
                  {isExporting ? (
                    <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3 text-slate-500" />
                  )}
                  {isExporting ? 'Exporting...' : 'Export CSV'}
                </button>
              </div>
            </div>

            <AdminTable>
              <AdminThead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold select-none">
                  <th className="w-8 px-2 py-1.5 text-center"></th>
                  {([
                    { field: 'serial_number', label: 'Serial Number' },
                    { field: 'total_calls', label: isGas ? 'Total Calls' : 'Total Repairs' },
                    { field: 'avg_days_gap', label: 'Avg Days Gap' },
                    { field: 'current_barcode', label: 'Current Barcode' },
                    { field: 'branch', label: 'Branch' },
                    { field: 'office', label: 'Latest Office / Workshop' },
                    { field: 'solve_date', label: 'Latest Solved Date' },
                    { field: 'call_date', label: 'Latest Call Date' },
                  ] as Array<{ field: string; label: string }>)
                    .filter((col) => showBarcodes || col.field !== 'current_barcode')
                    .map(({ field, label }) => {
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
                        className={`!bg-transparent hover:!bg-slate-100/70 transition-colors !px-2.5 !py-1.5 text-[10.5px] font-semibold uppercase tracking-wider ${active ? '!text-slate-900 font-bold' : 'text-slate-500'
                          }`}
                        title={`Click to sort by ${label}. Click again to toggle ASC/DESC.`}
                      >
                        <span className="flex items-center gap-1">
                          <span>{label}</span>
                          {priority !== null && (
                            <span className="inline-flex items-center justify-center w-3 h-3 text-[8.5px] font-bold rounded-full bg-blue-600 text-white leading-none">
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
                    <td colSpan={tableColSpan} className="h-40 text-center align-middle">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                      <span className="text-xs text-slate-400 mt-2 block">
                  {isGas
                    ? 'Loading gas charging records...'
                    : repeatKind === 'compressor'
                      ? 'Loading compressor records...'
                      : 'Loading repeat calls...'}
                      </span>
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

                    const allRowCalls = row.all_calls && row.all_calls.length > 0 ? row.all_calls : row.calls || [];
                    const validGaps = allRowCalls
                      .map((c) => c.days_gap)
                      .filter((g): g is number => g !== null && g !== undefined);
                    const minGap = validGaps.length > 0 ? Math.min(...validGaps) : Infinity;
                    const isRapid30 = minGap <= 30;
                    const isRapid90 = minGap <= 90 && minGap > 30;

                    return (
                      <React.Fragment key={row.serial_number}>
                        {/* Parent Machine Row */}
                        <AdminTr
                          onClick={() => toggleExpand(row.serial_number)}
                          className={`group transition-colors ${isBroken
                              ? isExpanded
                                ? 'bg-amber-50/60 border-l-[3px] border-l-amber-500'
                                : 'bg-amber-50/20 hover:bg-amber-50/40 border-l-[3px] border-l-amber-400'
                              : isExpanded
                                ? 'bg-blue-50/30 hover:bg-blue-50/50'
                                : 'hover:bg-slate-50/70'
                            }`}
                        >
                          <td className="w-8 px-2 py-1 text-center align-middle">
                            <ChevronDown
                              className={`h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 inline-block ${isExpanded ? 'transform rotate-180 text-blue-600' : ''
                                }`}
                            />
                          </td>
                          <AdminTd className="font-mono text-[11px] font-semibold text-slate-900 !py-1.5 !px-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="group-hover:text-blue-600 transition-colors">{row.serial_number}</span>
                              {[...new Set(allRowCalls.map(callRepairKind))].map((kind) => (
                                <RepairKindBadge key={kind} kind={kind} />
                              ))}
                              {isBroken && (
                                <span
                                  title="Continuity break detected midway in compressor replacement history"
                                  className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-semibold bg-amber-100/80 text-amber-800 border border-amber-300/80"
                                >
                                  <AlertTriangle className="h-2.5 w-2.5 text-amber-600 shrink-0" />
                                  Broken
                                </span>
                              )}
                              {isRapid30 && (
                                <span
                                  title={`Acute repeat failure: compressor re-failed within ${minGap} days!`}
                                  className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-300"
                                >
                                  <Zap className="h-2.5 w-2.5 text-rose-600 shrink-0" />
                                  &lt;30d Re-fail
                                </span>
                              )}
                              {isRapid90 && (
                                <span
                                  title={`Premature repeat failure: compressor re-failed within ${minGap} days`}
                                  className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-medium bg-amber-50 text-amber-700 border border-amber-200"
                                >
                                  <Clock className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                                  &lt;90d Gap
                                </span>
                              )}
                            </div>
                          </AdminTd>
                          <AdminTd className="!py-1.5 !px-2.5">
                            <div className="flex items-center gap-1">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10.5px] font-semibold border ${row.total_calls >= 5
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : row.total_calls >= 2
                                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                              >
                                {row.total_calls} {row.total_calls === 1 ? 'call' : 'calls'}
                              </span>
                              {isDateFiltered && row.calls_in_range != null && row.calls_in_range !== row.total_calls && (
                                <span className="text-[9.5px] text-blue-600 font-medium">
                                  ({row.calls_in_range} in period)
                                </span>
                              )}
                            </div>
                          </AdminTd>
                          <AdminTd className="!py-1.5 !px-2.5">
                            {row.avg_days_gap != null ? (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10.5px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                                {row.avg_days_gap} {row.avg_days_gap === 1 ? 'day' : 'days'}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </AdminTd>
                          {showBarcodes && (
                          <AdminTd className="!py-1.5 !px-2.5">
                            {row.current_barcode && row.current_barcode !== '-' ? (
                              <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded text-[10.5px] font-mono font-semibold">
                                {row.current_barcode}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-[10.5px] font-mono">-</span>
                            )}
                          </AdminTd>
                          )}
                          <AdminTd className="text-slate-700 text-[11px] !py-1.5 !px-2.5 max-w-[170px]">
                            <span className="truncate block" title={row.latest_branch || ''}>
                              {row.latest_branch || '—'}
                            </span>
                          </AdminTd>
                          <AdminTd className="text-slate-800 text-[11px] font-medium !py-1.5 !px-2.5 max-w-[200px]">
                            <div className="truncate flex items-center" title={row.latest_office || ''}>
                              <span className="truncate">{row.latest_office || '—'}</span>
                              {row.latest_sap_vendor_code ? (
                                <span className="text-slate-400 font-mono text-[9.5px] ml-1 shrink-0">
                                  ({row.latest_sap_vendor_code})
                                </span>
                              ) : null}
                            </div>
                          </AdminTd>
                          <AdminTd className="text-slate-600 text-[11px] font-medium tabular-nums !py-1.5 !px-2.5">
                            {formatDate(row.latest_solve_date)}
                          </AdminTd>
                          <AdminTd className="text-slate-500 text-[11px] tabular-nums !py-1.5 !px-2.5">
                            {formatDate(row.latest_call_date)}
                          </AdminTd>
                        </AdminTr>

                        {/* Expanded Child Accordion Lineage Table */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={tableColSpan} className="w-full max-w-0 overflow-hidden align-top p-0">
                              <div className="p-2.5 sm:p-3 pl-5 sm:pl-8 bg-slate-50/90 border-t border-slate-200/80 min-w-0 max-w-full overflow-hidden">
                                {/* Accordion Header Strip */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2 min-w-0">
                                  <div className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5 flex-wrap">
                                    <span>{isGas ? 'Gas charging history for serial:' : repeatKind === 'compressor' ? 'Replacement lineage for serial:' : 'Call history for serial:'}</span>
                                    <span className="font-mono text-blue-700 bg-blue-50/80 px-1.5 py-0.2 rounded border border-blue-200 font-bold">
                                      {row.serial_number}
                                    </span>
                                    {isDateFiltered && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (row.total_calls > displayedCalls.length) {
                                            setShowAllHistorySerials((prev) => {
                                              const next = new Set(prev);
                                              next.add(row.serial_number);
                                              return next;
                                            });
                                          }
                                        }}
                                        style={{
                                          backgroundColor: row.total_calls > displayedCalls.length ? '#fef3c7' : '#ecfdf5',
                                          borderColor: row.total_calls > displayedCalls.length ? '#f59e0b' : '#10b981',
                                          color: row.total_calls > displayedCalls.length ? '#78350f' : '#065f46',
                                        }}
                                        className={`text-[11px] px-2.5 py-1 rounded-md border font-semibold inline-flex items-center gap-1.5 transition-all ${
                                          row.total_calls > displayedCalls.length
                                            ? 'hover:brightness-95 cursor-pointer shadow-xs active:scale-95'
                                            : 'cursor-default'
                                        }`}
                                        title={
                                          row.total_calls > displayedCalls.length
                                            ? 'Click to reveal all historical calls'
                                            : 'Showing all calls'
                                        }
                                      >
                                        <span>
                                          Showing {displayedCalls.length} of {row.total_calls} calls
                                        </span>
                                        {row.total_calls > displayedCalls.length && (
                                          <span
                                            style={{ backgroundColor: '#d97706', color: '#ffffff' }}
                                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                                          >
                                            {row.total_calls - displayedCalls.length} hidden · Click to show all
                                          </span>
                                        )}
                                      </button>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-wrap">
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
                                        style={{
                                          backgroundColor: !showAllHistorySerials.has(row.serial_number) ? '#1d4ed8' : '#059669',
                                          borderColor: !showAllHistorySerials.has(row.serial_number) ? '#1e40af' : '#047857',
                                          color: '#ffffff',
                                        }}
                                        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer shadow-md border-2 hover:opacity-95 active:scale-95 ${
                                          !showAllHistorySerials.has(row.serial_number)
                                            ? 'ring-2 ring-blue-500/40'
                                            : 'ring-2 ring-emerald-500/40'
                                        }`}
                                        title={
                                          !showAllHistorySerials.has(row.serial_number)
                                            ? `Click to reveal all ${row.total_calls} historical repairs for machine ${row.serial_number}`
                                            : 'Currently showing complete lifetime history. Click to filter back to selected period.'
                                        }
                                      >
                                        {!showAllHistorySerials.has(row.serial_number) ? (
                                          <>
                                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-90"></span>
                                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
                                            </span>
                                            <History className="h-4 w-4 shrink-0 text-white" />
                                            <span className="text-white font-bold tracking-tight">
                                              View all {row.total_calls} historical calls
                                            </span>
                                            <span
                                              style={{ backgroundColor: '#f59e0b', color: '#0f172a' }}
                                              className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ml-1 shadow-xs"
                                            >
                                              +{row.total_calls - (row.calls?.length || 0)} older
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <History className="h-4 w-4 text-white shrink-0" />
                                            <span className="text-white font-bold">
                                              Showing all {row.total_calls} historical calls
                                            </span>
                                            <span className="text-[11px] text-emerald-100 underline font-normal ml-1">
                                              (Filter to {row.calls?.length || 0} in period)
                                            </span>
                                          </>
                                        )}
                                      </button>
                                    )}
                                    {isBroken && (
                                      <div className="inline-flex items-center gap-1 text-[10.5px] text-amber-900 bg-amber-100/90 border border-amber-300 px-2 py-0.5 rounded font-medium">
                                        <AlertTriangle className="h-3 w-3 text-amber-700 shrink-0" />
                                        <span>Continuity break: technician entered unexpected old barcode</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Visual Lineage Timeline Stepper */}
                                {displayedCalls.length > 1 && (
                                  <div className="bg-white rounded-md border border-slate-200/90 p-2 shadow-2xs mb-2 min-w-0 max-w-full overflow-hidden">
                                    <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
                                      <GitCommit className="h-3 w-3 text-blue-600" />
                                      <span>{isGas ? 'Call timeline' : repeatKind === 'all' ? 'Work-done timeline' : 'Repair lineage progression timeline'}</span>
                                    </div>
                                    <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1.5 min-w-0 max-w-full">
                                      {displayedCalls.map((call, idx) => {
                                        const isCallBroken = call.is_continuity_broken;
                                        const isAcuteGap = call.days_gap !== null && call.days_gap <= 30;
                                        const isShortGap = call.days_gap !== null && call.days_gap <= 90 && !isAcuteGap;

                                        return (
                                          <React.Fragment key={call.id || `stepper-${idx}`}>
                                            {/* Elapsed Gap Arrow if not first */}
                                            {idx > 0 && (
                                              <div className="flex flex-col items-center shrink-0 px-1 text-center min-w-[64px]">
                                                <span
                                                  className={`text-[8.5px] font-bold px-1.5 py-0.2 rounded-full border mb-0.5 whitespace-nowrap ${isAcuteGap
                                                      ? 'bg-rose-100 text-rose-800 border-rose-300 font-bold'
                                                      : isShortGap
                                                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                                    }`}
                                                >
                                                  +{call.days_gap ?? '?'}d gap
                                                </span>
                                                <div className="flex items-center w-full">
                                                  <div
                                                    className={`h-[2px] w-full ${isCallBroken ? 'bg-amber-500' : 'bg-slate-300'
                                                      }`}
                                                  />
                                                  <ArrowRight
                                                    className={`h-3 w-3 -ml-1 shrink-0 ${isCallBroken ? 'text-amber-600' : 'text-slate-400'
                                                      }`}
                                                  />
                                                </div>
                                                {isCallBroken && (
                                                  <span className="text-[8px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-0.5 mt-0.5">
                                                    Mismatch
                                                  </span>
                                                )}
                                              </div>
                                            )}

                                            {/* Call Node Card */}
                                            <div
                                              className={`flex flex-col p-2 rounded-md border min-w-[155px] max-w-[190px] shrink-0 transition-all ${isCallBroken
                                                  ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300'
                                                  : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                                <span className="font-mono font-bold text-[10.5px] text-slate-800 truncate">
                                                  #{idx + 1} {call.call_no}
                                                </span>
                                                <RepairKindBadge kind={callRepairKind(call)} />
                                              </div>
                                              <div className="text-[9.5px] text-slate-500 flex items-center gap-1 mb-0.5">
                                                <Calendar className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                                                <span>{formatDate(call.solve_date || call.call_date)}</span>
                                              </div>
                                              <div
                                                className="text-[9.5px] text-slate-700 truncate font-medium mb-1"
                                                title={call.office_name}
                                              >
                                                {call.office_name || '—'}
                                              </div>
                                              {callRepairKind(call) === 'compressor' && (
                                              <div className="mt-auto pt-1 border-t border-slate-200/80 flex items-center justify-between text-[9.5px] font-mono">
                                                <span className="text-slate-400">New:</span>
                                                <span
                                                  className="text-emerald-700 font-semibold truncate ml-1 max-w-[110px]"
                                                  title={call.derived_new_barcode}
                                                >
                                                  {call.derived_new_barcode || '—'}
                                                </span>
                                              </div>
                                              )}
                                            </div>
                                          </React.Fragment>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Lineage Table */}
                                <div className="overflow-x-auto custom-scrollbar bg-white rounded-md border border-slate-200/90 shadow-2xs min-w-0 max-w-full">
                                  <table className={`w-full text-xs text-left border-collapse ${showBarcodes ? 'min-w-[1080px]' : 'min-w-[820px]'}`}>
                                    <thead className="bg-slate-100/70 text-slate-600 uppercase text-[9.5px] font-semibold tracking-wider border-b border-slate-200">
                                      <tr>
                                        <th className="px-2 py-1.5 w-8 text-center">#</th>
                                        <th className="px-2.5 py-1.5">Call No</th>
                                        <th className="px-2.5 py-1.5">Work done</th>
                                        <th className="px-2.5 py-1.5">Status</th>
                                        <th className="px-2.5 py-1.5">Call Date</th>
                                        <th className="px-2.5 py-1.5">Solve Date</th>
                                        <th className="px-2.5 py-1.5">Days Gap</th>
                                        <th className="px-2.5 py-1.5">Branch</th>
                                        <th className="px-2.5 py-1.5">Office / Workshop</th>
                                        {showBarcodes && (
                                          <>
                                            <th className="px-2.5 py-1.5">Old Barcode (Removed)</th>
                                            <th className="px-1 py-1.5 text-center w-5"></th>
                                            <th className="px-2.5 py-1.5">New Barcode (Installed)</th>
                                          </>
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {displayedCalls.map((call, idx) => {
                                        const isCallBroken = call.is_continuity_broken;

                                        return (
                                          <tr
                                            key={call.id || `${call.call_no}-${idx}`}
                                            className={`transition-colors ${isCallBroken
                                                ? 'bg-amber-50/70 hover:bg-amber-50 border-l-[3px] border-l-amber-500'
                                                : 'hover:bg-slate-50/60'
                                              }`}
                                          >
                                            <td className="px-2 py-1.5 text-center text-slate-400 font-mono text-[9.5px]">
                                              {idx + 1}
                                            </td>
                                            <td className="px-2.5 py-1.5 font-mono font-medium text-slate-900 text-[10.5px]">
                                              {call.call_no}
                                            </td>
                                            <td className="px-2.5 py-1.5">
                                              <RepairKindBadge kind={callRepairKind(call)} />
                                            </td>
                                            <td className="px-2.5 py-1.5">
                                              {renderCallStatusBadge(call.call_status, call.cancel_reason)}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-slate-600 text-[10.5px] tabular-nums">
                                              {formatDate(call.call_date)}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-slate-800 font-medium text-[10.5px] tabular-nums">
                                              {formatDate(call.solve_date)}
                                            </td>
                                            <td className="px-2.5 py-1.5">
                                              {call.call_status === 'Cancelled' ? (
                                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                                                  NA
                                                </span>
                                              ) : call.days_gap != null ? (
                                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9.5px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                                  {call.days_gap} {call.days_gap === 1 ? 'day' : 'days'}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400 text-xs">—</span>
                                              )}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-slate-700 text-[10.5px]">
                                              {call.branch_name || '—'}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-slate-700 text-[10.5px]">
                                              <span>{call.office_name || '—'}</span>
                                              {call.sap_vendor_code ? (
                                                <span className="text-slate-400 font-mono text-[9px] ml-1">
                                                  ({call.sap_vendor_code})
                                                </span>
                                              ) : null}
                                            </td>
                                            {showBarcodes && (
                                              <>
                                            <td className="px-2.5 py-1.5">
                                              <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-1 flex-wrap">
                                                  {call.derived_old_barcode && call.derived_old_barcode !== '-' ? (
                                                    <>
                                                      <span
                                                        className={`px-1.5 py-0.2 rounded text-[10.5px] font-mono font-medium border ${isCallBroken
                                                            ? 'bg-rose-50 text-rose-800 border-rose-300 font-semibold'
                                                            : 'bg-slate-100 text-slate-700 border-slate-200'
                                                          }`}
                                                      >
                                                        {call.derived_old_barcode}
                                                      </span>
                                                      {(call.old_item_code || call.old_item_name) && (
                                                        <span className="text-[9.5px] text-slate-500 font-normal">
                                                          ({call.old_item_code ? `${call.old_item_code}` : ''}
                                                          {call.old_item_code && call.old_item_name ? ' - ' : ''}
                                                          {call.old_item_name || ''})
                                                        </span>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <span className="text-slate-400 italic text-[10.5px]">
                                                      Initial / Blank
                                                    </span>
                                                  )}
                                                </div>

                                                {isCallBroken && call.expected_old_barcode && (
                                                  <span className="text-[9.5px] text-rose-600 font-medium leading-tight mt-0.5 flex items-center gap-1">
                                                    <span>⚠️ Expected:</span>
                                                    <span className="font-mono bg-rose-50 px-1 rounded border border-rose-200 font-bold">
                                                      {call.expected_old_barcode}
                                                    </span>
                                                  </span>
                                                )}
                                              </div>
                                            </td>
                                            <td className="px-1 py-1.5 text-center text-slate-400">
                                              <ArrowRight className="h-3 w-3 inline" />
                                            </td>
                                            <td className="px-2.5 py-1.5">
                                              <div className="flex items-center gap-1 flex-wrap">
                                                {call.derived_new_barcode && call.derived_new_barcode !== '-' ? (
                                                  <>
                                                    <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded text-[10.5px] font-mono font-semibold">
                                                      {call.derived_new_barcode}
                                                    </span>
                                                    {(call.new_item_code || call.new_item_name) && (
                                                      <span className="text-[9.5px] text-slate-500 font-normal">
                                                        ({call.new_item_code ? `${call.new_item_code}` : ''}
                                                        {call.new_item_code && call.new_item_name ? ' - ' : ''}
                                                        {call.new_item_name || ''})
                                                      </span>
                                                    )}
                                                  </>
                                                ) : (
                                                  <span className="text-slate-400 italic text-[10.5px] font-mono">-</span>
                                                )}
                                              </div>
                                            </td>
                                              </>
                                            )}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {/* High-visibility demanding prompt when older history is hidden by date filter */}
                                {isDateFiltered && row.total_calls > (row.calls?.length || 0) && (
                                  <div
                                    onClick={() => {
                                      setShowAllHistorySerials((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(row.serial_number)) next.delete(row.serial_number);
                                        else next.add(row.serial_number);
                                        return next;
                                      });
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        setShowAllHistorySerials((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(row.serial_number)) next.delete(row.serial_number);
                                          else next.add(row.serial_number);
                                          return next;
                                        });
                                      }
                                    }}
                                    className={`mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border cursor-pointer transition-all duration-150 select-none ${
                                      !showAllHistorySerials.has(row.serial_number)
                                        ? 'bg-gradient-to-r from-blue-50 via-indigo-50/70 to-blue-50 border-blue-300 hover:border-blue-500 shadow-2xs hover:shadow-xs group ring-1 ring-blue-300/40'
                                        : 'bg-emerald-50/70 border-emerald-200 text-emerald-900 hover:bg-emerald-100/60'
                                    }`}
                                  >
                                    {!showAllHistorySerials.has(row.serial_number) ? (
                                      <>
                                        <div className="flex items-center gap-2.5 text-xs text-blue-950 font-medium min-w-0">
                                          <div className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                                            <History className="h-4 w-4" />
                                          </div>
                                          <div className="min-w-0">
                                            <span className="font-bold text-blue-900">
                                              Only showing {displayedCalls.length} of {row.total_calls} calls:
                                            </span>{' '}
                                            <span className="text-slate-600">
                                              {row.total_calls - displayedCalls.length} older historical {row.total_calls - displayedCalls.length === 1 ? 'repair is' : 'repairs are'} outside your date filter.
                                            </span>
                                          </div>
                                        </div>
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 group-hover:bg-blue-700 text-white text-xs font-bold rounded-md shadow-xs shrink-0 transition-colors">
                                          <History className="h-3.5 w-3.5" />
                                          <span>Click to View All {row.total_calls} Historical Calls</span>
                                          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-2 text-xs text-emerald-900 font-medium">
                                          <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                          <span>
                                            Showing complete history ({row.total_calls} calls) across full machine lifetime.
                                          </span>
                                        </div>
                                        <span className="text-[11px] text-emerald-800 hover:text-emerald-950 font-semibold underline shrink-0">
                                          Switch back to date-filtered period ({row.calls?.length || 0} call{row.calls?.length === 1 ? '' : 's'})
                                        </span>
                                      </>
                                    )}
                                  </div>
                                )}
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
          <div className="flex flex-col sm:flex-row items-center justify-between py-1.5 px-1 gap-2 text-[11px] text-slate-500 font-medium">
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

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 mr-1 text-[11px]">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}