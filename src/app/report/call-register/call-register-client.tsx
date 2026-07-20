'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageScrollRegion } from '@/components/layout/PageShell';
import { CallRegisterToolbar } from '@/components/report/call-register/CallRegisterToolbar';
import { CallRegisterGrid } from '@/components/report/call-register/CallRegisterGrid';
import { CallRegisterSerialPanel } from '@/components/report/call-register/CallRegisterSerialPanel';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { PageAlert } from '@/components/ui/PageAlert';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import type { CallRegisterRow, CallRegisterSummary } from '@/lib/report/call-register/types';
import { CALL_REGISTER_CLIENTS } from '@/lib/report/call-register/clients';
import { usePageAlert } from '@/hooks/usePageAlert';
import { triggerBlobDownload } from '@/lib/report/summary-excel-export';

function getDefaultDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: firstDay.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export function CallRegisterClient() {
  const defaultDates = getDefaultDates();
  const [draftFrom, setDraftFrom] = useState(defaultDates.from);
  const [draftTo, setDraftTo] = useState(defaultDates.to);
  const [appliedFrom, setAppliedFrom] = useState(defaultDates.from);
  const [appliedTo, setAppliedTo] = useState(defaultDates.to);
  const [exportClient, setExportClient] = useState<string>(CALL_REGISTER_CLIENTS[0]);
  const [detailClient, setDetailClient] = useState<string | null>(null);

  const [rows, setRows] = useState<CallRegisterRow[]>([]);
  const [summary, setSummary] = useState<CallRegisterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { alert, setError, clear: clearAlert } = usePageAlert();

  const abortRef = useRef<AbortController | null>(null);
  const filterDirty = draftFrom !== appliedFrom || draftTo !== appliedTo;

  const fetchData = useCallback(
    async (dateFrom: string, dateTo: string) => {
      if (abortRef.current) abortRef.current.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setLoading(true);
      clearAlert();

      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);

        const res = await fetch(`/api/report/call-register?${params.toString()}`, {
          signal: abort.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        setRows(data.rows || []);
        setSummary(data.summary || null);
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

  // Initial load + when applied dates change (Apply / All Time)
  useEffect(() => {
    fetchData(appliedFrom, appliedTo);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [appliedFrom, appliedTo, fetchData]);

  useEffect(() => {
    if (rows.length === 0) return;
    if (exportClient && rows.some((r) => r.client === exportClient)) return;
    setExportClient(rows[0].client);
  }, [rows, exportClient]);

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
    fetchData(appliedFrom, appliedTo);
  }, [fetchData, appliedFrom, appliedTo]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    clearAlert();
    try {
      const params = new URLSearchParams();
      params.set('client', exportClient);
      if (appliedFrom) params.set('dateFrom', appliedFrom);
      if (appliedTo) params.set('dateTo', appliedTo);

      const res = await fetch(`/api/report/call-register/export?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] || `WRL_Call_Register_Serials_${exportClient.replace(/\s+/g, '_')}.xlsx`;
      await triggerBlobDownload(blob, filename);
    } catch (err: unknown) {
      console.error('[call-register/export]', err);
      setError(err instanceof Error ? err.message : 'Failed to export Excel. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [exportClient, appliedFrom, appliedTo, clearAlert, setError]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Call Register</h1>
          <p className="text-[13px] text-slate-500">Track installation and deployment status</p>
        </div>
        {summary && (
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
        )}
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
        exportClient={exportClient}
        exportClients={[...CALL_REGISTER_CLIENTS]}
        onExportClientChange={setExportClient}
        onExport={handleExport}
        exporting={exporting}
        filterDirty={filterDirty}
      />

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
              rows={rows}
              onClientClick={(client) => {
                setExportClient(client);
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
        onClose={() => setDetailClient(null)}
      />
    </div>
  );
}
