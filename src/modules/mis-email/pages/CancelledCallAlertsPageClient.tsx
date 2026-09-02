'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Ban, Pencil, Plus, Trash2, X } from 'lucide-react';
import { FilterSelect } from '@/components/filters/FilterSelect';
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
} from '@/modules/mis-email/components/mis-email-ui';

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

const API_URL = '/api/admin/cancelled-call-digest-recipients';
const SCHEDULE_API = '/api/admin/cancelled-call-digest';
const emptyForm = (): FormState => ({
  branch: '',
  recipientName: '',
  email: '',
  enabled: false,
});

export default function CancelledCallAlertsPageClient({
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
  const [sendTimeIst, setSendTimeIst] = useState('09:00');
  const [scheduleNote, setScheduleNote] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [testDate, setTestDate] = useState('');
  const [testBranch, setTestBranch] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, optionsRes, scheduleRes] = await Promise.all([
        axios.get(API_URL, { withCredentials: true }),
        axios.get(`${API_URL}?options=1`, { withCredentials: true }),
        axios.get(SCHEDULE_API, { withCredentials: true }),
      ]);
      setRecipients(listRes.data.recipients ?? []);
      setBranches(optionsRes.data.branches ?? []);
      setSendTimeIst(scheduleRes.data.sendTimeIst ?? '09:00');
      setScheduleNote(scheduleRes.data.scheduleNote ?? '');
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

  async function saveSchedule() {
    setSavingSchedule(true);
    try {
      const res = await axios.put(
        SCHEDULE_API,
        { sendTimeIst },
        { withCredentials: true }
      );
      setSendTimeIst(res.data.sendTimeIst ?? sendTimeIst);
      feedback.actionSuccess('Send time saved');
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to save send time';
      feedback.actionFailed(message);
    } finally {
      setSavingSchedule(false);
    }
  }

  async function sendTestNow(dryRun: boolean) {
    setSendingTest(true);
    try {
      const res = await axios.post(
        SCHEDULE_API,
        {
          digestDate: testDate || undefined,
          branch: testBranch || undefined,
          dryRun,
        },
        { withCredentials: true }
      );
      const result = res.data.result;
      const sent = result?.sent?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      feedback.actionSuccess(
        dryRun
          ? `Dry run OK — would send ${sent} branch(es), skip ${skipped}`
          : `Test send OK — sent ${sent} branch(es)`
      );
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Test send failed';
      feedback.actionFailed(message);
    } finally {
      setSendingTest(false);
    }
  }

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
          Enabled branch rows receive the daily cancelled-calls digest (previous IST day) for that
          branch. Branches with cancels but no enabled recipient are skipped. Saving recipients
          never sends mail — the VPS cron sends at your configured time.
        </p>

        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <h3 className="mb-2 text-[12px] font-semibold text-slate-800">Daily send schedule (IST)</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] text-slate-600">
              Send time
              <input
                type="time"
                className={`${settingsInputClass()} mt-1 block`}
                value={sendTimeIst}
                onChange={(e) => setSendTimeIst(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={savingSchedule}
              onClick={() => void saveSchedule()}
            >
              {savingSchedule ? 'Saving…' : 'Save time'}
            </button>
          </div>
          {scheduleNote ? (
            <p className="mt-2 text-[11px] text-slate-500">{scheduleNote}</p>
          ) : null}
        </div>

        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <h3 className="mb-2 text-[12px] font-semibold text-slate-800">Test send</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] text-slate-600">
              Digest date
              <input
                type="date"
                className={`${settingsInputClass()} mt-1 block`}
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Branch (optional)
              <div className="mt-1">
                <FilterSelect
                  label="Branch"
                  emptyLabel="All branches with cancels"
                  mode="single"
                  options={branches.map((b) => ({ value: b, label: b }))}
                  selected={testBranch ? [testBranch] : []}
                  onChange={(values) => setTestBranch(values[0] ?? '')}
                  panelClassName="w-64"
                />
              </div>
            </label>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={sendingTest}
              onClick={() => void sendTestNow(true)}
            >
              Dry run
            </button>
            <button
              type="button"
              className="rounded-md bg-amber-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-amber-800 disabled:opacity-60"
              disabled={sendingTest}
              onClick={() => void sendTestNow(false)}
            >
              {sendingTest ? 'Sending…' : 'Send test now'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Test send ignores the schedule and dedupe. Leave date empty for yesterday (IST).
          </p>
        </div>

        <AdminTableCard
          isEmpty={!loading && filtered.length === 0}
          empty={
            <p className="p-6 text-sm text-slate-500">
              No branch recipients yet — add enabled branch managers to start digests.
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
                  <div className="mt-1">
                    <FilterSelect
                      label="Branch"
                      emptyLabel="Select branch…"
                      mode="single"
                      options={[
                        ...branches.map((b) => ({ value: b, label: b })),
                        ...(form.branch && !branches.includes(form.branch)
                          ? [{ value: form.branch, label: form.branch }]
                          : []),
                      ]}
                      selected={form.branch ? [form.branch] : []}
                      onChange={(values) => setForm({ ...form, branch: values[0] ?? '' })}
                      panelClassName="w-64"
                    />
                  </div>
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
                  Enabled (receive daily digest for this branch)
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
      title="Cancelled Call Digests"
      subtitle="Branch managers for the daily cancelled-calls email. Save does not send."
      icon={<Ban className="h-5 w-5" />}
      toolbar={toolbar}
    >
      {body}
    </PageShell>
  );
}
