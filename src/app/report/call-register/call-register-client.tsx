'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { triggerBlobDownload } from '@/features/report/lib/summary-excel-export';
import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import { canSeeAllCallRegisterClients } from '@/lib/call-register/clients';

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

export function CallRegisterClient() {
  const { userProfile } = useUser();
  const userEmail =
    typeof userProfile?.email === 'string' ? userProfile.email : undefined;
  const showVisibilityFilter = canSeeAllCallRegisterClients(userEmail);

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
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [savingVisible, setSavingVisible] = useState(false);
  const { alert, setError, setInfo, clear: clearAlert } = usePageAlert();

  const abortRef = useRef<AbortController | null>(null);
  const filterDirty = draftFrom !== appliedFrom || draftTo !== appliedTo;
  const visibilityDirty = !sameClientSet(visibleClients, savedClients);

  const allRowClients = useMemo(() => rows.map((r) => r.client), [rows]);

  const visibilityOptions = useMemo(() => {
    const set = new Set([...allRowClients, ...savedClients, ...visibleClients]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRowClients, savedClients, visibleClients]);

  const exportOptions = useMemo(() => {
    if (!showVisibilityFilter) return allRowClients;
    const set = new Set([...allRowClients, ...savedClients]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [showVisibilityFilter, allRowClients, savedClients]);

  const visibleRows = useMemo(() => {
    if (!showVisibilityFilter) return rows;
    if (!visibleClients.length) return [];
    const selected = new Set(visibleClients);
    return rows.filter((r) => selected.has(r.client));
  }, [rows, visibleClients, showVisibilityFilter]);

  const summary = useMemo(() => summaryFromRows(visibleRows), [visibleRows]);

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
        const rowClients = nextRows.map((r) => r.client);

        setRows(nextRows);
        setSavedClients(shared);
        setVisibleClients(shared);
        // Editors may export any account; default selection = shared allowlist.
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

  const handleExport = useCallback(async () => {
    if (!exportClients.length) return;
    setExporting(true);
    clearAlert();
    try {
      const params = new URLSearchParams();
      params.set('clients', exportClients.join(','));
      if (appliedFrom) params.set('dateFrom', appliedFrom);
      if (appliedTo) params.set('dateTo', appliedTo);
      params.set('dateField', dateField);

      const res = await fetchWithRetry(`/api/report/call-register/export?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] || `WRL_Call_Register_Serials_${new Date().toISOString().slice(0, 10)}.xlsx`;
      await triggerBlobDownload(blob, filename);
    } catch (err: unknown) {
      console.error('[call-register/export]', err);
      setError(err instanceof Error ? err.message : 'Failed to export Excel. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [exportClients, appliedFrom, appliedTo, dateField, clearAlert, setError]);

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
