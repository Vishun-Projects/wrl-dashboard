'use client';

import { useCallback, useEffect, useMemo, useState, type UIEvent } from 'react';
import axios from 'axios';
import {
  Plus,
  Trash2,
  Edit2,
  Play,
  Send,
  CheckCircle2,
  AlertTriangle,
  Search,
  Settings,
  Calendar,
  Clock,
  RefreshCw,
  Inbox,
  Mail,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { feedback } from '@/lib/ui/feedback';
import {
  AdminIconButton,
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import {
  MAIL_ALERTS_CONTENT,
  MAIL_ALERTS_PANEL,
} from '@/modules/mis-email/components/mis-email-ui';

const API_URL = '/api/admin/subcontractor-stock-settings';

type SkipRule = {
  id: string;
  type: 'PLANT' | 'VENDOR' | 'MATERIAL';
  code: string;
  description: string;
  createdAt: string;
};

type Recipient = {
  id: string;
  recipientName: string;
  email: string;
  plantCode: string;
  enabled: boolean;
  reportFilter: 'all' | 'positive' | 'negative';
  createdAt: string;
  updatedAt: string;
};

type RunStatus = {
  id: string;
  runDate: string;
  reconciledAt: string | null;
  emailSentAt: string | null;
  summary: {
    sapRecordCount?: number;
    crmRecordCount?: number;
    matchedCount?: number;
    discrepancyCount?: number;
    totalSapStockValue?: number;
    totalCrmStockValue?: number;
    skippedPlants?: string[];
    skippedVendors?: string[];
    skippedMaterials?: string[];
  } | null;
  excelFilename: string | null;
};

type SapMailRow = {
  id: string;
  mailKey: string;
  subject: string;
  sender: string;
  receivedAt: string;
  extractedAt: string | null;
  attachmentNames: string[];
  reportDate: string | null;
  plantCodes: string[];
  reconcileStatus: 'pending' | 'reconciled' | 'failed' | 'skipped';
  lastError: string | null;
  runDate: string | null;
  reconciledAt: string | null;
};

type CrmMetaItem = {
  code: string;
  name: string;
};

export default function SubcontractorStockSettingsPageClient({
  embedded: _embedded = false,
}: {
  embedded?: boolean;
}) {
  const [skipRules, setSkipRules] = useState<SkipRule[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sendTime, setSendTime] = useState('08:00');
  const [todayRun, setTodayRun] = useState<RunStatus | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunStatus[]>([]);
  const [inboxRows, setInboxRows] = useState<SapMailRow[]>([]);
  const [todayMailCount, setTodayMailCount] = useState(0);
  const [latestReceivedAt, setLatestReceivedAt] = useState<string | null>(null);
  const [selectedMailKeys, setSelectedMailKeys] = useState<string[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);

  // Metadata for dropdowns
  const [crmPlants, setCrmPlants] = useState<CrmMetaItem[]>([]);
  const [crmVendors, setCrmVendors] = useState<CrmMetaItem[]>([]);
  const [crmMaterials, setCrmMaterials] = useState<CrmMetaItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingTime, setSavingTime] = useState(false);
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [syncingInbox, setSyncingInbox] = useState(false);

  // Search filter
  const [searchRecipients, setSearchRecipients] = useState('');
  const [searchRules, setSearchRules] = useState('');
  const [plantSearch, setPlantSearch] = useState('');

  // Modals / Dialogs
  const [recipientForm, setRecipientForm] = useState<{
    id?: string;
    recipientName: string;
    email: string;
    plantCode: string;
    enabled: boolean;
    reportFilter: 'all' | 'positive' | 'negative';
  } | null>(null);

  const [ruleForm, setRuleForm] = useState<{
    type: 'PLANT' | 'VENDOR' | 'MATERIAL';
    codes: string[];
    customCodes: string;
    description: string;
  } | null>(null);

  const [ruleSearchQuery, setRuleSearchQuery] = useState('');

  // Infinite-scroll pagination for the rule options list.
  // Only 100 options are rendered at a time.
  const [visibleRuleOptionCount, setVisibleRuleOptionCount] = useState(100);

  const [deleteRecipientTarget, setDeleteRecipientTarget] = useState<Recipient | null>(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<SkipRule | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [dataRes, optionsRes] = await Promise.all([
        axios.get(API_URL),
        axios.get(`${API_URL}?options=true`),
      ]);

      setSkipRules(dataRes.data.skipRules ?? []);
      setRecipients(dataRes.data.recipients ?? []);
      setSendTime(dataRes.data.sendTime ?? '08:00');
      setTodayRun(dataRes.data.todayRun ?? null);
      setRecentRuns(dataRes.data.recentRuns ?? []);
      setInboxRows(dataRes.data.inbox ?? []);

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const todayMails = (dataRes.data.inbox ?? []).filter(
        (row: SapMailRow) =>
          row.reportDate === today ||
          new Date(row.receivedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today
      );
      setTodayMailCount(todayMails.length);
      setLatestReceivedAt(
        todayMails.length > 0
          ? todayMails.reduce((latest: string, row: SapMailRow) =>
              new Date(row.receivedAt) > new Date(latest) ? row.receivedAt : latest
            , todayMails[0].receivedAt)
          : null
      );

      const pendingTodayKeys = todayMails
        .filter((row: SapMailRow) => row.reconcileStatus === 'pending')
        .map((row: SapMailRow) => row.mailKey);
      setSelectedMailKeys(pendingTodayKeys);

      const enabledIds = (dataRes.data.recipients ?? [])
        .filter((r: Recipient) => r.enabled)
        .map((r: Recipient) => r.id);
      setSelectedRecipientIds(enabledIds);

      setCrmPlants(optionsRes.data.plants ?? []);
      setCrmVendors(optionsRes.data.vendors ?? []);
      setCrmMaterials(optionsRes.data.materials ?? []);
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to load subcontractor settings'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Reset the visible page whenever the rule type or search changes.
  useEffect(() => {
    setVisibleRuleOptionCount(100);
  }, [ruleForm?.type, ruleSearchQuery]);

  const handleTogglePlant = (code: string) => {
    if (!recipientForm) return;
    const current = recipientForm.plantCode
      ? recipientForm.plantCode.split(',').map((p) => p.trim()).filter(Boolean)
      : [];
    let next: string[];
    if (current.includes(code)) {
      next = current.filter((p) => p !== code);
    } else {
      next = [...current, code];
    }
    next.sort();
    setRecipientForm((prev) =>
      prev ? { ...prev, plantCode: next.join(', ') } : null
    );
  };

  const selectedPlants = useMemo(() => {
    if (!recipientForm) return [];
    return recipientForm.plantCode
      ? recipientForm.plantCode.split(',').map((p) => p.trim()).filter(Boolean)
      : [];
  }, [recipientForm?.plantCode]);

  // Recipient form handlers
  const handleSaveRecipient = async () => {
    if (!recipientForm) return;

    if (!recipientForm.recipientName.trim()) {
      feedback.actionFailed('Recipient name is required');
      return;
    }

    if (!recipientForm.email.trim() || !recipientForm.email.includes('@')) {
      feedback.actionFailed('A valid email address is required');
      return;
    }

    if (!recipientForm.plantCode.trim()) {
      feedback.actionFailed('Plant code is required');
      return;
    }

    try {
      if (recipientForm.id) {
        // Update
        const res = await axios.put(API_URL, {
          type: 'recipient',
          data: recipientForm,
        });

        setRecipients((prev) =>
          prev.map((r) => (r.id === res.data.id ? res.data : r))
        );

        feedback.actionSuccess('Recipient updated successfully');
      } else {
        // Create
        const res = await axios.post(API_URL, {
          type: 'recipient',
          data: recipientForm,
        });

        setRecipients((prev) => [...prev, res.data]);
        feedback.actionSuccess('Recipient added successfully');
      }

      setRecipientForm(null);
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to save recipient'
      );
    }
  };

  const handleDeleteRecipient = async () => {
    if (!deleteRecipientTarget) return;

    try {
      await axios.delete(
        `${API_URL}?id=${deleteRecipientTarget.id}&type=recipient`
      );

      setRecipients((prev) =>
        prev.filter((r) => r.id !== deleteRecipientTarget.id)
      );

      feedback.actionSuccess('Recipient deleted');
      setDeleteRecipientTarget(null);
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to delete recipient'
      );
    }
  };

  // Rule form handlers
  const handleSaveRule = async () => {
    if (!ruleForm) return;

    const selectedCodes = [...ruleForm.codes];

    if (ruleForm.customCodes.trim()) {
      const customList = ruleForm.customCodes
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      selectedCodes.push(...customList);
    }

    const uniqueCodes = Array.from(new Set(selectedCodes));

    if (uniqueCodes.length === 0) {
      feedback.actionFailed(
        'Please select at least one code or enter custom codes'
      );
      return;
    }

    try {
      const dataToPost = uniqueCodes.map((code) => ({
        type: ruleForm.type,
        code,
        description: ruleForm.description,
      }));

      const res = await axios.post(API_URL, {
        type: 'skip-rule',
        data: dataToPost,
      });

      const newRules = Array.isArray(res.data) ? res.data : [res.data];

      setSkipRules((prev) => {
        const existingMap = new Map(
          prev.map((r) => [`${r.type}-${r.code}`, r])
        );

        for (const nr of newRules) {
          existingMap.set(`${nr.type}-${nr.code}`, nr);
        }

        return Array.from(existingMap.values());
      });

      feedback.actionSuccess(
        `Exclusion rules added successfully (${uniqueCodes.length} codes)`
      );

      setRuleForm(null);
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to add skip rules'
      );
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteRuleTarget) return;

    try {
      await axios.delete(
        `${API_URL}?id=${deleteRuleTarget.id}&type=skip-rule`
      );

      setSkipRules((prev) =>
        prev.filter((r) => r.id !== deleteRuleTarget.id)
      );

      feedback.actionSuccess('Skip rule deleted');
      setDeleteRuleTarget(null);
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to delete skip rule'
      );
    }
  };

  const handleSaveSendTime = async () => {
    setSavingTime(true);

    try {
      await axios.put(API_URL, {
        type: 'config',
        data: { key: 'send_time_ist', value: sendTime },
      });

      feedback.actionSuccess('Daily email send time updated');
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to save send time'
      );
    } finally {
      setSavingTime(false);
    }
  };

  // Execution triggers
  const handleSyncInbox = async () => {
    setSyncingInbox(true);
    try {
      const res = await axios.post(API_URL, { action: 'sync-inbox' });
      setInboxRows(res.data.inbox ?? []);
      feedback.actionSuccess(`Inbox refreshed (${res.data.upserted ?? 0} updated on VPS).`);
      void loadData();
    } catch (err: any) {
      feedback.actionFailed(err.response?.data?.error || 'Failed to sync SAP inbox');
    } finally {
      setSyncingInbox(false);
    }
  };

  const handleRunReconciliation = async () => {
    setRunningReconciliation(true);

    try {
      const res = await axios.post(API_URL, {
        action: 'run-reconciliation',
        mailKeys: selectedMailKeys.length > 0 ? selectedMailKeys : undefined,
      });

      setTodayRun(res.data.todayRun);
      feedback.actionSuccess('Reconciliation run completed successfully!');
      void loadData();
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to run reconciliation'
      );
    } finally {
      setRunningReconciliation(false);
    }
  };

  const handleSendEmails = async () => {
    if (selectedRecipientIds.length === 0) {
      feedback.actionFailed('Select at least one recipient to send reports.');
      return;
    }

    setSendingEmails(true);

    try {
      const res = await axios.post(API_URL, {
        action: 'send-emails',
        recipientIds: selectedRecipientIds,
      });

      feedback.actionSuccess(
        `Emails triggered successfully. Sent to ${res.data.sentCount} recipients.`
      );

      void loadData();
    } catch (err: any) {
      feedback.actionFailed(
        err.response?.data?.error || 'Failed to send emails'
      );
    } finally {
      setSendingEmails(false);
    }
  };

  const toggleMailKey = (mailKey: string) => {
    setSelectedMailKeys((prev) =>
      prev.includes(mailKey) ? prev.filter((k) => k !== mailKey) : [...prev, mailKey]
    );
  };

  const toggleRecipientId = (id: string) => {
    setSelectedRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const formatIstDateTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  };

  const statusBadgeClass = (status: SapMailRow['reconcileStatus']) => {
    switch (status) {
      case 'reconciled':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10';
      case 'failed':
        return 'bg-red-50 text-red-700 ring-1 ring-red-600/10';
      case 'skipped':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/10';
    }
  };

  // Filter lists
  const filteredRecipients = useMemo(() => {
    const q = searchRecipients.trim().toLowerCase();

    if (!q) return recipients;

    return recipients.filter(
      (r) =>
        r.recipientName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.plantCode.toLowerCase().includes(q)
    );
  }, [recipients, searchRecipients]);

  const filteredRules = useMemo(() => {
    const q = searchRules.trim().toLowerCase();

    if (!q) return skipRules;

    return skipRules.filter(
      (r) =>
        r.type.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
    );
  }, [skipRules, searchRules]);

  // O(1) Lookup Map to avoid O(N) Array scanning on every badge render
  const crmOptionsMap = useMemo(() => {
    const map = new Map<string, string>();

    for (const p of crmPlants) map.set(p.code, p.name);
    for (const v of crmVendors) map.set(v.code, v.name);
    for (const m of crmMaterials) map.set(m.code, m.name);

    return map;
  }, [crmPlants, crmVendors, crmMaterials]);

  const filteredRuleOptions = useMemo(() => {
    if (!ruleForm) return [];

    const list =
      ruleForm.type === 'PLANT'
        ? crmPlants
        : ruleForm.type === 'VENDOR'
          ? crmVendors
          : crmMaterials;

    const q = ruleSearchQuery.trim().toLowerCase();

    if (!q) return list;

    return list.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q)
    );
  }, [
    ruleForm,
    ruleSearchQuery,
    crmPlants,
    crmVendors,
    crmMaterials,
  ]);

  // Render only the currently visible 100-item window.
  // Additional items are appended as the user scrolls.
  const displayedRuleOptions = useMemo(() => {
    return filteredRuleOptions.slice(0, visibleRuleOptionCount);
  }, [filteredRuleOptions, visibleRuleOptionCount]);

  // Infinite scroll handler for the 87k+ option list.
  const handleRuleOptionsScroll = (e: UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;

    const isNearBottom =
      element.scrollTop + element.clientHeight >=
      element.scrollHeight - 50;

    if (
      isNearBottom &&
      visibleRuleOptionCount < filteredRuleOptions.length
    ) {
      setVisibleRuleOptionCount((prev) =>
        Math.min(prev + 100, filteredRuleOptions.length)
      );
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-800" />
      </div>
    );
  }

  return (
    <div className={MAIL_ALERTS_PANEL}>
      <div className={MAIL_ALERTS_CONTENT}>
        {/* Header / Info section */}
        <div className="mb-6 rounded-lg border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Settings className="h-5 w-5 text-indigo-500" />
            Subcontractor Stock Reconciliation Settings
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            SAP subcontractor stock: inbound mail tracking, CRM reconciliation, and plant-specific report routing.
          </p>
        </div>

        {/* SAP Inbox Dashboard */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <Inbox className="h-4 w-4 text-indigo-500" />
                SAP Mail Inbox
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Inbound SAP MBLB mails on VPS (variable timing). Auto-reconciles when new files arrive; use manual send for late arrivals.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSyncInbox}
              disabled={syncingInbox}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingInbox ? 'animate-spin' : ''}`} />
              {syncingInbox ? 'Refreshing…' : 'Refresh from VPS'}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Today&apos;s SAP mails</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{todayMailCount}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Latest: {formatIstDateTime(latestReceivedAt)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Reconciliation</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {todayRun?.reconciledAt ? 'Done today' : 'Pending'}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {todayRun?.reconciledAt
                  ? formatIstDateTime(todayRun.reconciledAt)
                  : 'Waiting for SAP files or manual run'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Email dispatch</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {todayRun?.emailSentAt ? 'Sent today' : `Scheduled ${sendTime} IST`}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {todayRun?.emailSentAt
                  ? formatIstDateTime(todayRun.emailSentAt)
                  : 'Late SAP → manual send below'}
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-150">
            <AdminTable>
              <AdminThead>
                <AdminTr>
                  <AdminTh className="w-10">Select</AdminTh>
                  <AdminTh>Received (IST)</AdminTh>
                  <AdminTh>Subject</AdminTh>
                  <AdminTh>Attachments</AdminTh>
                  <AdminTh>Plants</AdminTh>
                  <AdminTh>Status</AdminTh>
                  <AdminTh>Reconciled at</AdminTh>
                </AdminTr>
              </AdminThead>
              <tbody>
                {inboxRows.length === 0 ? (
                  <AdminTr>
                    <td colSpan={7} className="px-4 py-6 text-center align-middle text-xs text-slate-400">
                      No SAP mails logged yet. Click Refresh from VPS after SAP delivery.
                    </td>
                  </AdminTr>
                ) : (
                  inboxRows.map((row) => (
                    <AdminTr key={row.id}>
                      <AdminTd>
                        <input
                          type="checkbox"
                          checked={selectedMailKeys.includes(row.mailKey)}
                          onChange={() => toggleMailKey(row.mailKey)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </AdminTd>
                      <AdminTd className="font-mono text-[10px] text-slate-600">
                        {formatIstDateTime(row.receivedAt)}
                      </AdminTd>
                      <AdminTd className="max-w-[200px] truncate text-xs text-slate-800">
                        <span title={row.subject}>{row.subject}</span>
                      </AdminTd>
                      <AdminTd className="text-[10px] text-slate-600">
                        {row.attachmentNames.length}
                      </AdminTd>
                      <AdminTd className="font-mono text-[10px] text-slate-600">
                        {row.plantCodes.length > 0 ? row.plantCodes.join(', ') : '—'}
                      </AdminTd>
                      <AdminTd>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBadgeClass(row.reconcileStatus)}`}
                        >
                          {row.reconcileStatus}
                        </span>
                      </AdminTd>
                      <AdminTd className="font-mono text-[10px] text-slate-500">
                        {formatIstDateTime(row.reconciledAt)}
                      </AdminTd>
                    </AdminTr>
                  ))
                )}
              </tbody>
            </AdminTable>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunReconciliation}
              disabled={runningReconciliation}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {runningReconciliation
                ? 'Reconciling…'
                : selectedMailKeys.length > 0
                  ? `Reconcile selected (${selectedMailKeys.length})`
                  : 'Reconcile all today'}
            </button>
          </div>

          {recentRuns.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">Recent run history</h4>
              <div className="space-y-1">
                {recentRuns.slice(0, 7).map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-[10px]"
                  >
                    <span className="font-mono font-semibold text-slate-700">{run.runDate}</span>
                    <span className="text-slate-500">
                      Reconciled: {formatIstDateTime(run.reconciledAt)}
                    </span>
                    <span className="text-slate-500">
                      Email: {run.emailSentAt ? formatIstDateTime(run.emailSentAt) : 'Not sent'}
                    </span>
                    {run.summary && (
                      <span className="text-slate-600">
                        Discrepancies: {run.summary.discrepancyCount ?? 0}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 2 Column Layout: Settings & Rules vs Status Panel */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Recipients Section */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-semibold text-slate-800">
                    Email Routing (Plant Recipients)
                  </h3>

                  <p className="text-xs text-slate-500">
                    Add users to receive daily discrepancy reports filtered by
                    plant.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPlantSearch('');
                    setRecipientForm({
                      recipientName: '',
                      email: '',
                      plantCode: '',
                      enabled: true,
                      reportFilter: 'all',
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Recipient
                </button>
              </div>

              {/* Recipient Search */}
              <div className="mt-4 flex max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <Search className="h-4 w-4 text-slate-400" />

                <input
                  type="text"
                  placeholder="Search recipients..."
                  value={searchRecipients}
                  onChange={(e) => setSearchRecipients(e.target.value)}
                  className="w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>

              {/* Recipients Table */}
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-150">
                <AdminTable>
                  <AdminThead>
                    <AdminTr>
                      <AdminTh>Plant Code</AdminTh>
                      <AdminTh>Recipient Name</AdminTh>
                      <AdminTh>Email Address</AdminTh>
                      <AdminTh>Report Filter</AdminTh>
                      <AdminTh>Status</AdminTh>
                      <AdminTh>Actions</AdminTh>
                    </AdminTr>
                  </AdminThead>

                  <tbody>
                    {filteredRecipients.length === 0 ? (
                      <AdminTr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center align-middle text-xs text-slate-400"
                        >
                          No recipients configured.
                        </td>
                      </AdminTr>
                    ) : (
                      filteredRecipients.map((r) => (
                        <AdminTr key={r.id}>
                          <AdminTd className="font-mono text-xs font-semibold text-slate-700">
                            {r.plantCode}
                          </AdminTd>

                          <AdminTd className="text-xs text-slate-800">
                            {r.recipientName}
                          </AdminTd>

                          <AdminTd className="font-mono text-xs text-slate-600">
                            {r.email}
                          </AdminTd>

                          <AdminTd className="text-xs text-slate-700 capitalize font-medium">
                            {r.reportFilter || 'all'}
                          </AdminTd>

                          <AdminTd>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.enabled
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10'
                                  : 'bg-slate-100 text-slate-600'
                                }`}
                            >
                              {r.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </AdminTd>

                          <AdminTd className="flex items-center gap-1">
                            <AdminIconButton
                              onClick={() => {
                                setPlantSearch('');
                                setRecipientForm(r);
                              }}
                              title="Edit recipient"
                            >
                              <Edit2 className="h-4 w-4" />
                            </AdminIconButton>

                            <AdminIconButton
                              onClick={() => setDeleteRecipientTarget(r)}
                              title="Delete recipient"
                              variant="danger"
                            >
                              <Trash2 className="h-4 w-4" />
                            </AdminIconButton>
                          </AdminTd>
                        </AdminTr>
                      ))
                    )}
                  </tbody>
                </AdminTable>
              </div>
            </div>

            {/* Skip Rules Section */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-semibold text-slate-800">
                    Skip Rules (Exclusions)
                  </h3>

                  <p className="text-xs text-slate-500">
                    Exclude specific plants, vendor codes, or materials from
                    being reconciled.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setRuleForm({
                      type: 'PLANT',
                      codes: [],
                      customCodes: '',
                      description: '',
                    });

                    setRuleSearchQuery('');
                    setVisibleRuleOptionCount(100);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Skip Rule
                </button>
              </div>

              {/* Skip Rules Search */}
              <div className="mt-4 flex max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <Search className="h-4 w-4 text-slate-400" />

                <input
                  type="text"
                  placeholder="Search rules..."
                  value={searchRules}
                  onChange={(e) => setSearchRules(e.target.value)}
                  className="w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>

              {/* Rules Table */}
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-150">
                <AdminTable>
                  <AdminThead>
                    <AdminTr>
                      <AdminTh>Type</AdminTh>
                      <AdminTh>Exclusion Code</AdminTh>
                      <AdminTh>Description</AdminTh>
                      <AdminTh>Added</AdminTh>
                      <AdminTh>Actions</AdminTh>
                    </AdminTr>
                  </AdminThead>

                  <tbody>
                    {filteredRules.length === 0 ? (
                      <AdminTr>
                        <td
                          colSpan={5}
                          className="px-4 py-6 text-center align-middle text-xs text-slate-400"
                        >
                          No skip rules configured.
                        </td>
                      </AdminTr>
                    ) : (
                      filteredRules.map((r) => (
                        <AdminTr key={r.id}>
                          <AdminTd>
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold ${r.type === 'PLANT'
                                  ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/10'
                                  : r.type === 'VENDOR'
                                    ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-600/10'
                                    : 'bg-purple-50 text-purple-800 ring-1 ring-purple-600/10'
                                }`}
                            >
                              {r.type}
                            </span>
                          </AdminTd>

                          <AdminTd className="font-mono text-xs font-semibold text-slate-700">
                            {r.code}
                          </AdminTd>

                          <AdminTd className="text-xs text-slate-600">
                            {r.description || '-'}
                          </AdminTd>

                          <AdminTd className="font-mono text-xs text-slate-500">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </AdminTd>

                          <AdminTd>
                            <AdminIconButton
                              onClick={() => setDeleteRuleTarget(r)}
                              title="Delete rule"
                              variant="danger"
                            >
                              <Trash2 className="h-4 w-4" />
                            </AdminIconButton>
                          </AdminTd>
                        </AdminTr>
                      ))
                    )}
                  </tbody>
                </AdminTable>
              </div>
            </div>
          </div>

          {/* Right Column: Execution Controls, Scheduling, Status */}
          <div className="space-y-6">
            {/* Timing Config */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="flex items-center gap-2 border-b border-slate-100 pb-3 font-semibold text-slate-800">
                <Clock className="h-4 w-4 text-indigo-500" />
                Schedule Settings
              </h3>

              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-600">
                  Daily Email Send Time (IST)
                </label>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="time"
                    value={sendTime}
                    onChange={(e) => setSendTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  />

                  <button
                    type="button"
                    onClick={handleSaveSendTime}
                    disabled={savingTime}
                    className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
                  >
                    {savingTime ? 'Saving...' : 'Save Time'}
                  </button>
                </div>

                <p className="mt-2 text-[10px] text-slate-400">
                  SAP mail arrival time varies. Morning auto-send runs at this time when reconciliation is ready. Late SAP requires manual send from the inbox panel.
                </p>
              </div>
            </div>

            {/* Run Actions / Status Panel */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="flex items-center gap-2 border-b border-slate-100 pb-3 font-semibold text-slate-800">
                <Calendar className="h-4 w-4 text-indigo-500" />
                Today&apos;s Reconciliation Run
              </h3>

              {/* Status Indicator */}
              <div className="mt-4">
                {todayRun ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-4">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />

                      <div>
                        <p className="text-xs font-semibold text-emerald-900">
                          Run Ingested & Reconciled
                        </p>

                        <p className="mt-0.5 font-mono text-[10px] text-emerald-700">
                          Reconciled At:{' '}
                          {new Date(
                            todayRun.reconciledAt!
                          ).toLocaleTimeString()}
                        </p>

                        {todayRun.emailSentAt ? (
                          <p className="mt-0.5 font-mono text-[10px] text-indigo-700">
                            Emails Dispatched At:{' '}
                            {new Date(
                              todayRun.emailSentAt
                            ).toLocaleTimeString()}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[10px] text-amber-700">
                            Emails pending schedule ({sendTime} IST)
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Summary Stats */}
                    {todayRun.summary && (
                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-100 pt-3 text-[10px]">
                        <div>
                          <span className="text-slate-500">SAP Items:</span>{' '}
                          <span className="font-mono font-bold text-slate-800">
                            {todayRun.summary.sapRecordCount ?? 0}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500">CRM Items:</span>{' '}
                          <span className="font-mono font-bold text-slate-800">
                            {todayRun.summary.crmRecordCount ?? 0}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500">
                            Discrepancies:
                          </span>{' '}
                          <span className="font-mono font-bold text-red-600">
                            {todayRun.summary.discrepancyCount ?? 0}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500">Matches:</span>{' '}
                          <span className="font-mono font-bold text-slate-800">
                            {todayRun.summary.matchedCount ?? 0}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />

                      <div>
                        <p className="text-xs font-semibold text-amber-900">
                          Pending Execution
                        </p>

                        <p className="mt-0.5 text-[10px] text-amber-700">
                          No report run found for today yet.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Manual send — recipient picker */}
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Mail className="h-3.5 w-3.5" />
                  Send to selected recipients
                </p>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {recipients.filter((r) => r.enabled).length === 0 ? (
                    <p className="text-[10px] text-slate-400">No enabled recipients.</p>
                  ) : (
                    recipients
                      .filter((r) => r.enabled)
                      .map((r) => (
                        <label
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2 rounded p-1 text-[10px] hover:bg-white"
                        >
                          <input
                            type="checkbox"
                            checked={selectedRecipientIds.includes(r.id)}
                            onChange={() => toggleRecipientId(r.id)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="font-medium text-slate-800">{r.recipientName}</span>
                          <span className="font-mono text-slate-500">{r.email}</span>
                          <span className="text-slate-400">Plant {r.plantCode}</span>
                        </label>
                      ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={handleRunReconciliation}
                  disabled={runningReconciliation}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {runningReconciliation
                    ? 'Running Reconciliation...'
                    : 'Force Ingest & Reconcile'}
                </button>

                <button
                  type="button"
                  onClick={handleSendEmails}
                  disabled={sendingEmails || !todayRun || selectedRecipientIds.length === 0}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {sendingEmails
                    ? 'Sending Emails...'
                    : `Send to selected (${selectedRecipientIds.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recipient Form Modal */}
      <ModalPortal open={!!recipientForm}>
        {recipientForm && (
          <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
            <ModalBackdrop onClick={() => setRecipientForm(null)} />

            <div className="relative z-[191] w-full max-w-md rounded-xl border border-slate-100 bg-white p-6 shadow-xl">
              <h3 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-800">
                {recipientForm.id
                  ? 'Edit Email Recipient'
                  : 'Add Email Recipient'}
              </h3>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Select Plant Code(s)
                  </label>

                  <div className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/50">
                    {/* Plant Search Filter */}
                    <input
                      type="text"
                      placeholder="Filter plants by code or name..."
                      value={plantSearch}
                      onChange={(e) => setPlantSearch(e.target.value)}
                      className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                    />

                    {/* Scrollable list of plants */}
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 text-xs">
                      {crmPlants
                        .filter((p) => {
                          const q = plantSearch.trim().toLowerCase();
                          return (
                            !q ||
                            p.code.toLowerCase().includes(q) ||
                            p.name.toLowerCase().includes(q)
                          );
                        })
                        .map((p) => {
                          const isChecked = selectedPlants.includes(p.code);
                          return (
                            <label
                              key={p.code}
                              className="flex items-center gap-2 cursor-pointer hover:bg-slate-200/50 p-1 rounded transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleTogglePlant(p.code)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <span className="font-mono font-medium text-slate-700">
                                {p.code}
                              </span>
                              <span className="text-slate-500 truncate">
                                - {p.name}
                              </span>
                            </label>
                          );
                        })}
                      {crmPlants.filter((p) => {
                        const q = plantSearch.trim().toLowerCase();
                        return (
                          !q ||
                          p.code.toLowerCase().includes(q) ||
                          p.name.toLowerCase().includes(q)
                        );
                      }).length === 0 && (
                        <div className="text-center py-2 text-slate-400">
                          No matching plants found
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected / Custom codes field */}
                  <div className="mt-2">
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">
                      Selected Plant Codes (comma separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1101, 1102"
                      value={recipientForm.plantCode}
                      onChange={(e) =>
                        setRecipientForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                plantCode: e.target.value,
                              }
                            : null
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Recipient Name
                  </label>

                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={recipientForm.recipientName}
                    onChange={(e) =>
                      setRecipientForm((prev) =>
                        prev
                          ? {
                            ...prev,
                            recipientName: e.target.value,
                          }
                          : null
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Email Address
                  </label>

                  <input
                    type="email"
                    placeholder="e.g. user@company.com"
                    value={recipientForm.email}
                    onChange={(e) =>
                      setRecipientForm((prev) =>
                        prev
                          ? {
                            ...prev,
                            email: e.target.value,
                          }
                          : null
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Report Filter Preference
                  </label>

                  <select
                    value={recipientForm.reportFilter || 'all'}
                    onChange={(e) =>
                      setRecipientForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              reportFilter: e.target.value as 'all' | 'positive' | 'negative',
                            }
                          : null
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">All Records</option>
                    <option value="positive">Positive Discrepancies Only (&gt; 0)</option>
                    <option value="negative">Negative Discrepancies Only (&lt; 0)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="recipient-enabled"
                    checked={recipientForm.enabled}
                    onChange={(e) =>
                      setRecipientForm((prev) =>
                        prev
                          ? {
                            ...prev,
                            enabled: e.target.checked,
                          }
                          : null
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />

                  <label
                    htmlFor="recipient-enabled"
                    className="text-xs font-medium text-slate-700"
                  >
                    Enabled (receive daily reports)
                  </label>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setRecipientForm(null)}
                  className="rounded-lg border border-slate-250 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleSaveRecipient}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  Save Recipient
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Skip Rule Form Modal */}
      <ModalPortal open={!!ruleForm}>
        {ruleForm && (
          <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
            <ModalBackdrop onClick={() => setRuleForm(null)} />

            <div className="relative z-[191] w-full max-w-md rounded-xl border border-slate-100 bg-white p-6 shadow-xl">
              <h3 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-800">
                Add Exclusion (Skip Rule)
              </h3>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Rule Type
                  </label>

                  <select
                    value={ruleForm.type}
                    onChange={(e) => {
                      setRuleForm((prev) =>
                        prev
                          ? {
                            ...prev,
                            type: e.target.value as
                              | 'PLANT'
                              | 'VENDOR'
                              | 'MATERIAL',
                            codes: [],
                          }
                          : null
                      );

                      setRuleSearchQuery('');
                      setVisibleRuleOptionCount(100);
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="PLANT">
                      Exclude Plant (All matching items)
                    </option>
                    <option value="VENDOR">Exclude Vendor Code</option>
                    <option value="MATERIAL">Exclude Material Code</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Select Codes to Skip (Multiple Selection)
                  </label>

                  {/* Search Bar for Selection list */}
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 text-slate-400" />

                    <input
                      type="text"
                      placeholder="Search to filter codes..."
                      value={ruleSearchQuery}
                      onChange={(e) =>
                        setRuleSearchQuery(e.target.value)
                      }
                      className="w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  </div>

                  {/* Bulk toggle options */}
                  <div className="mb-1.5 flex items-center justify-between px-1 text-[10px]">
                    <span className="font-medium text-slate-550">
                      {filteredRuleOptions.length.toLocaleString()} option
                      {filteredRuleOptions.length !== 1 ? 's' : ''} found
                      {filteredRuleOptions.length > 100 && (
                        <>
                          {' '}
                          (showing first{' '}
                          {Math.min(
                            visibleRuleOptionCount,
                            filteredRuleOptions.length
                          ).toLocaleString()}
                          )
                        </>
                      )}
                    </span>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRuleForm((prev) =>
                            prev
                              ? {
                                ...prev,
                                codes: Array.from(
                                  new Set([
                                    ...prev.codes,
                                    ...filteredRuleOptions.map(
                                      (o) => o.code
                                    ),
                                  ])
                                ),
                              }
                              : null
                          );
                        }}
                        className="font-semibold text-indigo-600 hover:text-indigo-850"
                      >
                        Select All
                      </button>

                      <span className="text-slate-300">|</span>

                      <button
                        type="button"
                        onClick={() => {
                          setRuleForm((prev) =>
                            prev
                              ? {
                                ...prev,
                                codes: prev.codes.filter(
                                  (c) =>
                                    !filteredRuleOptions.some(
                                      (o) => o.code === c
                                    )
                                ),
                              }
                              : null
                          );
                        }}
                        className="font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Scrollable list of checkboxes with 100-item incremental loading */}
                  <div
                    className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2.5"
                    onScroll={handleRuleOptionsScroll}
                  >
                    <div className="space-y-1.5">
                      {displayedRuleOptions.length === 0 ? (
                        <p className="py-2 text-center text-xs font-medium text-slate-450">
                          No matching options
                        </p>
                      ) : (
                        displayedRuleOptions.map((opt) => {
                          const isChecked = ruleForm.codes.includes(
                            opt.code
                          );

                          return (
                            <label
                              key={opt.code}
                              className="flex cursor-pointer items-start gap-2.5 rounded p-1 text-xs text-slate-700 transition-colors hover:bg-slate-100/70"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setRuleForm((prev) => {
                                    if (!prev) return null;

                                    const updatedCodes = isChecked
                                      ? prev.codes.filter(
                                        (c) => c !== opt.code
                                      )
                                      : [...prev.codes, opt.code];

                                    return {
                                      ...prev,
                                      codes: updatedCodes,
                                    };
                                  });
                                }}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500"
                              />

                              <span className="font-mono font-semibold text-slate-900">
                                {opt.code}
                              </span>

                              <span className="truncate border-l border-slate-200 pl-1.5 text-slate-500">
                                {opt.name}
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    {visibleRuleOptionCount <
                      filteredRuleOptions.length && (
                        <div className="py-2 text-center text-[10px] text-slate-400">
                          Showing{' '}
                          {Math.min(
                            visibleRuleOptionCount,
                            filteredRuleOptions.length
                          ).toLocaleString()}{' '}
                          of {filteredRuleOptions.length.toLocaleString()} —
                          scroll for more
                        </div>
                      )}
                  </div>

                  {/* Selected items chips/badges */}
                  {ruleForm.codes.length > 0 && (
                    <div className="mt-2.5">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-slate-650">
                          Selected ({ruleForm.codes.length}):
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setRuleForm((prev) =>
                              prev
                                ? {
                                  ...prev,
                                  codes: [],
                                }
                                : null
                            )
                          }
                          className="font-semibold text-[10px] text-red-600 hover:text-red-800"
                        >
                          Clear All Selected
                        </button>
                      </div>

                      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-lg border border-dashed border-slate-200 bg-white p-2 shadow-inner">
                        {ruleForm.codes
                          .slice(0, 50)
                          .map((code) => {
                            const optName =
                              crmOptionsMap.get(code) || '';

                            return (
                              <span
                                key={code}
                                title={`${code}: ${optName}`}
                                className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-600/10"
                              >
                                {code}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setRuleForm((prev) =>
                                      prev
                                        ? {
                                          ...prev,
                                          codes: prev.codes.filter(
                                            (c) => c !== code
                                          ),
                                        }
                                        : null
                                    )
                                  }
                                  className="ml-0.5 text-[11px] font-bold text-indigo-500 hover:text-indigo-900"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}

                        {ruleForm.codes.length > 50 && (
                          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-600/10">
                            + {ruleForm.codes.length - 50} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Or Enter Custom Codes (comma-separated) */}
                  <div className="mt-3">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-655">
                      Or type custom codes (comma-separated)
                    </label>

                    <input
                      type="text"
                      placeholder="e.g. 1101, V123, M456"
                      value={ruleForm.customCodes}
                      onChange={(e) =>
                        setRuleForm((prev) =>
                          prev
                            ? {
                              ...prev,
                              customCodes: e.target.value,
                            }
                            : null
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Description / Justification
                  </label>

                  <input
                    type="text"
                    placeholder="e.g. Inactive vendor, test plant, obsolete materials"
                    value={ruleForm.description}
                    onChange={(e) =>
                      setRuleForm((prev) =>
                        prev
                          ? {
                            ...prev,
                            description: e.target.value,
                          }
                          : null
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setRuleForm(null)}
                  className="rounded-lg border border-slate-250 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleSaveRule}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  Add Exclusion
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Confirm Recipient Delete */}
      <ConfirmDialog
        open={!!deleteRecipientTarget}
        title="Delete Recipient?"
        description={`Are you sure you want to remove ${deleteRecipientTarget?.recipientName} (${deleteRecipientTarget?.email})?`}
        confirmLabel="Delete"
        onConfirm={handleDeleteRecipient}
        onCancel={() => setDeleteRecipientTarget(null)}
      />

      {/* Confirm Rule Delete */}
      <ConfirmDialog
        open={!!deleteRuleTarget}
        title="Delete Exclusion Rule?"
        description={`Are you sure you want to remove the skip rule for ${deleteRuleTarget?.type} Code: ${deleteRuleTarget?.code}?`}
        confirmLabel="Delete"
        onConfirm={handleDeleteRule}
        onCancel={() => setDeleteRuleTarget(null)}
      />
    </div>
  );
}