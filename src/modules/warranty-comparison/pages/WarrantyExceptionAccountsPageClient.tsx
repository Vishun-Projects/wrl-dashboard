'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import {
  AdminIconButton,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { FilterSelect } from '@/components/filters/FilterSelect';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { PageAlert } from '@/components/ui/PageAlert';
import { usePageAlert } from '@/hooks/usePageAlert';
import { formatUiDateDash } from '@/lib/dates/ui-date';
import type { ExceptionWorkDoneMode } from '../exception-cover';
import type { WarrantyExceptionAccount } from '../types';

const API = '/api/report/warranty-comparison/exceptions';
const PERPETUAL_AMC = '9999-12-31';

function formatAmcUpto(ymd: string | null): string {
  if (!ymd) return '—';
  if (ymd === PERPETUAL_AMC) return '31-12-9999';
  return formatUiDateDash(ymd) || ymd;
}

type Draft = {
  id?: number;
  systemAccount: string;
  amc: boolean;
  amcValidUpto: string;
  compressorWarrantyMonths: string;
  workDoneMode: ExceptionWorkDoneMode;
  workDoneRepairNcodes: string[];
  enabled: boolean;
};

const emptyDraft = (): Draft => ({
  systemAccount: '',
  amc: false,
  amcValidUpto: '',
  compressorWarrantyMonths: '',
  workDoneMode: 'none',
  workDoneRepairNcodes: [],
  enabled: true,
});

