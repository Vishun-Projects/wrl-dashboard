'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Download, PackageSearch } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import {
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { formatUiDateTime } from '@/lib/dates/ui-date';
import { FilterSelect } from '@/components/filters/FilterSelect';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';
import { TrnLink } from '@/components/calls/TrnLink';
import { feedback } from '@/lib/ui/feedback';
import type {
  DefectiveSerialRow,
  DefectiveSerialStatus,
  DefectiveSerialsRowsResponse,
} from '@/modules/defective-serials/types';

const API = '/api/report/defective-serials';

const STATUS_OPTIONS: FilterSelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'done', label: 'Done' },
];

function pickSingle(values: string[]): DefectiveSerialStatus {
  const v = values[values.length - 1] ?? 'all';
  return v === 'done' || v === 'pending' ? v : 'all';
}

function Cell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AdminTd className={`px-1 py-0.5 text-[10px] leading-snug break-words ${className}`}>
      {children}
    </AdminTd>
  );
}

export default function DefectiveSerialsPageClient() {
  const [status, setStatus] = useState<DefectiveSerialStatus>('all');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [data, setData] = useState<DefectiveSerialsRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) params.set('search', search);
      const res = await axios.get<DefectiveSerialsRowsResponse>(`${API}?${params}`, {
        withCredentials: true,
      });
      setData(res.data);
    } catch (err) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load defective serials';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const rows: DefectiveSerialRow[] = data?.rows ?? [];

  async function exportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ status, format: 'csv' });
      if (search) params.set('search', search);
      const res = await fetch(`${API}?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `defective-serials-${status}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV downloaded');
    } catch {
      feedback.actionFailed('CSV export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell
      title="Defective Serials"
      subtitle="Defective part serials — amber pending, green returned to branch"
      icon={<PackageSearch className="h-4 w-4" />}
      actions={
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3 w-3" />
          {exporting ? 'Exporting…' : 'CSV'}
        </button>
      }
      toolbar={
        <div className="register-filter-bar border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect
              label="Status"
              options={STATUS_OPTIONS}
              selected={[status]}
              mode="single"
              onChange={(values) => {
                setStatus(pickSingle(values));
                setPage(1);
              }}
              panelClassName="w-40"
              layout="inline"
            />
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium text-slate-600">Search</span>
              <input
                className="h-8 min-w-[180px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 shadow-2xs"
                value={searchDraft}
                placeholder="TRN, party, serial…"
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearch(searchDraft.trim());
                    setPage(1);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
              onClick={() => {
                setSearch(searchDraft.trim());
                setPage(1);
              }}
            >
              Apply
            </button>
            <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Pending {data?.pendingCount?.toLocaleString('en-IN') ?? '—'}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Done {data?.doneCount?.toLocaleString('en-IN') ?? '—'}
              </span>
            </div>
          </div>
        </div>
      }
    >
      <PageScrollRegion>
        <AdminTableCard scrollClassName="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : (
            <AdminTable className="w-full table-fixed border-collapse text-left text-[10px]">
              <AdminThead>
                <AdminTr>
                  <AdminTh className="px-1 py-1 text-[10px]">SO</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Logged</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Party</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Client</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Model</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Serial</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">City</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Call Centre Call ID</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Defective code</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Defective item</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Defective serial</AdminTh>
                  <AdminTh className="px-1 py-1 text-[10px]">Return</AdminTh>
                </AdminTr>
              </AdminThead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <AdminTr>
                    <AdminTd className="py-10 text-center text-slate-500">Loading…</AdminTd>
                  </AdminTr>
                ) : rows.length === 0 ? (
                  <AdminTr>
                    <AdminTd className="py-10 text-center text-slate-500">No rows</AdminTd>
                  </AdminTr>
                ) : (
                  rows.map((r) => {
                    const done = r.status === 'done';
                    return (
                      <AdminTr
                        key={`${r.ncode}-${r.nofficeid}`}
                        className={done ? 'bg-emerald-50/40' : 'bg-amber-50/30'}
                      >
                        <Cell>
                          {r.vtrnno ? (
                            <TrnLink
                              trn={r.vtrnno}
                              callId={r.ncalls}
                              officeId={r.nofficeid}
                              className="text-left text-[10px] font-medium text-slate-800 hover:underline"
                            />
                          ) : (
                            '—'
                          )}
                        </Cell>
                        <Cell>{r.dtrndate ? formatUiDateTime(r.dtrndate) : '—'}</Cell>
                        <Cell>{r.party_name || '—'}</Cell>
                        <Cell>{r.client_name || '—'}</Cell>
                        <Cell>{r.model || '—'}</Cell>
                        <Cell>{r.machine_serial || '—'}</Cell>
                        <Cell>{r.city || '—'}</Cell>
                        <Cell>{r.call_centre_call_id || '—'}</Cell>
                        <Cell>{r.defective_item_code || '—'}</Cell>
                        <Cell>{r.defective_item_name || '—'}</Cell>
                        <Cell>{r.voldserialno || '—'}</Cell>
                        <Cell>
                          {done
                            ? `${r.return_by_name || '—'} · ${
                                r.dreturntobranchdate
                                  ? formatUiDateTime(r.dreturntobranchdate)
                                  : '—'
                              }`
                            : '—'}
                        </Cell>
                      </AdminTr>
                    );
                  })
                )}
              </tbody>
            </AdminTable>
          )}
        </AdminTableCard>

        <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-slate-600">
          <span>
            {data
              ? `${data.total.toLocaleString('en-IN')} row(s) · page ${page} / ${totalPages}`
              : null}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
 