'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Ban, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import { formatUiDateTime } from '@/lib/dates/ui-date';
import { feedback } from '@/lib/ui/feedback';
import type {
  CancelledCallRow,
  CancelledCallsRowsResponse,
  CancelledCallsSummary,
} from '@/modules/cancelled-calls/types';

const API = '/api/report/cancelled-calls';

function defaultMonthRange(): { startDate: string; endDate: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${day}` };
}

function buildParams(opts: {
  startDate: string;
  endDate: string;
  branches: string[];
  callTypes: string[];
  page?: number;
  pageSize?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('startDate', opts.startDate);
  params.set('endDate', opts.endDate);
  if (opts.branches.length) params.set('branches', opts.branches.join(','));
  if (opts.callTypes.length) params.set('callTypes', opts.callTypes.join(','));
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  return params;
}

export default function CancelledCallsPageClient() {
  const defaults = useMemo(() => defaultMonthRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [branch, setBranch] = useState('');
  const [callType, setCallType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [callTypeOptions, setCallTypeOptions] = useState<string[]>([]);
  const [summary, setSummary] = useState<CancelledCallsSummary | null>(null);
  const [rowsData, setRowsData] = useState<CancelledCallsRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const branches = branch ? [branch] : [];
  const callTypes = callType ? [callType] : [];

  useEffect(() => {
    void (async () => {
      try {
        const res = await axios.get(`${API}?mode=options`, { withCredentials: true });
        setBranchOptions(res.data.branches ?? []);
        setCallTypeOptions(res.data.callTypes ?? []);
      } catch {
        /* options are best-effort */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = { startDate, endDate, branches, callTypes };
      const [summaryRes, rowsRes] = await Promise.all([
        axios.get<CancelledCallsSummary>(
          `${API}?mode=summary&${buildParams(base).toString()}`,
          { withCredentials: true }
        ),
        axios.get<CancelledCallsRowsResponse>(
          `${API}?${buildParams({ ...base, page, pageSize }).toString()}`,
          { withCredentials: true }
        ),
      ]);
      setSummary(summaryRes.data);
      setRowsData(rowsRes.data);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load cancelled calls';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, branch, callType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const params = buildParams({ startDate, endDate, branches, callTypes });
      params.set('format', 'csv');
      const res = await axios.get(`${API}?${params.toString()}`, {
        withCredentials: true,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancelled-calls-${endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV downloaded');
    } catch {
      feedback.actionFailed('CSV export failed');
    } finally {
      setExporting(false);
    }
  }

  const rows: CancelledCallRow[] = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const health = summary?.health;

  return (
    <PageShell
      title="Cancelled Calls"
      subtitle={
        health
          ? `Register rows ${health.totalRows.toLocaleString()} · CRM sync ${
              health.registerLastSyncedAt
                ? formatUiDateTime(health.registerLastSyncedAt)
                : '—'
            }${
              health.registerLagMinutes != null ? ` (${health.registerLagMinutes}m lag)` : ''
            } · max cancelled ${
              health.maxCancelledAt ? formatUiDateTime(health.maxCancelledAt) : '—'
            }`
          : 'Cancelled call register from Postgres (calls_crm_mirror / hot)'
      }
      icon={<Ban className="h-4 w-4" />}
      actions={
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3 w-3" />
          {exporting ? 'Exporting…' : 'Download CSV'}
        </button>
      }
      toolbar={
        <div className="register-filter-bar flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-slate-600">
            From
            <input
              type="date"
              className="mt-0.5 block rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={startDate}
              onChange={(e) => {
                setPage(1);
                setStartDate(e.target.value);
              }}
            />
          </label>
          <label className="text-[11px] text-slate-600">
            To
            <input
              type="date"
              className="mt-0.5 block rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={endDate}
              onChange={(e) => {
                setPage(1);
                setEndDate(e.target.value);
              }}
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Branch
            <select
              className="mt-0.5 block min-w-[140px] rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={branch}
              onChange={(e) => {
                setPage(1);
                setBranch(e.target.value);
              }}
            >
              <option value="">All</option>
              {branchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-slate-600">
            Call type
            <select
              className="mt-0.5 block min-w-[140px] rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={callType}
              onChange={(e) => {
                setPage(1);
                setCallType(e.target.value);
              }}
            >
              <option value="">All</option>
              {callTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-1 text-[12px] text-slate-500">
            {loading ? 'Loading…' : `${(summary?.total ?? total).toLocaleString()} in range`}
          </span>
        </div>
      }
    >
      <PageScrollRegion>
        <div className="p-3">
          <AdminTableCard
            isEmpty={!loading && rows.length === 0}
            empty={
              <p className="p-6 text-sm text-slate-500">
                No cancelled calls in this date range.
              </p>
            }
          >
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>TRN</AdminTh>
                  <AdminTh>Cancelled At</AdminTh>
                  <AdminTh>Branch</AdminTh>
                  <AdminTh>Party</AdminTh>
                  <AdminTh>Call Type</AdminTh>
                  <AdminTh>Item</AdminTh>
                  <AdminTh>Serial</AdminTh>
                  <AdminTh>Engineer</AdminTh>
                  <AdminTh>Cancel Reason</AdminTh>
                  <AdminTh>Complaint</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {loading ? (
                  <AdminTr>
                    <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={10}>
                      Loading…
                    </td>
                  </AdminTr>
                ) : (
                  rows.map((r) => (
                    <AdminTr key={r.vtrnno}>
                      <AdminTd className="font-mono text-[11px]">{r.vtrnno}</AdminTd>
                      <AdminTd>{formatUiDateTime(r.cancelledAt)}</AdminTd>
                      <AdminTd>{r.branchName ?? '—'}</AdminTd>
                      <AdminTd>{r.partyName ?? '—'}</AdminTd>
                      <AdminTd>{r.callType ?? '—'}</AdminTd>
                      <AdminTd>{r.itemName ?? '—'}</AdminTd>
                      <AdminTd className="font-mono text-[11px]">{r.serial ?? '—'}</AdminTd>
                      <AdminTd>{r.engineerName ?? '—'}</AdminTd>
                      <AdminTd>{r.cancelReason || '—'}</AdminTd>
                      <AdminTd className="max-w-[220px] truncate">
                        <span title={r.complaint ?? ''}>{r.complaint ?? '—'}</span>
                      </AdminTd>
                    </AdminTr>
                  ))
                )}
              </tbody>
            </AdminTable>
          </AdminTableCard>

          <div className="mt-3 flex items-center justify-between text-[12px] text-slate-600">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 disabled:opacity-40"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
