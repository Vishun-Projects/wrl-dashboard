'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import {
  ScanBarcode,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { RegisterPageFilters } from '@/components/RegisterPageFilters';
import { ReportLoadingPanel } from '@/components/ReportLoadingFeedback';
import { PageShell } from '@/components/PageShell';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminToolbar,
  AdminTr,
} from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import { buildCorpusCacheKey } from '@/lib/report-corpus';
import { callCorpusStore } from '@/lib/report-data-store';
import { MAX_CLIENT_CORPUS_DAYS } from '@/lib/trhcalls-query';
import {
  aggregateComplaintsBySerial,
  buildCallsBySerialMap,
  filterSerialAuditRows,
  getWindowCallsForSerialAudit,
  mapApiListItemToSerialAuditRow,
  mapRowToSerialAuditCallDetail,
  MIN_REPEAT_COMPLAINTS,
  sortSerialAuditCallDetails,
  summarizeSerialAudit,
  type SerialAuditCallDetail,
  type SerialAuditRow,
} from '@/lib/serial-complaint-audit';
import { SerialAuditCallsDetailTable } from '@/components/SerialAuditCallsDetailTable';
import { toast } from 'sonner';

const DEFAULT_RISK_THRESHOLD = 3;
const SERIAL_PAGE_SIZE = 25;

/** Survives tab navigation — in-flight loads keep running in the background. */
const serialAuditBackgroundCache = new Map<
  string,
  { rows: SerialAuditRow[]; windowCalls: Map<string, SerialAuditCallDetail[]> }
>();
const serialAuditBackgroundInflight = new Map<string, Promise<void>>();

function dateRangeSpanDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

