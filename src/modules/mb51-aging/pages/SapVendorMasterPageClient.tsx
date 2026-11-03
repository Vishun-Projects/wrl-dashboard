'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookUser, Loader2, Pencil, Plus, RefreshCw, Upload, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { TableSkeleton } from '@/components/ui/DataTableLoading';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { feedback } from '@/lib/ui/feedback';

type VendorRow = {
  vendorCode: string;
  vendorName: string;
  validFrom: string | null;
  updatedAt: string | null;
};

type ListResponse = {
  rows: VendorRow[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
};

const PAGE_SIZE = 50;

export default function SapVendorMasterPageClient() {
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editCode, setEditCode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addName, setAddName] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [applyToMb51, setApplyToMb51] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (nextPage: number, nextQ: string) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextQ.trim()) sp.set('q', nextQ.trim());
      const res = await fetch(`/api/admin/vendor-master?${sp}`, { credentials: 'include' });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(data.error || 'Failed to load vendor master');
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, '');
  }, [load]);

  const startEdit = (row: VendorRow) => {
    setEditCode(row.vendorCode);
    setEditName(row.vendorName);
    setShowAdd(false);
  };

  const cancelEdit = () => {
    setEditCode(null);
    setEditName('');
  };

  const saveEdit = async () => {
    if (!editCode) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/vendor-master', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorCode: editCode,
          vendorName: editName.trim(),
          applyToMb51: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      feedback.actionSuccess(`Updated ${editCode}`);
      cancelEdit();
      await load(page, q);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveAdd = async () => {
    const code = addCode.trim();
    if (!code) {
      feedback.actionFailed('Vendor code is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/vendor-master', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorCode: code,
          vendorName: addName.trim(),
          applyToMb51: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      feedback.actionSuccess(`Saved ${code}`);
      setShowAdd(false);
      setAddCode('');
      setAddName('');
      setQDraft(code);
      setQ(code);
      await load(1, code);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runImport = async () => {
    if (!importFile) {
      feedback.actionFailed('Choose a Vend Master .xlsx file');
      return;
    }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      fd.append('applyToMb51', applyToMb51 ? '1' : '0');
      fd.append('rebuildSnapshot', applyToMb51 ? '1' : '0');
      const res = await fetch('/api/admin/vendor-master', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Import failed');
      feedback.actionSuccess(
        `Imported ${Number(data.upserted || 0).toLocaleString('en-IN')} vendors` +
          (data.mb51Updated
            ? ` · MB51 rows updated ${Number(data.mb51Updated).toLocaleString('en-IN')}`
            : '')
      );
      setShowImport(false);
      setImportFile(null);
      await load(1, q);
    } catch (err) {
      feedback.actionFailed(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <PageShell
      title="Vendor Master"
      subtitle="SAP Vendor Master (Supplier → Name 1). Used as SAP Vendor Name in MB51."
      icon={<BookUser size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <AdminStatPill label="Vendors" value={total.toLocaleString('en-IN')} />
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setShowAdd(true);
              cancelEdit();
            }}
          >
            <Plus size={14} />
            Add
          </button>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setShowImport(true)}
          >
            <Upload size={14} />
            Import
          </button>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => void load(page, q)}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      }
      toolbar={
        <form
          className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-bg-canvas px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qDraft);
            void load(1, qDraft);
          }}
        >
          <input
            className="min-w-[14rem] flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
            placeholder="Filter by vendor code or name…"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Search
          </button>
          {q ? (
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => {
                setQDraft('');
                setQ('');
                void load(1, '');
              }}
            >
              Clear
            </button>
          ) : null}
        </form>
      }
    >
      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}

      {showAdd ? (
        <div className="mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white p-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            Vendor code
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-xs"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder="e.g. 100001"
            />
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] text-slate-500">
            SAP Vendor Name
            <input
              className="rounded border border-slate-200 px-2 py-1.5 text-xs"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Name 1"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAdd()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
        <AdminTableCard isEmpty={!loading && rows.length === 0} empty={<p className="text-sm text-slate-600">No vendors match this filter.</p>}>
          {loading ? (
            <TableSkeleton rows={12} cols={4} />
          ) : (
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh>Vendor code</AdminTh>
                  <AdminTh>SAP Vendor Name</AdminTh>
                  <AdminTh>Valid from</AdminTh>
                  <AdminTh className="w-24"> </AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {rows.map((row) => {
                  const editing = editCode === row.vendorCode;
                  return (
                    <AdminTr key={row.vendorCode}>
                      <AdminTd className="font-mono text-xs">{row.vendorCode}</AdminTd>
                      <AdminTd>
                        {editing ? (
                          <input
                            className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <span className="text-xs text-slate-800">{row.vendorName || '—'}</span>
                        )}
                      </AdminTd>
                      <AdminTd className="text-xs text-slate-500">{row.validFrom || '—'}</AdminTd>
                      <AdminTd>
                        {editing ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void saveEdit()}
                              className="rounded bg-slate-900 px-2 py-1 text-[11px] text-white disabled:opacity-50"
                            >
                              {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                        )}
                      </AdminTd>
                    </AdminTr>
                  );
                })}
              </tbody>
            </AdminTable>
          )}
        </AdminTableCard>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            Page {page} of {totalPages}
            {total ? ` · ${total.toLocaleString('en-IN')} vendors` : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
              onClick={() => void load(page - 1, q)}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40"
              onClick={() => void load(page + 1, q)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showImport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Import Vendor Master</h2>
              <button type="button" onClick={() => setShowImport(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 px-4 py-3 text-xs text-slate-600">
              <p>
                Upload SAP <strong>Vend Master.xlsx</strong> (columns: Supplier, Name 1). Existing codes are
                overwritten; new codes are added.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="block w-full text-xs"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              {importFile ? (
                <p className="text-slate-800">Selected: {importFile.name}</p>
              ) : null}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={applyToMb51}
                  onChange={(e) => setApplyToMb51(e.target.checked)}
                />
                Update MB51 SAP Vendor Names + rebuild aging snapshot
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                onClick={() => setShowImport(false)}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || !importFile}
                onClick={() => void runImport()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
