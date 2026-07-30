'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PageScrollRegion } from '@/components/layout/PageShell';
import { useUser } from '@/components/layout/DashboardLayout';
import { CallRegisterToolbar } from '@/features/report/ui/call-register/CallRegisterToolbar';
import { CallRegisterGrid } from '@/features/report/ui/call-register/CallRegisterGrid';
import { CallRegisterSerialPanel } from '@/features/report/ui/call-register/CallRegisterSerialPanel';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { PageAlert } from '@/components/ui/PageAlert';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import type { CallRegisterRow, CallRegisterSummary } from '@/features/report/lib/call-register/types';
import type { CallRegisterDateField } from '@/features/report/lib/call-register/dates';
import { usePageAlert } from '@/hooks/usePageAlert';
import {
  triggerBlobDownload,
  workbookToPreparedExport,
  type PreparedFileExport,
} from '@/features/report/lib/summary-excel-export';
import type { ExportQueueProgress, ExportQueueRunContext } from '@/features/report/lib/export-queue';
import type { MisTabId } from '@/lib/auth/rbac-catalog';
import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import { canSeeAllCallRegisterClients } from '@/lib/call-register/clients';
import type { CallRegisterSerialExportRow } from '@/features/report/lib/call-register/shape';
import { buildCallRegisterSerialWorkbook } from '@/features/report/lib/call-register/excel-export';
import { logClientExportAction } from '@/lib/security/client-export-audit';

function getDefaultDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: firstDay.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

function summaryFromRows(rows: CallRegisterRow[]): CallRegisterSummary {
  let totalQty = 0;
  let totalInstallation = 0;
  let totalDeployment = 0;
  for (const row of rows) {
    totalQty += row.qty;
    totalInstallation += row.installation;
    totalDeployment += row.deployment;
  }
  return {
    totalQty,
    totalInstallation,
    totalDeployment,
    totalBalanceInstallation: totalQty - totalInstallation,
    totalBalanceDeployment: totalQty - totalDeployment,
  };
}

function sameClientSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((c) => set.has(c));
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

type EnqueueExport = (
  label: string,
  run: (ctx: ExportQueueRunContext) => Promise<PreparedFileExport>,
  meta?: { sourceTab?: MisTabId; kind?: 'standard' | 'trace' }
) => string;

type CallRegisterClientProps = {
  enqueueExport?: EnqueueExport;
  /** When parent drives MIS export queue for this tab. */
  isExporting?: boolean;
};

