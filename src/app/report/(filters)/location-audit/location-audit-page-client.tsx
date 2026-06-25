'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { cookieAuthRequestConfig } from '@/lib/api/cookie-auth';
import { TrnLink } from '@/components/calls/TrnLink';
import {
  MapPin,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { RegisterPageFilters } from '@/components/register/RegisterPageFilters';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import {
  SUMMARY_DEFAULT_CALL_TYPE,
  formatReportScopeSubtitle,
  toDateString,
} from '@/lib/report/filters';
import {
  LocationAuditMapPlaceholder,
  LocationAuditRowDetail,
  type LocationAuditDetailRow,
} from '@/components/location-audit/LocationAuditRowDetail';
import { PageAlert } from '@/components/ui/PageAlert';
import { feedback } from '@/lib/ui/feedback';
import { usePageAlert } from '@/hooks/usePageAlert';
import { ReportLoadingPanel } from '@/components/report/ReportLoadingFeedback';
import { DataTableLoading } from '@/components/ui/DataTableLoading';
import { Loader2 } from 'lucide-react';

type LocationAuditStatus = 'mismatch' | 'ok' | 'no_gps' | 'no_address';

type AuditListRow = {
  vtrnno: string;
  ncode: string;
  officeId: string;
  partyName: string;
  address: string;
  pincode: string;
  branchName: string;
  franchiseeName: string;
  technicianName?: string;
  storedGpsPincode?: string;
  storedGpsPincodeArea?: string;
  pincodeMatchStatus?: 'same' | 'different' | 'unknown';
  gpsToInstallAreaKm?: number | null;
  status: LocationAuditStatus;
  severity?: string;
  mismatchExplanation?: string;
};

type AuditSummary = {
  totalCalls: number;
  analyzedCap?: number;
  pincodeMismatch: number;
  flagged?: number;
  review?: number;
  pincodeMatch: number;
  missingAddress: number;
  missingCrmGps: number;
  pincodeUnknown: number;
  missingInstallPincode: number;
};

type ByBranch = { branch: string; pincodeMismatch: number; total: number };

const LIST_PAGE_SIZE = 15;

function rowKey(row: { vtrnno: string; ncode: string }) {
  return `${row.vtrnno}-${row.ncode}`;
}

export default function LocationAuditPage() {
  const {
    appliedFilters,
    applyFilters,
    getAppliedFiltersSnapshot,
    resourcesLoaded,
    prefsReady,
  } = useReportFilters();

  const supabase = createClient();
  const [mounted, setMounted] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const { alert: pageAlert, setError: setPageError, clear: clearPageAlert } = usePageAlert();
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [byBranch, setByBranch] = useState<ByBranch[]>([]);
  const [branchOpen, setBranchOpen] = useState(false);
  const [rows, setRows] = useState<AuditListRow[]>([]);
  const [analyzedInWindow, setAnalyzedInWindow] = useState<number | null>(null);
  const [selectedListRow, setSelectedListRow] = useState<AuditListRow | null>(null);
  const [detailRow, setDetailRow] = useState<LocationAuditDetailRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadStage, setLoadStage] = useState<'idle' | 'summary' | 'list'>('idle');
  const [listPage, setListPage] = useState(1);

  const summaryAbortRef = useRef<AbortController | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const auditGenerationRef = useRef(0);
  const detailCacheRef = useRef<Map<string, LocationAuditDetailRow>>(new Map());
  const auditBootstrapRef = useRef(false);

  const applied = appliedFilters;
  const startDateStr = useMemo(
    () => (applied ? toDateString(applied.dateRange.start) : ''),
    [applied]
  );
  const endDateStr = useMemo(
    () => (applied ? toDateString(applied.dateRange.end) : ''),
    [applied]
  );

  const callTypeParam = useMemo(() => {
    if (!applied) return SUMMARY_DEFAULT_CALL_TYPE;
    if (applied.selectedCallTypes.length > 0) return applied.selectedCallTypes.join(',');
    return SUMMARY_DEFAULT_CALL_TYPE;
  }, [applied]);

  const scopeSubtitle = useMemo(() => {
    if (!applied) return 'Tech. solved · major · install pincode vs GPS pincode';
    const rangeLine = formatReportScopeSubtitle(
      applied.dateRange,
      applied.selectedBranch.length,
      applied.selectedFranchisee.length
    );
    return `${rangeLine} · major · pincode vs GPS`;
  }, [applied]);

  const wideScopeLoad = useMemo(
    () =>
      applied
        ? applied.selectedBranch.length === 0 && applied.selectedFranchisee.length === 0
        : false,
    [applied]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const resetAuditResults = useCallback(() => {
    summaryAbortRef.current?.abort();
    listAbortRef.current?.abort();
    detailAbortRef.current?.abort();
    detailCacheRef.current.clear();
    setHasLoadedOnce(false);
    setSummary(null);
    setByBranch([]);
    setRows([]);
    setAnalyzedInWindow(null);
    setSelectedListRow(null);
    setDetailRow(null);
    setSummaryLoading(false);
    setListLoading(false);
    setDetailLoading(false);
    setLoadStage('idle');
    setListPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    resetAuditResults();
    applyFilters({
      priorityFilter: ['major'],
      selectedCallTypes: [SUMMARY_DEFAULT_CALL_TYPE],
    });
  }, [applyFilters, resetAuditResults]);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const snap = getAppliedFiltersSnapshot();
      if (!snap) {
        return { ...(extra ?? {}) } as Record<string, string>;
      }
      const callType =
        snap.selectedCallTypes.length > 0
          ? snap.selectedCallTypes.join(',')
          : SUMMARY_DEFAULT_CALL_TYPE;
      const params: Record<string, string> = {
        startDate: toDateString(snap.dateRange.start),
        endDate: toDateString(snap.dateRange.end),
        callType,
        dateFilterColumn: snap.dateFilterColumn,
        ...extra,
      };
      if (snap.selectedOfficeIds.length > 0) {
        params.officeId = snap.selectedOfficeIds.join(',');
      }
      if (snap.selectedState.length > 0) params.state = snap.selectedState.join(',');
      if (snap.selectedCity.length > 0) params.city = snap.selectedCity.join(',');
      if (snap.selectedBranch.length > 0) params.branch = snap.selectedBranch.join(',');
      if (snap.selectedFranchisee.length > 0) {
        params.franchisee = snap.selectedFranchisee.join(',');
      }
      if (snap.selectedTechnician.length > 0) {
        params.technician = snap.selectedTechnician.join(',');
      }
      if (snap.pincodeSearch.trim()) params.pincode = snap.pincodeSearch.trim();
      return params;
    },
    [getAppliedFiltersSnapshot]
  );

  const runAudit = useCallback(async () => {
    const snap = getAppliedFiltersSnapshot();
    if (!snap) return;
    summaryAbortRef.current?.abort();
    listAbortRef.current?.abort();
    detailAbortRef.current?.abort();
    detailCacheRef.current.clear();
    setDetailRow(null);
    setSelectedListRow(null);

    const generation = auditGenerationRef.current + 1;
    auditGenerationRef.current = generation;
    const isStale = () => generation !== auditGenerationRef.current;

    const abort = new AbortController();
    summaryAbortRef.current = abort;
    listAbortRef.current = abort;

    setSummaryLoading(true);
    setListLoading(true);
    setLoadStage('summary');
    clearPageAlert();

    try {
      const qs = new URLSearchParams({
        ...buildParams(),
        mode: 'full',
      });
      const res = await fetch(`/api/report/location-audit?${qs.toString()}`, {
        credentials: 'include',
        signal: abort.signal,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
      }
      const data = (await res.json()) as {
        summary: AuditSummary;
        byBranch: ByBranch[];
        analyzedCount?: number;
        rows: AuditListRow[];
        total: number;
      };
      if (isStale() || abort.signal.aborted) return;
      setSummary(data.summary);
      setByBranch(data.byBranch ?? []);
      setAnalyzedInWindow(data.analyzedCount ?? null);
      setSummaryLoading(false);
      setHasLoadedOnce(true);
      setLoadStage('list');
      setRows(data.rows ?? []);
      setListPage(1);
      setSelectedListRow(data.rows?.[0] ?? null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (isStale()) return;
      const message = sanitizeUserFacingMessage(
        err instanceof Error ? err.message : 'Failed to load location audit'
      );
      setPageError(message);
    } finally {
      if (!isStale()) {
        setSummaryLoading(false);
        setListLoading(false);
        setLoadStage('idle');
      }
    }
  }, [getAppliedFiltersSnapshot, buildParams, clearPageAlert, setPageError]);

  useEffect(() => {
    if (!resourcesLoaded || !prefsReady || auditBootstrapRef.current) return;
    auditBootstrapRef.current = true;
    applyFilters({
      priorityFilter: ['major'],
      selectedCallTypes: [SUMMARY_DEFAULT_CALL_TYPE],
    });
  }, [resourcesLoaded, prefsReady, applyFilters]);

  const loadRowDetail = useCallback(
    async (list: AuditListRow) => {
      const key = rowKey(list);
      const cached = detailCacheRef.current.get(key);
      if (cached) {
        setDetailRow(cached);
        return;
      }

      detailAbortRef.current?.abort();
      const abort = new AbortController();
      detailAbortRef.current = abort;
      setDetailLoading(true);
      setDetailRow(null);

      try {
        const qs = new URLSearchParams({
          mode: 'row',
          ncode: list.ncode,
          officeId: list.officeId,
        });
        const res = await fetch(`/api/report/location-audit?${qs.toString()}`, {
          credentials: 'include',
          signal: abort.signal,
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
        }
        const json = (await res.json()) as { row: LocationAuditDetailRow };
        if (abort.signal.aborted) return;
        detailCacheRef.current.set(key, json.row);
        setDetailRow(json.row);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        feedback.actionFailed(
          sanitizeUserFacingMessage(
            err instanceof Error ? err.message : 'Failed to load call detail'
          )
        );
      } finally {
        if (!abort.signal.aborted) setDetailLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedListRow || !hasLoadedOnce) {
      setDetailRow(null);
      return;
    }
    void loadRowDetail(selectedListRow);
  }, [selectedListRow, hasLoadedOnce, loadRowDetail]);

  useEffect(() => {
    return () => {
      summaryAbortRef.current?.abort();
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await axios.get('/api/report/location-audit', {
        ...cookieAuthRequestConfig,
        timeout: 300_000,
        params: { ...buildParams(), format: 'csv' },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `location-audit-${startDateStr}-${endDateStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV exported');
    } catch {
      feedback.actionFailed('CSV export failed');
    } finally {
      setExporting(false);
    }
  };

  const loading = summaryLoading || listLoading;
  const auditUpdating = loading && hasLoadedOnce;
  const fetchBarLabel =
    loadStage === 'summary'
      ? 'Loading audit summary…'
      : loadStage === 'list'
        ? 'Loading mismatch calls…'
        : auditUpdating
          ? 'Updating audit…'
          : 'Loading audit…';

  const listTotalPages = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
  const listPageSafe = Math.min(listPage, listTotalPages);
  const pagedRows = useMemo(() => {
    const start = (listPageSafe - 1) * LIST_PAGE_SIZE;
    return rows.slice(start, start + LIST_PAGE_SIZE);
  }, [rows, listPageSafe]);

  useEffect(() => {
    if (listPage > listTotalPages) setListPage(listTotalPages);
  }, [listPage, listTotalPages]);

  if (!mounted || !resourcesLoaded || !prefsReady) {
    return (
      <PageShell title="Location Audit" icon={<MapPin className="h-4 w-4" />}>
        <ReportLoadingPanel label="Loading filters…" className="m-4 flex-1" />
      </PageShell>
    );
  }

  const pincodeMismatchCount = summary?.pincodeMismatch ?? 0;

  return (
    <PageShell
      title="Location Audit"
      subtitle={scopeSubtitle}
      icon={<MapPin className="h-4 w-4" />}
      toolbar={
        <RegisterPageFilters
          applyLabel="Run audit"
          onApply={() => void runAudit()}
          onDrawerApply={() => resetAuditResults()}
          onFilterRemoved={resetAuditResults}
          onClearAll={handleClearFilters}
          reloadOnClearAll={false}
        />
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={loading || exporting || !hasLoadedOnce}
            className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {exporting ? 'Exporting…' : 'CSV'}
          </button>
          {hasLoadedOnce && (
            <button
              type="button"
              onClick={() => void runAudit()}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      }
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
    >
      <PageScrollRegion className="gap-3 p-4">
        {!hasLoadedOnce && loading ? (
          <ReportLoadingPanel
            label={
              wideScopeLoad
                ? 'Running location audit for all branches — this month may take a minute'
                : 'Running location audit for your scope'
            }
          />
        ) : null}

        {!hasLoadedOnce && !loading ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-[11px] text-slate-600">
            Default filters are applied — click <strong>Run audit</strong> to load summary and
            mismatch calls. Row detail and maps load when you select a call.
          </div>
        ) : null}

        {pageAlert ? (
          <PageAlert
            variant={pageAlert.variant}
            message={pageAlert.message}
            onDismiss={clearPageAlert}
          />
        ) : null}

        {summary && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {analyzedInWindow != null ? (
              <AdminStatPill
                label="Calls in window"
                value={String(analyzedInWindow)}
              />
            ) : null}
            <AdminStatPill
              label="Pincode mismatches"
              value={String(pincodeMismatchCount)}
            />
          </div>
        )}

        {byBranch.length > 0 && hasLoadedOnce ? (
          <div className="shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setBranchOpen((o) => !o)}
              className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-[11px] font-semibold text-slate-700"
            >
              By branch (pincode mismatches)
              {branchOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {branchOpen ? (
              <AdminTable>
                <AdminThead>
                  <tr>
                    <AdminTh>Branch</AdminTh>
                    <AdminTh className="text-right">Mismatches</AdminTh>
                    <AdminTh className="text-right">Total</AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {byBranch.slice(0, 15).map((b) => (
                    <AdminTr key={b.branch}>
                      <AdminTd>{b.branch}</AdminTd>
                      <AdminTd className="text-right font-medium text-rose-700">
                        {b.pincodeMismatch}
                      </AdminTd>
                      <AdminTd className="text-right text-slate-600">{b.total}</AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            ) : null}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <p className="shrink-0 text-[11px] font-semibold text-slate-700">
              Pincode mismatch calls
              {hasLoadedOnce && !listLoading && rows.length > 0
                ? ` (${rows.length})`
                : ''}
            </p>

            <div className="flex min-h-0 flex-1 flex-col">
            <AdminTableCard isEmpty={hasLoadedOnce && !listLoading && rows.length === 0}>
              <DataTableLoading
                loading={listLoading && rows.length === 0 && hasLoadedOnce}
                updating={listLoading && rows.length > 0}
                hasContent={rows.length > 0}
                loadingLabel={fetchBarLabel}
                updatingLabel="Refreshing call list…"
              >
              {!hasLoadedOnce ? (
                <p className="py-8 text-center text-[11px] text-slate-500">
                  Click <strong>Run audit</strong> to load calls.
                </p>
              ) : rows.length === 0 && !listLoading ? (
                <p className="py-8 text-center text-[11px] text-slate-500">
                  No calls match the current filters.
                </p>
              ) : rows.length === 0 ? null : (
                <AdminTable>
                    <AdminThead>
                      <tr>
                        <AdminTh>Call</AdminTh>
                        <AdminTh>Branch</AdminTh>
                        <AdminTh>Install pin</AdminTh>
                        <AdminTh>GPS pin</AdminTh>
                      </tr>
                    </AdminThead>
                    <tbody>
                      {pagedRows.map((row) => {
                        const key = rowKey(row);
                        const isSelected =
                          selectedListRow != null && rowKey(selectedListRow) === key;
                        return (
                          <AdminTr
                            key={key}
                            className={
                              isSelected ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200' : ''
                            }
                            onClick={() => setSelectedListRow(row)}
                          >
                            <AdminTd>
                              <TrnLink
                                trn={row.vtrnno}
                                callId={row.ncode}
                                officeId={row.officeId}
                                className="font-medium text-blue-700 hover:underline"
                              />
                            </AdminTd>
                            <AdminTd className="max-w-[100px] truncate text-[10px]">
                              {row.branchName || '—'}
                            </AdminTd>
                            <AdminTd className="font-mono text-[10px]">{row.pincode || '—'}</AdminTd>
                            <AdminTd
                              className={`font-mono text-[10px] ${
                                row.pincodeMatchStatus === 'different'
                                  ? 'font-semibold text-rose-700'
                                  : ''
                              }`}
                            >
                              {row.storedGpsPincode || '—'}
                            </AdminTd>
                          </AdminTr>
                        );
                      })}
                    </tbody>
                  </AdminTable>
              )}
              </DataTableLoading>
            </AdminTableCard>
            {hasLoadedOnce && rows.length > 0 && !listLoading ? (
              <div className="flex shrink-0 items-center justify-between rounded-b-xl border border-t-0 border-slate-200 bg-white px-3 py-2 shadow-sm">
                <span className="text-[11px] text-slate-500">
                  {(listPageSafe - 1) * LIST_PAGE_SIZE + 1}–
                  {Math.min(listPageSafe * LIST_PAGE_SIZE, rows.length)} of{' '}
                  {rows.length.toLocaleString('en-IN')} mismatches
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={listPageSafe <= 1}
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4rem] text-center text-[11px] font-medium text-slate-700">
                    {listPageSafe} / {listTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={listPageSafe >= listTotalPages}
                    onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {selectedListRow ? (
              <LocationAuditRowDetail
                row={detailRow}
                loading={detailLoading}
                pincodeOnly
                onClose={() => {
                  setSelectedListRow(null);
                  setDetailRow(null);
                }}
              />
            ) : (
              <LocationAuditMapPlaceholder />
            )}
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
