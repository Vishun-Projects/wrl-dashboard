'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Mail, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { feedback } from '@/lib/ui/feedback';
import {
  AdminIconButton,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminToolbar,
  AdminTr,
  settingsInputClass,
} from '@/components/admin/AdminUi';
import {
  MAIL_ALERTS_CONTENT,
  MAIL_ALERTS_PANEL,
  MAIL_ALERTS_PRIMARY_BTN,
} from '@/modules/mail-alerts/components/mail-alerts-ui';

type Recipient = {
  id: string;
  branch: string;
  recipientName: string;
  email: string;
  enabled: boolean;
};

type FormState = {
  id?: string;
  branch: string;
  recipientName: string;
  email: string;
  enabled: boolean;
};

const API_URL = '/api/admin/major-repair-alert-recipients';
const emptyForm = (): FormState => ({
  branch: '',
  recipientName: '',
  email: '',
  enabled: false,
});

export default function MajorRepairAlertsPageClient({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Recipient | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, optionsRes] = await Promise.all([
        axios.get(API_URL, { withCredentials: true }),
        axios.get(`${API_URL}?options=1`, { withCredentials: true }),
      ]);
      setRecipients(listRes.data.recipients ?? []);
      setBranches(optionsRes.data.branches ?? []);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load recipients';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) =>
        r.branch.toLowerCase().includes(q) ||
        r.recipientName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q)
    );
  }, [recipients, search]);

  async function saveForm() {
    if (!form) return;
    setSaving(true);
    try {
      if (form.id) {
        await axios.put(
          API_URL,
          {
            id: form.id,
            branch: form.branch,
            recipientName: form.recipientName,
            email: form.email,
            enabled: form.enabled,
          },
          { withCredentials: true }
        );
        feedback.actionSuccess('Recipient updated');
      } else {
        await axios.post(
          API_URL,
          {
            branch: form.branch,
            recipientName: form.recipientName,
            email: form.email,
            enabled: form.enabled,
          },
          { withCredentials: true }
        );
        feedback.actionSuccess('Recipient added');
      }
      setForm(null);
      await load();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Save failed';
      feedback.actionFailed(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}?id=${encodeURIComponent(deleteTarget.id)}`, {
        withCredentials: true,
      });
      feedback.actionSuccess('Recipient removed');
      setDeleteTarget(null);
      await load();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Delete failed';
      feedback.actionFailed(message);
    } finally {
      setDeleting(false);
    }
  }

  const toolbar = (
    <AdminToolbar
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search branch, name, email…"
    >
      <button
        type="button"
        className={MAIL_ALERTS_PRIMARY_BTN}
        onClick={() => setForm(emptyForm())}
      >
        <Plus className="h-3.5 w-3.5" />
        Add recipient
      </button>
    </AdminToolbar>
  );

  const body = (
    <div className={embedded ? MAIL_ALERTS_PANEL : undefined}>
      {embedded ? toolbar : null}
      <div className={embedded ? MAIL_ALERTS_CONTENT : 'p-4'}>
      <p className="mb-3 text-[12px] leading-relaxed text-slate-600">
        Enabled branch rows become the alert <span className="font-medium">To</span> for that
        call&apos;s branch. If no enabled row matches, mail goes to Org → Major repair HQ To/Cc
        only. Saving here never sends mail — the sync worker fires when a major+repair call
        crosses the repeat threshold.
      </p>
      <AdminTableCard
        isEmpty={!loading && filtered.length === 0}
        empty={
          <p className="p-6 text-sm text-slate-500">
            No branch recipients yet — all alerts use Org HQ To/Cc fallback until you add enabled
            rows.
          </p>
        }
      >
        <AdminTable>
          <AdminThead>
            <tr>
              <AdminTh>Branch</AdminTh>
              <AdminTh>Name</AdminTh>
              <AdminTh>Email</AdminTh>
              <AdminTh>Enabled</AdminTh>
              <AdminTh className="w-24">Actions</AdminTh>
            </tr>
          </AdminThead>
          <tbody>
            {loading ? (
              <AdminTr>
                <td className="px-4 py-3 text-[12px] text-slate-500" colSpan={5}>
                  Loading…
                </td>
              </AdminTr>
            ) : (
              filtered.map((r) => (
                <AdminTr key={r.id}>
                  <AdminTd>{r.branch}</AdminTd>
                  <AdminTd>{r.recipientName}</AdminTd>
                  <AdminTd>{r.email}</AdminTd>
                  <AdminTd>{r.enabled ? 'Yes' : 'No'}</AdminTd>
                  <AdminTd>
                    <div className="flex items-center gap-1">
                      <AdminIconButton
                        title="Edit"
                        onClick={() =>
                          setForm({
                            id: r.id,
                            branch: r.branch,
                            recipientName: r.recipientName,
                            email: r.email,
                            enabled: r.enabled,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </AdminIconButton>
                      <AdminIconButton
                        title="Delete"
                        variant="danger"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </AdminIconButton>
                    </div>
                  </AdminTd>
                </AdminTr>
              ))
            )}
          </tbody>
        </AdminTable>
      </AdminTableCard>
      </div>

      <ModalPortal open={!!form}>
        {form ? (
          <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
            <ModalBackdrop onClick={() => !saving && setForm(null)} />
            <div className="relative z-[191] w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {form.id ? 'Edit recipient' : 'Add recipient'}
                </h2>
                <button
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => !saving && setForm(null)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <label className="block text-[12px] text-slate-600">
                  Branch
                  <select
                    className={`${settingsInputClass()} mt-1`}
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  >
                    <option value="">Select branch…</option>
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                    {form.branch && !branches.includes(form.branch) ? (
                      <option value={form.branch}>{form.branch}</option>
                    ) : null}
                  </select>
                </label>
                <label className="block text-[12px] text-slate-600">
                  Recipient name
                  <input
                    className={`${settingsInputClass()} mt-1`}
                    value={form.recipientName}
                    onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
                    placeholder="Branch manager name"
                  />
                </label>
                <label className="block text-[12px] text-slate-600">
                  Email
                  <input
                    type="email"
                    className={`${settingsInputClass()} mt-1`}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@example.com"
                  />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  />
                  Enabled (receive alerts for this branch)
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                  disabled={saving}
                  onClick={() => setForm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={saving || !form.branch || !form.recipientName || !form.email}
                  onClick={() => void saveForm()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </ModalPortal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove recipient?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.recipientName} (${deleteTarget.email}) for ${deleteTarget.branch}?`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <PageShell
      title="Major Repair Alerts"
      subtitle="Branch To overlays for SLA alerts. No match → Org HQ To/Cc. Sync worker sends; Save does not."
      icon={<Mail className="h-5 w-5" />}
      toolbar={toolbar}
    >
      {body}
    </PageShell>
  );
}