export default function WarrantyExceptionAccountsPageClient() {
  const [rows, setRows] = useState<WarrantyExceptionAccount[]>([]);
  const [accounts, setAccounts] = useState<Array<{ value: string; label: string }>>([]);
  const [repairs, setRepairs] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { alert, setError, setInfo, clear: clearAlert } = usePageAlert();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listRes = await fetch(API);
      if (!listRes.ok) throw new Error((await listRes.json().catch(() => ({}))).error || 'Failed to load');
      setRows((await listRes.json()).rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exception accounts');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const loadPickers = useCallback(async () => {
    if (accounts.length && repairs.length) return;
    try {
      const [accRes, repairRes] = await Promise.all([
        accounts.length ? null : fetch(`${API}?mode=accounts`),
        repairs.length ? null : fetch(`${API}?mode=repairs`),
      ]);
      if (accRes?.ok) setAccounts((await accRes.json()).accounts || []);
      if (repairRes?.ok) setRepairs((await repairRes.json()).repairs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account or repair lists');
    }
  }, [accounts.length, repairs.length, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    clearAlert();
    try {
      const payload = {
        id: draft.id,
        systemAccount: draft.systemAccount,
        amc: draft.amc,
        amcValidUpto: draft.amcValidUpto || null,
        compressorWarrantyMonths: draft.compressorWarrantyMonths
          ? Number(draft.compressorWarrantyMonths)
          : null,
        workDoneMode: draft.workDoneMode,
        workDoneRepairNcodes: draft.workDoneRepairNcodes,
        enabled: draft.enabled,
      };
      const res = await fetch(API, {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setDraft(null);
      setInfo('Exception account saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleteId == null) return;
    try {
      const res = await fetch(`${API}?id=${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed');
      setDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const openEdit = (row: WarrantyExceptionAccount) => {
    setDraft({
      id: row.id,
      systemAccount: row.systemAccount,
      amc: row.amc,
      amcValidUpto: row.amcValidUpto ?? '',
      compressorWarrantyMonths: row.compressorWarrantyMonths != null ? String(row.compressorWarrantyMonths) : '',
      workDoneMode: row.workDoneMode,
      workDoneRepairNcodes: row.workDoneRepairNcodes,
      enabled: row.enabled,
    });
  };

  return (
    <PageShell
      title="Warranty Exception Accounts"
      subtitle="AMC and compressor cover for lapsed-warranty calls on Warranty Comparison"
      icon={<Shield className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/report/warranty-comparison"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Comparison
          </Link>
          <button
            type="button"
            onClick={() => {
              void loadPickers();
              setDraft(emptyDraft());
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add account
          </button>
        </div>
      }
      bodyClassName="flex flex-col flex-1 min-h-0 bg-slate-50 overflow-hidden"
    >
      {alert && (
        <div className="p-3 pb-0">
          <PageAlert variant={alert.variant} message={alert.message} onDismiss={clearAlert} />
        </div>
      )}
      <PageScrollRegion className="flex-1 p-2 sm:p-3 flex flex-col min-h-0">
        <AdminTableCard isEmpty={!loading && rows.length === 0}>
          {loading ? (
            <div className="p-6 text-xs text-slate-500">Loading…</div>
          ) : (
            <AdminTable className="w-full text-left">
              <AdminThead>
                <AdminTr className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <AdminTh>Account as per System</AdminTh>
                  <AdminTh>AMC</AdminTh>
                  <AdminTh>AMC valid upto</AdminTh>
                  <AdminTh>Compressor months</AdminTh>
                  <AdminTh>Work done</AdminTh>
                  <AdminTh>Enabled</AdminTh>
                  <AdminTh className="w-20"> </AdminTh>
                </AdminTr>
              </AdminThead>
              <tbody className="divide-y divide-slate-100 text-[11px]">
                {rows.map((row) => (
                  <AdminTr key={row.id}>
                    <AdminTd className="font-medium">{row.systemAccount}</AdminTd>
                    <AdminTd>{row.amc ? 'Yes' : 'No'}</AdminTd>
                    <AdminTd>{formatAmcUpto(row.amcValidUpto)}</AdminTd>
                    <AdminTd>{row.compressorWarrantyMonths ?? '—'}</AdminTd>
                    <AdminTd>
                      {row.workDoneMode === 'any'
                        ? 'Any'
                        : row.workDoneMode === 'selected'
                          ? row.workDoneRepairNcodes.length
                            ? row.workDoneRepairNcodes
                                .map((n) => repairs.find((r) => r.value === n)?.label ?? n)
                                .join(', ')
                            : 'Compressor Replaced'
                          : 'None'}
                    </AdminTd>
                    <AdminTd>{row.enabled ? 'Yes' : 'No'}</AdminTd>
                    <AdminTd>
                      <div className="flex gap-1">
                        <AdminIconButton title="Edit" onClick={() => { void loadPickers(); openEdit(row); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </AdminIconButton>
                        <AdminIconButton title="Delete" variant="danger" onClick={() => setDeleteId(row.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </AdminIconButton>
                      </div>
                    </AdminTd>
                  </AdminTr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </AdminTableCard>
      </PageScrollRegion>

      <ModalPortal open={!!draft}>
        {draft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <ModalBackdrop onClick={() => setDraft(null)} />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
              <h2 className="text-sm font-semibold text-slate-900">
                {draft.id ? 'Edit exception account' : 'Add exception account'}
              </h2>
              <div className="mt-3 space-y-3 text-xs">
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-600">Account as per System</span>
                  <FilterSelect
                    label="Account"
                    emptyLabel="Select account"
                    options={
                      draft.systemAccount && !accounts.some((a) => a.value === draft.systemAccount)
                        ? [{ value: draft.systemAccount, label: draft.systemAccount }, ...accounts]
                        : accounts
                    }
                    selected={draft.systemAccount ? [draft.systemAccount] : []}
                    onChange={(v) => setDraft({ ...draft, systemAccount: v[0] ?? '' })}
                    mode="single"
                    searchable
                    layout="block"
                    panelClassName="w-80"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.amc}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        amc: e.target.checked,
                        amcValidUpto: e.target.checked
                          ? draft.amcValidUpto || PERPETUAL_AMC
                          : draft.amcValidUpto,
                      })
                    }
                  />
                  AMC
                </label>
                {draft.amc && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.amcValidUpto === PERPETUAL_AMC}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            amcValidUpto: e.target.checked ? PERPETUAL_AMC : '',
                          })
                        }
                      />
                      No end date (31-12-9999)
                    </label>
                    {draft.amcValidUpto !== PERPETUAL_AMC && (
                      <label className="block">
                        <span className="mb-1 block font-medium text-slate-600">AMC valid upto</span>
                        <input
                          type="date"
                          max="2099-12-31"
                          value={draft.amcValidUpto}
                          onChange={(e) => setDraft({ ...draft, amcValidUpto: e.target.value })}
                          className="h-8 w-full rounded-md border border-slate-300 px-2"
                        />
                      </label>
                    )}
                  </div>
                )}
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-600">Compressor warranty months</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.compressorWarrantyMonths}
                    onChange={(e) => setDraft({ ...draft, compressorWarrantyMonths: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-300 px-2"
                    placeholder="Empty = off"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1 font-medium text-slate-600">Work done exception</legend>
                  <div className="flex flex-wrap gap-3">
                    {(['none', 'selected', 'any'] as const).map((mode) => (
                      <label key={mode} className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="workDoneMode"
                          checked={draft.workDoneMode === mode}
                          onChange={() => setDraft({ ...draft, workDoneMode: mode })}
                        />
                        {mode === 'none' ? 'None' : mode === 'any' ? 'Any work done' : 'Selected repairs'}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {draft.workDoneMode === 'selected' && (
                  <FilterSelect
                    label="Repairs"
                    emptyLabel="Compressor Replaced (default)"
                    options={repairs}
                    selected={draft.workDoneRepairNcodes}
                    onChange={(v) => setDraft({ ...draft, workDoneRepairNcodes: v })}
                    searchable
                    layout="block"
                    panelClassName="w-80"
                  />
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  Enabled
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="h-8 rounded-md border border-slate-300 px-3 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !draft.systemAccount}
                  className="h-8 rounded-md bg-blue-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>

      <ConfirmDialog
        open={deleteId != null}
        title="Remove exception account?"
        description="Covered calls will show again on the mismatch tabs."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void remove()}
        onCancel={() => setDeleteId(null)}
      />
    </PageShell>
  );
}