export function CallRegisterClient({
  enqueueExport,
  isExporting: isExportingFromParent = false,
}: CallRegisterClientProps = {}) {
  const { userProfile } = useUser();
  const showVisibilityFilter = canSeeAllCallRegisterClients(userProfile?.permissions);

  const defaultDates = getDefaultDates();
  const [draftFrom, setDraftFrom] = useState(defaultDates.from);
  const [draftTo, setDraftTo] = useState(defaultDates.to);
  const [appliedFrom, setAppliedFrom] = useState(defaultDates.from);
  const [appliedTo, setAppliedTo] = useState(defaultDates.to);
  const dateField: CallRegisterDateField = 'billing';
  const [savedClients, setSavedClients] = useState<string[]>([]);
  const [visibleClients, setVisibleClients] = useState<string[]>([]);
  const [exportClients, setExportClients] = useState<string[]>([]);
  const [detailClient, setDetailClient] = useState<string | null>(null);

  const [rows, setRows] = useState<CallRegisterRow[]>([]);
  const [clientOptions, setClientOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [localExporting, setLocalExporting] = useState(false);
  const [exportDetail, setExportDetail] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{
    fetched: number;
    total: number;
  } | null>(null);
  const [exportElapsedSec, setExportElapsedSec] = useState(0);
  const [savingVisible, setSavingVisible] = useState(false);
  const { alert, setError, setInfo, clear: clearAlert } = usePageAlert();

  const abortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportStartedAtRef = useRef<number | null>(null);

  const exporting = localExporting || isExportingFromParent;
  const filterDirty = draftFrom !== appliedFrom || draftTo !== appliedTo;
  const visibilityDirty = !sameClientSet(visibleClients, savedClients);

  const allRowClients = useMemo(() => rows.map((r) => r.client), [rows]);

  /** Editors: full dynamic names for dropdowns. Others: grid clients only. */
  const dropdownUniverse = useMemo(() => {
    if (showVisibilityFilter && clientOptions.length) return clientOptions;
    return allRowClients;
  }, [showVisibilityFilter, clientOptions, allRowClients]);

  const visibilityOptions = useMemo(() => {
    const set = new Set([...dropdownUniverse, ...savedClients, ...visibleClients]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [dropdownUniverse, savedClients, visibleClients]);

  const exportOptions = useMemo(() => {
    if (!showVisibilityFilter) return allRowClients;
    const set = new Set([...dropdownUniverse, ...savedClients]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [showVisibilityFilter, dropdownUniverse, allRowClients, savedClients]);

  const visibleRows = useMemo(() => {
    if (!showVisibilityFilter) return rows;
    if (!visibleClients.length) return [];
    const selected = new Set(visibleClients);
    return rows.filter((r) => selected.has(r.client));
  }, [rows, visibleClients, showVisibilityFilter]);

  const summary = useMemo(() => summaryFromRows(visibleRows), [visibleRows]);

  useEffect(() => {
    if (!exporting) {
      exportStartedAtRef.current = null;
      setExportElapsedSec(0);
      setExportDetail(null);
      setExportProgress(null);
      return;
    }
    if (exportStartedAtRef.current == null) {
      exportStartedAtRef.current = Date.now();
    }
    const tick = () => {
      const started = exportStartedAtRef.current ?? Date.now();
      setExportElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [exporting]);

  const fetchData = useCallback(
    async (dateFrom: string, dateTo: string, field: CallRegisterDateField) => {
      if (abortRef.current) abortRef.current.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setLoading(true);
      clearAlert();

      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        params.set('dateField', field);

        const res = await fetch(`/api/report/call-register?${params.toString()}`, {
          signal: abort.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const nextRows = (data.rows || []) as CallRegisterRow[];
        const shared = Array.isArray(data.sharedClients)
          ? (data.sharedClients as string[])
          : nextRows.map((r) => r.client);
        const options = Array.isArray(data.clientOptions)
          ? (data.clientOptions as string[])
          : [];
        const rowClients = nextRows.map((r) => r.client);

        setRows(nextRows);
        setClientOptions(options);
        setSavedClients(shared);
        setVisibleClients(shared);
        setExportClients(data.allClients ? shared : rowClients);
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return;
        console.error('[call-register]', err);
        setError(
          err instanceof Error ? err.message : 'Failed to fetch call register data. Please try again.'
        );
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [clearAlert, setError]
  );

  useEffect(() => {
    fetchData(appliedFrom, appliedTo, dateField);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [appliedFrom, appliedTo, dateField, fetchData]);

  const handleApplyFilter = useCallback(() => {
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
  }, [draftFrom, draftTo]);

  const handleAllTime = useCallback(() => {
    setDraftFrom('');
    setDraftTo('');
    setAppliedFrom('');
    setAppliedTo('');
  }, []);

  const handleRefresh = useCallback(() => {
    fetchData(appliedFrom, appliedTo, dateField);
  }, [fetchData, appliedFrom, appliedTo, dateField]);

  const handleSaveVisibleClients = useCallback(async () => {
    if (!visibleClients.length) return;
    setSavingVisible(true);
    clearAlert();
    try {
      const res = await fetch('/api/report/call-register/visible-clients', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clients: visibleClients }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const saved = Array.isArray(data.clients) ? (data.clients as string[]) : visibleClients;
      setSavedClients(saved);
      setVisibleClients(saved);
      await fetchData(appliedFrom, appliedTo, dateField);
      setInfo('Visible accounts saved for everyone.');
    } catch (err: unknown) {
      console.error('[call-register/visible-clients]', err);
      setError(err instanceof Error ? err.message : 'Failed to save visible accounts.');
    } finally {
      setSavingVisible(false);
    }
  }, [
    visibleClients,
    clearAlert,
    setInfo,
    setError,
    fetchData,
    appliedFrom,
    appliedTo,
    dateField,
  ]);

  const runExportJob = useCallback(
    async (ctx: {
      signal?: AbortSignal;
      onProgress?: (progress: ExportQueueProgress) => void;
    }): Promise<PreparedFileExport> => {
      const clients = exportClients;
      const total = clients.length;
      let serialCount = 0;
      const allRows: CallRegisterSerialExportRow[] = [];

      const report = (fetched: number, detail: string) => {
        const progress = { fetched, total, detail };
        setExportProgress({ fetched, total });
        setExportDetail(detail);
        ctx.onProgress?.(progress);
      };

      report(0, `Starting · 0/${total} accounts · ${total} pending`);

      for (let i = 0; i < clients.length; i++) {
        if (ctx.signal?.aborted) {
          throw new DOMException('Export cancelled', 'AbortError');
        }
        const client = clients[i]!;
        const pending = total - i;
        report(
          i,
          `${i}/${total} done · ${pending} pending · fetching ${client}…`
        );

        const params = new URLSearchParams();
        params.set('client', client);
        if (appliedFrom) params.set('dateFrom', appliedFrom);
        if (appliedTo) params.set('dateTo', appliedTo);
        params.set('dateField', dateField);

        const res = await fetchWithRetry(
          `/api/report/call-register/serials?${params.toString()}`,
          { credentials: 'include', signal: ctx.signal }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status} (${client})`);
        }
        const data = (await res.json()) as { rows?: CallRegisterSerialExportRow[] };
        const rows = Array.isArray(data.rows) ? data.rows : [];
        allRows.push(...rows);
        serialCount += rows.length;

        report(
          i + 1,
          `${i + 1}/${total} accounts done · ${total - (i + 1)} pending · ${serialCount.toLocaleString('en-IN')} serials`
        );
      }

      report(total, `Building Excel · ${serialCount.toLocaleString('en-IN')} serials…`);
      const workbook = await buildCallRegisterSerialWorkbook(allRows);
      const stamp = new Date().toISOString().slice(0, 10);
      const filename =
        appliedFrom && appliedTo
          ? `WRL_Call_Register_Serials_${appliedFrom}_${appliedTo}.xlsx`
          : `WRL_Call_Register_Serials_AllTime_${stamp}.xlsx`;
      report(total, `Saving file · ${serialCount.toLocaleString('en-IN')} serials…`);
      return workbookToPreparedExport(workbook, filename);
    },
    [exportClients, appliedFrom, appliedTo, dateField]
  );

  const handleExport = useCallback(() => {
    if (!exportClients.length || exporting) return;
    clearAlert();

    if (enqueueExport) {
      const n = exportClients.length;
      enqueueExport(
        n === 1 ? 'Deployment Completion Excel' : `Deployment Completion Excel (${n})`,
        async (ctx) => {
          try {
            return await runExportJob({
              signal: ctx.signal,
              onProgress: (progress) => {
                setExportProgress({ fetched: progress.fetched, total: progress.total });
                setExportDetail(progress.detail ?? null);
                ctx.onProgress(progress);
              },
            });
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
            const message = err instanceof Error ? err.message : 'Export failed';
            setError(message);
            throw err instanceof Error ? err : new Error(message);
          }
        },
        { sourceTab: 'deployment_completion', kind: 'standard' }
      );
      return;
    }

    void (async () => {
      if (exportAbortRef.current) exportAbortRef.current.abort();
      const abort = new AbortController();
      exportAbortRef.current = abort;
      setLocalExporting(true);
      try {
        const prepared = await runExportJob({
          signal: abort.signal,
          onProgress: (progress) => {
            setExportProgress({ fetched: progress.fetched, total: progress.total });
            setExportDetail(progress.detail ?? null);
          },
        });
        await triggerBlobDownload(prepared.blob, prepared.filename, {
          objectUrl: prepared.objectUrl,
        });
        logClientExportAction({
          action: 'report.export.complete',
          reportName: 'call_register',
          format: 'xlsx',
          filename: prepared.filename,
          summary: `Exported Call Register (${prepared.filename})`,
        });
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') {
          logClientExportAction({
            action: 'report.export.cancelled',
            reportName: 'call_register',
            format: 'xlsx',
            summary: 'Cancelled Call Register export',
          });
          return;
        }
        console.error('[call-register/export]', err);
        logClientExportAction({
          action: 'report.export.failure',
          reportName: 'call_register',
          format: 'xlsx',
          summary: 'Call Register export failed',
          metadata: { message: err instanceof Error ? err.message : String(err) },
        });
        setError(err instanceof Error ? err.message : 'Failed to export Excel. Please try again.');
      } finally {
        if (exportAbortRef.current === abort) exportAbortRef.current = null;
        setLocalExporting(false);
        setExportDetail(null);
        setExportProgress(null);
      }
    })();
  }, [exportClients, exporting, enqueueExport, runExportJob, clearAlert, setError]);

  const handleCancelLocalExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Deployment Completion</h1>
          <p className="text-[13px] text-slate-500">Track installation and deployment status</p>
        </div>
        <div className="flex gap-6 text-[13px]">
          <div className="flex flex-col items-end">
            <span className="text-slate-500">Billing Count</span>
            <span className="font-semibold text-slate-900">
              {summary.totalQty.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500">Deployed</span>
            <span className="font-semibold text-teal-700">
              {summary.totalDeployment.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500">Installed</span>
            <span className="font-semibold text-teal-700">
              {summary.totalInstallation.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500">Pending Deploy</span>
            <span className="font-semibold text-rose-600">
              {summary.totalBalanceDeployment.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-slate-500">Pending Install</span>
            <span className="font-semibold text-rose-600">
              {summary.totalBalanceInstallation.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      </div>

      <CallRegisterToolbar
        dateFrom={draftFrom}
        dateTo={draftTo}
        onDateFromChange={setDraftFrom}
        onDateToChange={setDraftTo}
        onApplyFilter={handleApplyFilter}
        onAllTime={handleAllTime}
        onRefresh={handleRefresh}
        loading={loading}
        visibilityOptions={visibilityOptions}
        visibleClients={visibleClients}
        onVisibleClientsChange={setVisibleClients}
        showVisibilityFilter={showVisibilityFilter}
        visibilityDirty={visibilityDirty}
        onSaveVisibleClients={handleSaveVisibleClients}
        savingVisible={savingVisible}
        exportOptions={exportOptions}
        exportClients={exportClients}
        onExportClientsChange={setExportClients}
        onExport={handleExport}
        exporting={exporting}
        filterDirty={filterDirty}
      />

      {exporting ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-950">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{exportDetail || 'Export in progress…'}</p>
              <p className="text-[11px] text-amber-800/80">
                Elapsed {formatElapsed(exportElapsedSec)}
                {exportProgress && exportProgress.total > 0
                  ? ` · ${exportProgress.fetched} of ${exportProgress.total} accounts`
                  : null}
                {enqueueExport ? ' · Also in Recent exports (header)' : null}
              </p>
            </div>
            {localExporting ? (
              <button
                type="button"
                onClick={handleCancelLocalExport}
                className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            ) : null}
          </div>
          {exportProgress && exportProgress.total > 0 ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-200/80"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={exportProgress.total}
              aria-valuenow={exportProgress.fetched}
              aria-label="Export account progress"
            >
              <div
                className="h-full rounded-full bg-amber-600 transition-[width] duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((exportProgress.fetched / exportProgress.total) * 100)
                  )}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <PageScrollRegion className="p-4">
        {alert != null ? (
          <div className="mb-4">
            <PageAlert
              variant={alert.variant}
              message={alert.message}
              onDismiss={clearAlert}
            />
          </div>
        ) : null}

        <AdminTableCard>
          {loading && rows.length === 0 ? (
            <TableSkeleton rows={5} />
          ) : (
            <CallRegisterGrid
              rows={visibleRows}
              onClientClick={(client) => {
                setDetailClient(client);
              }}
            />
          )}
        </AdminTableCard>
      </PageScrollRegion>

      <CallRegisterSerialPanel
        open={detailClient != null}
        client={detailClient}
        dateFrom={appliedFrom}
        dateTo={appliedTo}
        dateField={dateField}
        onClose={() => setDetailClient(null)}
      />
    </div>
  );
}
