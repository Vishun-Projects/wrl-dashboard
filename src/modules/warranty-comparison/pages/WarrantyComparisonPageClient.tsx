'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { PageAlert } from '@/components/ui/PageAlert';
import { usePageAlert } from '@/hooks/usePageAlert';
import { triggerBlobDownload } from '@/modules/mis/download';
import { defaultDateRange } from '@/modules/mis';
import { formatLocalDate } from '@/lib/dates/local-date';
import type { DateRange } from '@/modules/mis/register/components/DateRangeSelector';
import { WarrantyComparisonToolbar } from '../components/WarrantyComparisonToolbar';
import { WarrantyComparisonTabs } from '../components/WarrantyComparisonTabs';
import { WarrantyComparisonKpiCards } from '../components/WarrantyComparisonKpiCards';
import { WarrantyComparisonTable } from '../components/WarrantyComparisonTable';
import type {
  WarrantyComparisonFilterOptions,
  WarrantyComparisonRow,
  WarrantyComparisonSummary,
  WarrantyComparisonTab,
} from '../types';

export default function WarrantyComparisonPageClient() {
  const defaultRange = defaultDateRange();
  const [startDate, setStartDate] = useState<Date>(defaultRange.start);
  const [endDate, setEndDate] = useState<Date>(defaultRange.end);
  const [dateRangeLabel, setDateRangeLabel] = useState<string>(defaultRange.label);

  const [activeTab, setActiveTab] = useState<WarrantyComparisonTab>('oow_in_warr');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedCallTypes, setSelectedCallTypes] = useState<string[]>(['BREAKDOWN', 'P M VISIT']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [sortBy, setSortBy] = useState<string>('callDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [summary, setSummary] = useState<WarrantyComparisonSummary | null>(null);
  const [rows, setRows] = useState<WarrantyComparisonRow[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [options, setOptions] = useState<WarrantyComparisonFilterOptions>({
    branches: [],
    accounts: [],
    callTypes: [],
    statuses: [],
  });

  const [loadingSummary, setLoadingSummary] = useState<boolean>(true);
  const [loadingRows, setLoadingRows] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const { alert, setError, clear: clearAlert } = usePageAlert();

  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search input by 300ms
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  };

  // Helper to build URLSearchParams
  const buildQueryParams = useCallback(
    (mode: 'summary' | 'rows' | 'options') => {
      const params = new URLSearchParams();
      params.set('mode', mode);
      params.set('tab', activeTab);
      params.set('startDate', formatLocalDate(startDate));
      params.set('endDate', formatLocalDate(endDate));

      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedBranches.length > 0) params.set('branches', selectedBranches.join(','));
      if (selectedAccounts.length > 0) params.set('accounts', selectedAccounts.join(','));
      if (selectedCallTypes.length > 0) params.set('callTypes', selectedCallTypes.join(','));
      if (selectedStatuses.length > 0) params.set('statuses', selectedStatuses.join(','));

      if (mode === 'rows') {
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);
      }

      return params;
    },
    [
      activeTab,
      startDate,
      endDate,
      debouncedSearch,
      selectedBranches,
      selectedAccounts,
      selectedCallTypes,
      selectedStatuses,
      page,
      pageSize,
      sortBy,
      sortDir,
    ]
  );

  // Fetch summary metrics
  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const params = buildQueryParams('summary');
      const res = await fetch(`/api/report/warranty-comparison?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch summary (HTTP ${res.status})`);
      }
      const data: WarrantyComparisonSummary = await res.json();
      setSummary(data);
    } catch (err) {
      console.error('[warranty-comparison-summary]', err);
    } finally {
      setLoadingSummary(false);
    }
  }, [buildQueryParams]);

  // Fetch filter dropdown options
  const fetchOptions = useCallback(async () => {
    try {
      const params = buildQueryParams('options');
      const res = await fetch(`/api/report/warranty-comparison?${params.toString()}`);
      if (res.ok) {
        const data: WarrantyComparisonFilterOptions = await res.json();
        setOptions(data);
      }
    } catch (err) {
      console.error('[warranty-comparison-options]', err);
    }
  }, [buildQueryParams]);

  // Fetch mismatch rows
  const fetchRows = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abort = new AbortController();
    abortControllerRef.current = abort;

    setLoadingRows(true);
    clearAlert();

    try {
      const params = buildQueryParams('rows');
      const res = await fetch(`/api/report/warranty-comparison?${params.toString()}`, {
        signal: abort.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch rows (HTTP ${res.status})`);
      }

      const data = await res.json();
      setRows(data.rows || []);
      setTotalRows(data.total || 0);
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[warranty-comparison-rows]', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch comparison records.');
    } finally {
      if (!abort.signal.aborted) {
        setLoadingRows(false);
      }
    }
  }, [buildQueryParams, clearAlert, setError]);

  // Refetch when dates, tab, or filters change
  useEffect(() => {
    fetchSummary();
    fetchOptions();
  }, [fetchSummary, fetchOptions]);

  useEffect(() => {
    fetchRows();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchRows]);

  const handleDateRangeChange = (range: DateRange) => {
    setStartDate(range.start);
    setEndDate(range.end);
    setDateRangeLabel(range.label);
    setPage(1);
  };

  const handleTabChange = (newTab: WarrantyComparisonTab) => {
    setActiveTab(newTab);
    setPage(1);
  };

  const handleSortChange = (col: string) => {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = buildQueryParams('rows');
      params.set('format', 'csv');

      const res = await fetch(`/api/report/warranty-comparison?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const filename = `warranty_comparison_${activeTab}_${formatLocalDate(startDate)}_to_${formatLocalDate(endDate)}.csv`;
      await triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error('[warranty-comparison-export]', err);
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const headerActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          fetchSummary();
          fetchRows();
        }}
        disabled={loadingRows || loadingSummary}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
        title="Refresh data"
      >
        <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${loadingRows || loadingSummary ? 'animate-spin' : ''}`} />
        <span>Refresh</span>
      </button>

      <button
        type="button"
        onClick={handleExportCsv}
        disabled={exporting || loadingRows}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
        title="Export comparison to CSV"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
      </button>
    </div>
  );

  return (
    <PageShell
      title="Warranty Comparison"
      subtitle="Compare service call WCO against Warranty Master machine expiration dates"
      icon={<ShieldAlert className="h-4 w-4" />}
      actions={headerActions}
      toolbar={
        <WarrantyComparisonToolbar
          dateRangeLabel={dateRangeLabel}
          startDate={startDate}
          endDate={endDate}
          onDateRangeChange={handleDateRangeChange}
          search={search}
          onSearchChange={handleSearchChange}
          selectedBranches={selectedBranches}
          onBranchesChange={(b) => {
            setSelectedBranches(b);
            setPage(1);
          }}
          selectedAccounts={selectedAccounts}
          onAccountsChange={(a) => {
            setSelectedAccounts(a);
            setPage(1);
          }}
          selectedCallTypes={selectedCallTypes}
          onCallTypesChange={(ct) => {
            setSelectedCallTypes(ct);
            setPage(1);
          }}
          selectedStatuses={selectedStatuses}
          onStatusesChange={(st) => {
            setSelectedStatuses(st);
            setPage(1);
          }}
          options={options}
          loading={loadingRows || loadingSummary}
          exporting={exporting}
        />
      }
      bodyClassName="flex flex-col flex-1 min-h-0 bg-slate-50 overflow-hidden"
    >
        {/* KPI Cards */}
        <WarrantyComparisonKpiCards summary={summary} loading={loadingSummary} />

        {/* Tabs for Mismatch Categories */}
        <WarrantyComparisonTabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          summary={summary}
          loading={loadingSummary}
        />

        {/* Error Alert if any */}
        {alert && (
          <div className="p-3 pb-0">
            <PageAlert
              variant={alert.variant}
              message={alert.message}
              onDismiss={clearAlert}
            />
          </div>
        )}

        {/* Table & Pagination */}
        <PageScrollRegion className="flex-1 p-2 sm:p-3 pt-2 flex flex-col min-h-0">
          <WarrantyComparisonTable
            rows={rows}
            total={totalRows}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            loading={loadingRows}
          />
        </PageScrollRegion>
    </PageShell>
  );
}
