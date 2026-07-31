'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { ModalPortal } from '@/components/ui/ModalPortal';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import type { CallRegisterSerialExportRow } from '@/modules/mis/services/call-register/shape';
import {
  filterSerialPanelRows,
  sortSerialPanelRows,
  type SerialPanelSortKey,
} from '@/modules/mis/services/call-register/serial-panel';
import { formatUiDate } from '@/lib/dates/ui-date';
import type { CallRegisterDateField } from '@/modules/mis/services/call-register/dates';

const PAGE_SIZE = 100;

type SerialSummary = {
  billingCount: number;
  deployed: number;
  installed: number;
  pendingDeploy: number;
  pendingInstall: number;
};

type CallRegisterSerialPanelProps = {
  open: boolean;
  client: string | null;
  dateFrom: string;
  dateTo: string;
  dateField: CallRegisterDateField;
  onClose: () => void;
};

function SortHint({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-1 text-slate-300">↕</span>;
  return dir === 'asc' ? (
    <ChevronUp className="inline ml-0.5" size={12} />
  ) : (
    <ChevronDown className="inline ml-0.5" size={12} />
  );
}

function PendingBadge({ pending }: { pending: 'Yes' | 'No' }) {
  if (pending === 'Yes') {
    return (
      <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-rose-50 text-rose-700">
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-teal-50 text-teal-700">
      Done
    </span>
  );
}

export function CallRegisterSerialPanel({
  open,
  client,
  dateFrom,
  dateTo,
  dateField,
  onClose,
}: CallRegisterSerialPanelProps) {
  const [rows, setRows] = useState<CallRegisterSerialExportRow[]>([]);
  const [summary, setSummary] = useState<SerialSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [pendingDeploy, setPendingDeploy] = useState<'all' | 'Yes' | 'No'>('all');
  const [pendingInstall, setPendingInstall] = useState<'all' | 'Yes' | 'No'>('all');
  const [sortKey, setSortKey] = useState<SerialPanelSortKey>('serial');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!open || !client) return;

    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setRows([]);
    setSummary(null);
    setSearch('');
    setPendingDeploy('all');
    setPendingInstall('all');
    setSortKey('serial');
    setSortDir('asc');
    setPage(0);

    const params = new URLSearchParams();
    params.set('client', client);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('dateField', dateField);

    fetch(`/api/report/call-register/serials?${params.toString()}`, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setRows(data.rows || []);
        setSummary(data.summary || null);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        console.error('[call-register/serials]', err);
        setError(err instanceof Error ? err.message : 'Failed to load serials');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [open, client, dateFrom, dateTo, dateField]);

  const filtered = useMemo(
    () => filterSerialPanelRows(rows, { search, pendingDeploy, pendingInstall }),
    [rows, search, pendingDeploy, pendingInstall]
  );

  const sorted = useMemo(
    () => sortSerialPanelRows(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir]
  );

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [search, pendingDeploy, pendingInstall, sortKey, sortDir]);

  const toggleSort = (key: SerialPanelSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const dateLabel =
    dateFrom && dateTo ? `${formatUiDate(dateFrom)} → ${formatUiDate(dateTo)}` : 'All Time';

  return (
    <ModalPortal open={open && !!client}>
      <div className="fixed inset-0 z-[200] flex justify-end">
        <div className="modal-backdrop absolute inset-0 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-5xl bg-bg-canvas h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-bg-soft shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{client}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Serial detail · {dateLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors"
              aria-label="Close"
            >
              <X size={18} className="text-slate-500" />
            </button>
          </div>

          {summary && !loading && (
            <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-6 shrink-0 bg-white">
              <Stat label="Billing Count" value={summary.billingCount} />
              <Stat label="Deployed" value={summary.deployed} tone="teal" />
              <Stat label="Installed" value={summary.installed} tone="teal" />
              <Stat label="Pending Deploy" value={summary.pendingDeploy} tone="rose" />
              <Stat label="Pending Install" value={summary.pendingInstall} tone="rose" />
            </div>
          )}

          <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3 shrink-0 bg-bg-canvas">
            <input
              type="search"
              placeholder="Search serial…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 rounded-md border border-slate-200 px-2 text-[12px] text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Deploy
              <select
                value={pendingDeploy}
                onChange={(e) => setPendingDeploy(e.target.value as 'all' | 'Yes' | 'No')}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 shadow-sm"
              >
                <option value="all">All</option>
                <option value="Yes">Pending</option>
                <option value="No">Done</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              Install
              <select
                value={pendingInstall}
                onChange={(e) => setPendingInstall(e.target.value as 'all' | 'Yes' | 'No')}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 shadow-sm"
              >
                <option value="all">All</option>
                <option value="Yes">Pending</option>
                <option value="No">Done</option>
              </select>
            </label>
            <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
              {sorted.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} serials
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center gap-3 text-sm text-slate-500">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                Loading serials…
              </div>
            ) : error ? (
              <div className="flex h-40 items-center justify-center text-sm text-rose-600 px-6 text-center">
                {error}
              </div>
            ) : pageRows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                No serials match the current filters.
              </div>
            ) : (
              <AdminTable className="w-full border-collapse text-left">
                <AdminThead>
                  <tr>
                    <SortTh label="Serial Number" active={sortKey === 'serial'} dir={sortDir} onClick={() => toggleSort('serial')} />
                    <SortTh label="Billing Date" active={sortKey === 'qtyDate'} dir={sortDir} onClick={() => toggleSort('qtyDate')} />
                    <SortTh label="Deployment Date" active={sortKey === 'deploymentDate'} dir={sortDir} onClick={() => toggleSort('deploymentDate')} />
                    <SortTh label="Installation Date" active={sortKey === 'installationDate'} dir={sortDir} onClick={() => toggleSort('installationDate')} />
                    <SortTh label="Deploy" active={sortKey === 'pendingDeploy'} dir={sortDir} onClick={() => toggleSort('pendingDeploy')} className="text-center" />
                    <SortTh label="Install" active={sortKey === 'pendingInstall'} dir={sortDir} onClick={() => toggleSort('pendingInstall')} className="text-center" />
                  </tr>
                </AdminThead>
                <tbody>
                  {pageRows.map((row) => (
                    <AdminTr key={`${row.serial}-${row.qtyDate}-${row.deploymentDate}`} className="hover:bg-bg-soft/80">
                      <AdminTd className="font-mono text-[12px] text-slate-800">{row.serial}</AdminTd>
                      <AdminTd className="tabular-nums text-[12px] text-slate-600">{row.qtyDate || '—'}</AdminTd>
                      <AdminTd className="tabular-nums text-[12px] text-slate-600">{row.deploymentDate || '—'}</AdminTd>
                      <AdminTd className="tabular-nums text-[12px] text-slate-600">{row.installationDate || '—'}</AdminTd>
                      <AdminTd className="text-center"><PendingBadge pending={row.pendingDeploy} /></AdminTd>
                      <AdminTd className="text-center"><PendingBadge pending={row.pendingInstall} /></AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            )}
          </div>

          {!loading && !error && sorted.length > 0 && (
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-bg-soft">
              <span className="text-[11px] text-slate-500">
                Page {safePage + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-700 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'teal' | 'rose';
}) {
  const color =
    tone === 'teal' ? 'text-teal-700' : tone === 'rose' ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>
        {value.toLocaleString('en-IN')}
      </span>
    </div>
  );
}

function SortTh({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <AdminTh className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-0.5 hover:text-slate-900"
      >
        {label}
        <SortHint active={active} dir={dir} />
      </button>
    </AdminTh>
  );
}