export default function SerialAuditPage() {
  const {
    dateRange,
    selectedCallTypes,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedOfficeIds,
    selectedStatus,
    priorityFilter,
    portalFilter,
    pincodeSearch,
    search,
    resourcesLoaded,
    ensureCorpusLoaded,
  } = useReportFilters();

  const startDateStr = useMemo(
    () =>
      dateRange.start instanceof Date
        ? dateRange.start.toISOString().split('T')[0]
        : String(dateRange.start),
    [dateRange.start]
  );
  const endDateStr = useMemo(
    () =>
      dateRange.end instanceof Date ? dateRange.end.toISOString().split('T')[0] : String(dateRange.end),
    [dateRange.end]
  );
  const callTypeParam = useMemo(
    () => (selectedCallTypes.length === 0 ? 'All' : selectedCallTypes.join(',')),
    [selectedCallTypes]
  );

  const filterParts = useMemo(
    () => ({
      search,
      pincodeSearch,
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
    }),
    [
      search,
      pincodeSearch,
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
    ]
  );

  const dateRangeLabel = useMemo(
    () => `${startDateStr} → ${endDateStr}`,
    [startDateStr, endDateStr]
  );

  const corpusWindowKey = useMemo(
    () => buildCorpusCacheKey(startDateStr, endDateStr),
    [startDateStr, endDateStr]
  );

  const dataKey = useMemo(
    () => JSON.stringify({ corpusWindowKey, filterParts }),
    [corpusWindowKey, filterParts]
  );

  const supabase = createClient();
  const [mounted, setMounted] = useState(false);
  const [serialSearch, setSerialSearch] = useState('');
  const [minCount, setMinCount] = useState(MIN_REPEAT_COMPLAINTS);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null);
  const [listRows, setListRows] = useState<SerialAuditRow[]>([]);
  const [windowCallsBySerial, setWindowCallsBySerial] = useState<Map<string, SerialAuditCallDetail[]>>(
    new Map()
  );
  const [allTimeCallsBySerial, setAllTimeCallsBySerial] = useState<Map<string, SerialAuditCallDetail[]>>(
    new Map()
  );
  const [showAllTimeFor, setShowAllTimeFor] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const lastPaintedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const applyCachedSnapshot = useCallback(
    (cached: { rows: SerialAuditRow[]; windowCalls: Map<string, SerialAuditCallDetail[]> }) => {
      setListRows(cached.rows);
      setWindowCallsBySerial(cached.windowCalls);
      setLoadError(null);
      lastPaintedKeyRef.current = dataKey;
    },
    [dataKey]
  );

  const paintFromCorpus = useCallback((): SerialAuditRow[] => {
    const calls = getWindowCallsForSerialAudit(filterParts, corpusWindowKey);
    const rows = aggregateComplaintsBySerial(calls, DEFAULT_RISK_THRESHOLD, MIN_REPEAT_COMPLAINTS);
    const windowCalls = buildCallsBySerialMap(calls);
    setListRows(rows);
    setWindowCallsBySerial(windowCalls);
    setAllTimeCallsBySerial(new Map());
    setShowAllTimeFor(new Set());
    setLoadError(null);
    lastPaintedKeyRef.current = dataKey;
    serialAuditBackgroundCache.set(dataKey, { rows, windowCalls });
    return rows;
  }, [corpusWindowKey, dataKey, filterParts]);

  const loadWindowData = useCallback(
    async (opts?: { force?: boolean; refresh?: boolean }) => {
      const existingInflight = serialAuditBackgroundInflight.get(dataKey);
      if (existingInflight && !opts?.force && !opts?.refresh) {
        await existingInflight;
        const cached = serialAuditBackgroundCache.get(dataKey);
        if (cached) applyCachedSnapshot(cached);
        return;
      }

      if (!opts?.refresh && !opts?.force && lastPaintedKeyRef.current === dataKey) {
        const cached = serialAuditBackgroundCache.get(dataKey);
        if (cached) {
          applyCachedSnapshot(cached);
          return;
        }
      }

      const run = (async () => {
        if (opts?.refresh) {
          lastPaintedKeyRef.current = null;
          serialAuditBackgroundCache.delete(dataKey);
        }

        setLoadError(null);
        setExpandedSerial(null);
        setLoading(true);

        try {
          const spanDays = dateRangeSpanDays(
            dateRange.start instanceof Date ? dateRange.start : new Date(startDateStr),
            dateRange.end instanceof Date ? dateRange.end : new Date(endDateStr)
          );
          const corpusReady =
            spanDays <= MAX_CLIENT_CORPUS_DAYS &&
            callCorpusStore?.cacheKey === corpusWindowKey &&
            (callCorpusStore?.calls.size ?? 0) > 0;

          if (corpusReady) {
            paintFromCorpus();
            return;
          }

          void ensureCorpusLoaded({ silent: true });

          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers = session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {};

          const res = await axios.get('/api/report/serial-audit', {
            headers,
            timeout: 300000,
            params: {
              startDate: startDateStr,
              endDate: endDateStr,
              callType: callTypeParam,
              minRepeats: MIN_REPEAT_COMPLAINTS,
              ...(opts?.refresh ? { refresh: 'true' } : {}),
            },
          });

          const apiRows = ((res.data?.serials || []) as Record<string, unknown>[]).map((item) =>
            mapApiListItemToSerialAuditRow(
              item as Parameters<typeof mapApiListItemToSerialAuditRow>[0],
              DEFAULT_RISK_THRESHOLD
            )
          );
          apiRows.sort((a, b) => {
            const dateCmp = (b.lastComplaintDate ?? '').localeCompare(a.lastComplaintDate ?? '');
            if (dateCmp !== 0) return dateCmp;
            return b.complaintCount - a.complaintCount;
          });

          const emptyWindowCalls = new Map<string, SerialAuditCallDetail[]>();
          setListRows(apiRows);
          setWindowCallsBySerial(emptyWindowCalls);
          setAllTimeCallsBySerial(new Map());
          setShowAllTimeFor(new Set());
          lastPaintedKeyRef.current = dataKey;
          serialAuditBackgroundCache.set(dataKey, { rows: apiRows, windowCalls: emptyWindowCalls });
        } catch (err: unknown) {
          const message =
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Failed to load serial audit data';
          setLoadError(message);
          toast.error(message);
        } finally {
          setLoading(false);
        }
      })();

      serialAuditBackgroundInflight.set(dataKey, run);
      loadInFlightRef.current = run;
      try {
        await run;
      } finally {
        serialAuditBackgroundInflight.delete(dataKey);
        if (loadInFlightRef.current === run) {
          loadInFlightRef.current = null;
        }
      }
    },
    [
      applyCachedSnapshot,
      callTypeParam,
      corpusWindowKey,
      dataKey,
      dateRange.end,
      dateRange.start,
      endDateStr,
      ensureCorpusLoaded,
      paintFromCorpus,
      startDateStr,
      supabase,
    ]
  );

  const loadSerialDetails = useCallback(
    async (serial: string, scope: 'window' | 'allTime') => {
      let alreadyLoaded = false;
      if (scope === 'allTime') {
        setAllTimeCallsBySerial((prev) => {
          alreadyLoaded = prev.has(serial) && (prev.get(serial)?.length ?? 0) > 0;
          return prev;
        });
      } else {
        setWindowCallsBySerial((prev) => {
          alreadyLoaded = prev.has(serial) && (prev.get(serial)?.length ?? 0) > 0;
          return prev;
        });
      }
      if (alreadyLoaded) return;

      setDetailLoading(`${scope}:${serial}`);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const params: Record<string, string> = {
          callType: callTypeParam,
          serial,
        };
        if (scope === 'window') {
          params.startDate = startDateStr;
          params.endDate = endDateStr;
        }
        const res = await axios.get('/api/report/serial-audit', {
          headers,
          timeout: 120000,
          params,
        });
        const rawCalls = (res.data?.calls || []) as Record<string, unknown>[];
        const details = sortSerialAuditCallDetails(
          rawCalls.map(mapRowToSerialAuditCallDetail),
          'asc'
        );
        if (scope === 'allTime') {
          setAllTimeCallsBySerial((prev) => new Map(prev).set(serial, details));
        } else {
          setWindowCallsBySerial((prev) => new Map(prev).set(serial, details));
        }
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load call details';
        toast.error(message);
      } finally {
        setDetailLoading(null);
      }
    },
    [callTypeParam, endDateStr, startDateStr, supabase]
  );

  useEffect(() => {
    if (!resourcesLoaded) return;
    const cached = serialAuditBackgroundCache.get(dataKey);
    if (cached) {
      applyCachedSnapshot(cached);
      return;
    }
    lastPaintedKeyRef.current = null;
    setListRows([]);
    setWindowCallsBySerial(new Map());
    setAllTimeCallsBySerial(new Map());
    setShowAllTimeFor(new Set());
    setExpandedSerial(null);
  }, [applyCachedSnapshot, dataKey, resourcesLoaded]);

  useEffect(() => {
    if (!resourcesLoaded) return;
    void loadWindowData();
  }, [resourcesLoaded, dataKey, loadWindowData]);

  useEffect(() => {
    if (!expandedSerial) return;
    if (showAllTimeFor.has(expandedSerial)) return;
    const windowCalls = windowCallsBySerial.get(expandedSerial);
    if (windowCalls?.length) return;
    void loadSerialDetails(expandedSerial, 'window');
  }, [expandedSerial, loadSerialDetails, showAllTimeFor, windowCallsBySerial]);

  const allSerialRows = useMemo(() => listRows, [listRows]);

  const displayedRows = useMemo(
    () =>
      filterSerialAuditRows(allSerialRows, {
        minCount: onlyFlagged ? DEFAULT_RISK_THRESHOLD : minCount,
        search: serialSearch,
        onlyFlagged,
        hideUnknown: true,
      }),
    [allSerialRows, minCount, serialSearch, onlyFlagged]
  );

  const totalPages = Math.max(1, Math.ceil(displayedRows.length / SERIAL_PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [serialSearch, minCount, onlyFlagged, filterParts]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * SERIAL_PAGE_SIZE;
    return displayedRows.slice(start, start + SERIAL_PAGE_SIZE);
  }, [displayedRows, page]);

  const summary = useMemo(
    () => summarizeSerialAudit(allSerialRows, DEFAULT_RISK_THRESHOLD),
    [allSerialRows]
  );

  const toggleExpand = (serial: string) => {
    setExpandedSerial((prev) => {
      if (prev === serial) {
        setShowAllTimeFor((s) => {
          const next = new Set(s);
          next.delete(serial);
          return next;
        });
        return null;
      }
      return serial;
    });
  };

  const handleShowAllTimeChange = useCallback(
    (serial: string, enabled: boolean) => {
      setShowAllTimeFor((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(serial);
        else next.delete(serial);
        return next;
      });
      if (enabled && !allTimeCallsBySerial.has(serial)) {
        void loadSerialDetails(serial, 'allTime');
      }
    },
    [allTimeCallsBySerial, loadSerialDetails]
  );

  if (!mounted || !resourcesLoaded) {
    return (
      <PageShell title="Serial Audit" icon={<ScanBarcode className="h-4 w-4" />}>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Serial Audit"
      subtitle="Repeat complaints in the selected date range — expand for call details"
      icon={<ScanBarcode className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWindowData({ refresh: true })}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-3 w-3" />
            Call Register
          </Link>
        </div>
      }
      toolbar={
        <RegisterPageFilters
          loading={loading && listRows.length === 0}
          loadingLabel="Loading repeated serial numbers…"
        />
      }
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-slate-50 p-4"
    >
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <AdminStatPill label="Repeated serials" value={loading ? '…' : summary.totalSerials} />
        <AdminStatPill label="Flagged (≥3)" value={loading ? '…' : summary.flaggedCount} />
        <AdminStatPill label="Max complaints" value={loading ? '…' : summary.maxComplaints} />
      </div>

      <AdminToolbar
        search={serialSearch}
        onSearchChange={setSerialSearch}
        searchPlaceholder="Search serial number…"
      >
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="text-slate-400">Min repeats</span>
          <input
            type="number"
            min={MIN_REPEAT_COMPLAINTS}
            max={99}
            value={minCount}
            disabled={onlyFlagged}
            onChange={(e) =>
              setMinCount(Math.max(MIN_REPEAT_COMPLAINTS, Number(e.target.value) || MIN_REPEAT_COMPLAINTS))
            }
            className="w-14 rounded border border-slate-200 px-2 py-1 text-[11px]"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
            className="rounded border-slate-300"
          />
          Flagged only
        </label>
      </AdminToolbar>

      {loading && listRows.length === 0 ? (
        <ReportLoadingPanel
          label="Finding repeated serial numbers"
          sublabel="Running a focused SQL scan for your date range (no full corpus download)."
        />
      ) : loadError && listRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-medium text-slate-700">Could not load serial audit data</p>
          <p className="max-w-md text-[11px] text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadWindowData({ refresh: true })}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : listRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-700">No repeat serials found</p>
          <p className="max-w-md text-[11px] text-slate-500">
            No device serial has {MIN_REPEAT_COMPLAINTS} or more calls in the selected date range.
          </p>
        </div>
      ) : (
        <AdminTableCard
          isEmpty={displayedRows.length === 0}
          empty={
            <>
              <p className="text-sm font-medium text-slate-600">No serials match filters</p>
              <p className="text-[11px] text-slate-400">
                Lower &quot;Min repeats&quot; or clear &quot;Flagged only&quot;.
              </p>
            </>
          }
        >
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh className="w-8">
                  <span className="sr-only">Expand</span>
                </AdminTh>
                <AdminTh>Serial</AdminTh>
                <AdminTh align="right">Complaints</AdminTh>
                <AdminTh align="right">Open</AdminTh>
                <AdminTh align="right">Solved</AdminTh>
                <AdminTh align="right">Cancelled</AdminTh>
                <AdminTh>Branches</AdminTh>
                <AdminTh>Customers</AdminTh>
                <AdminTh>Last date</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {pagedRows.map((row) => (
                <SerialAuditTableRow
                  key={row.serial}
                  row={row}
                  windowCalls={windowCallsBySerial.get(row.serial) ?? []}
                  allTimeCalls={allTimeCallsBySerial.get(row.serial) ?? []}
                  showAllTime={showAllTimeFor.has(row.serial)}
                  onShowAllTimeChange={(enabled) => handleShowAllTimeChange(row.serial, enabled)}
                  dateRangeLabel={dateRangeLabel}
                  detailLoading={detailLoading === `window:${row.serial}` || detailLoading === `allTime:${row.serial}`}
                  expanded={expandedSerial === row.serial}
                  onToggle={() => toggleExpand(row.serial)}
                />
              ))}
            </tbody>
          </AdminTable>
          {displayedRows.length > SERIAL_PAGE_SIZE ? (
            <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-[11px] text-slate-500">
                {(page - 1) * SERIAL_PAGE_SIZE + 1}–
                {Math.min(page * SERIAL_PAGE_SIZE, displayedRows.length)} of{' '}
                {displayedRows.length.toLocaleString()} serials
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[4rem] text-center text-[11px] font-medium text-slate-700">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </AdminTableCard>
      )}
    </PageShell>
  );
}

