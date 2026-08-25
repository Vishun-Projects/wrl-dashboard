'use client';

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { Activity, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageShell, PageLoadingState } from '@/components/layout/PageShell';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import type { AttendanceListRow } from '@/sql/attendance/list';
import { triggerBlobDownload } from '@/modules/mis/download';

const HEADINGS = ['All', 'Attendance', 'Work Done - Service', 'Expense', 'Travel'] as const;

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function fmtWhen(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function customerCell(row: AttendanceListRow): string {
  return row.service_customer || row.sales_customer || '—';
}

function detailCell(row: AttendanceListRow): string {
  if (row.heading === 'Expense') {
    const parts = [row.expense_type, row.expense_amt != null ? `₹${row.expense_amt}` : null].filter(
      Boolean
    );
    return parts.join(' · ') || row.expense_no || '—';
  }
  if (row.heading === 'Travel') {
    return [row.travel_mode, row.travel_total_time].filter(Boolean).join(' · ') || '—';
  }
  if (row.heading === 'Work Done - Service') {
    return row.service_total_time || '—';
  }
  return row.attd_total_time || '—';
}

export default function AttendancePageClient() {
  const supabase = createClient();
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [heading, setHeading] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttendanceListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined;
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await axios.get('/api/admin/attendance', {
        headers,
        params: { startDate, endDate, heading, search: search.trim() || undefined, page, limit: 50 },
      });
      setRows(res.data.rows ?? []);
      setTotal(res.data.total ?? 0);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to load attendance';
      setError(message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, startDate, endDate, heading, search, page]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await axios.get('/api/admin/attendance', {
        headers,
        params: {
          startDate,
          endDate,
          heading,
          search: search.trim() || undefined,
          export: 'csv',
        },
        responseType: 'blob',
      });
      const filename = `attendance_${startDate}_${endDate}.csv`;
      await triggerBlobDownload(res.data, filename);
    } catch (err: unknown) {
      let message = 'Export failed';
      if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          /* keep default */
        }
      } else if (axios.isAxiosError(err)) {
        message = err.response?.data?.error || err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
    } finally {
      setExporting(false);
    }
  }, [authHeaders, startDate, endDate, heading, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxPage = Math.max(1, Math.ceil(total / 50));

  return (
    <PageShell
      title="Attendance Activity"
      subtitle="CRM uv_rptattandenceDetails_New2 mirror"
      icon={<Activity className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/admin/sync"
            className="rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-bg-soft"
          >
            Sync status
          </Link>
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting || loading || total === 0}
            className="inline-flex items-center gap-2 rounded-md bg-[#0f172a] px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className={`h-3.5 w-3.5 ${exporting ? 'animate-pulse' : ''}`} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-bg-soft disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }
      toolbar={
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            From
            <input
              type="date"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={startDate}
              onChange={(e) => {
                setPage(1);
                setStartDate(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            To
            <input
              type="date"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={endDate}
              onChange={(e) => {
                setPage(1);
                setEndDate(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Type
            <select
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={heading}
              onChange={(e) => {
                setPage(1);
                setHeading(e.target.value);
              }}
            >
              {HEADINGS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-slate-600">
            Search user / call / customer
            <input
              type="search"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="Name, TRN, call no…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </label>
          <AdminStatPill label="Rows" value={total.toLocaleString('en-IN')} />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {loading && rows.length === 0 ? (
          <PageLoadingState label="Loading attendance…" />
        ) : (
          <AdminTableCard isEmpty={rows.length === 0}>
            <AdminTable>
              <AdminThead>
                <AdminTr>
                  <AdminTh>Date</AdminTh>
                  <AdminTh>Type</AdminTh>
                  <AdminTh>User</AdminTh>
                  <AdminTh>Office</AdminTh>
                  <AdminTh>Call / TRN</AdminTh>
                  <AdminTh>Customer</AdminTh>
                  <AdminTh>Detail</AdminTh>
                </AdminTr>
              </AdminThead>
              <tbody>
                {rows.map((row, i) => (
                  <AdminTr key={`${row.activity_date}-${row.heading}-${row.attd_user}-${i}`}>
                    <AdminTd className="whitespace-nowrap">{fmtWhen(row.activity_date)}</AdminTd>
                    <AdminTd>{row.heading}</AdminTd>
                    <AdminTd>{row.attd_user || '—'}</AdminTd>
                    <AdminTd>{row.office_name || '—'}</AdminTd>
                    <AdminTd className="whitespace-nowrap">
                      {row.unique_call || row.trn_no || row.inquiry_no || '—'}
                    </AdminTd>
                    <AdminTd>{customerCell(row)}</AdminTd>
                    <AdminTd>{detailCell(row)}</AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
          </AdminTableCard>
        )}

        {total > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {page} of {maxPage} · {total.toLocaleString('en-IN')} rows
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                disabled={page >= maxPage || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