function SerialAuditTableRow({
  row,
  windowCalls,
  allTimeCalls,
  showAllTime,
  onShowAllTimeChange,
  dateRangeLabel,
  detailLoading,
  expanded,
  onToggle,
}: {
  row: SerialAuditRow;
  windowCalls: SerialAuditCallDetail[];
  allTimeCalls: SerialAuditCallDetail[];
  showAllTime: boolean;
  onShowAllTimeChange: (enabled: boolean) => void;
  dateRangeLabel: string;
  detailLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const flagged = row.riskFlag;
  const rowBg = flagged ? 'bg-amber-50/80 hover:bg-amber-50' : '';
  const displayCalls = showAllTime ? allTimeCalls : windowCalls;
  const allTimeLoading = showAllTime && detailLoading && allTimeCalls.length === 0;
  const windowLoading = !showAllTime && detailLoading && windowCalls.length === 0;

  return (
    <>
      <AdminTr>
        <AdminTd className={`w-8 ${rowBg}`}>
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </AdminTd>
        <AdminTd className={`font-mono text-[11px] ${rowBg}`}>
          <span className={flagged ? 'font-semibold text-amber-900' : 'text-slate-800'}>
            {row.serial}
          </span>
          {flagged ? (
            <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-900">
              Flagged
            </span>
          ) : null}
        </AdminTd>
        <AdminTd align="right" className={`font-semibold tabular-nums ${rowBg}`}>
          {row.complaintCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-blue-700 ${rowBg}`}>
          {row.openCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-emerald-700 ${rowBg}`}>
          {row.solvedCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-rose-600 ${rowBg}`}>
          {row.cancelledCount}
        </AdminTd>
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {row.uniqueBranches.length > 0
            ? row.uniqueBranches.slice(0, 2).join(', ') +
              (row.uniqueBranches.length > 2 ? ` +${row.uniqueBranches.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {row.uniqueCustomers.length > 0
            ? row.uniqueCustomers.slice(0, 2).join(', ') +
              (row.uniqueCustomers.length > 2 ? ` +${row.uniqueCustomers.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`whitespace-nowrap text-[11px] text-slate-600 ${rowBg}`}>
          {row.lastComplaintDate ? row.lastComplaintDate.slice(0, 10) : '—'}
        </AdminTd>
      </AdminTr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50/80">
          <td colSpan={9} className="px-3 py-3">
            {displayCalls.length === 0 && !allTimeLoading && !windowLoading ? (
              <p className="py-4 text-center text-[11px] text-slate-500">
                No calls for this serial in the selected date range.
              </p>
            ) : (
              <SerialAuditCallsDetailTable
                calls={displayCalls}
                serial={row.serial}
                scope={showAllTime ? 'allTime' : 'window'}
                dateRangeLabel={dateRangeLabel}
                showAllTime={showAllTime}
                onShowAllTimeChange={onShowAllTimeChange}
                allTimeLoading={allTimeLoading || windowLoading}
                allTimeCount={allTimeCalls.length > 0 ? allTimeCalls.length : undefined}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
