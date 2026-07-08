'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Mail,
  Paperclip,
  Save,
  Send,
} from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';
import type { MisEmailComposePreview } from '@/lib/mis-email/compose-digest';
import type { MisEmailBodySectionDef, MisEmailBodySectionId } from '@/lib/mis-email/body-sections';
import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import { buildMisEmailSkeletonPreview } from '@/lib/mis-email/skeleton-preview';
import { trackMisEmailSendJob, useMisEmailSendJobs } from '@/lib/mis-email/send-job-client';
import { settingsInputClass } from '@/components/admin/AdminUi';

type MisEmailComposeSettings = {
  primaryEmail: string;
  recipientName?: string;
  roleName: string | null;
  scopeLabel: string | null;
  allowed: {
    includeSummary: boolean;
    includeDetailed: boolean;
    includeKeyAccount: boolean;
  };
  availableBodySections: MisEmailBodySectionDef[];
  availableKeyAccounts: string[];
};

type Props = {
  settings: MisEmailComposeSettings;
  prefs: MisEmailPreferences;
  onPrefsChange: (next: MisEmailPreferences) => void;
  onSaved?: () => void;
};

function parseExtraEmailsInput(raw: string): string[] {
  return [...new Set(raw.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
}

function formatExtraEmailsInput(emails: string[] | undefined): string {
  return (emails ?? []).join(', ');
}

const LIVE_PREVIEW_DEBOUNCE_MS = 800;

export function MisEmailComposer({ settings, prefs, onPrefsChange, onSaved }: Props) {
  const [extraEmailsInput, setExtraEmailsInput] = useState(formatExtraEmailsInput(prefs.extraEmails));
  const [saving, setSaving] = useState(false);
  const { activeJobs, lastFinished, hasActiveSend, clearLastFinished } = useMisEmailSendJobs();
  const [livePreview, setLivePreview] = useState<MisEmailComposePreview | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const [availableKeyAccounts, setAvailableKeyAccounts] = useState<string[]>(
    settings.availableKeyAccounts ?? []
  );
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');

  const draftPrefs = useMemo(
    (): MisEmailPreferences => ({
      ...prefs,
      extraEmails: parseExtraEmailsInput(extraEmailsInput),
    }),
    [prefs, extraEmailsInput]
  );

  const sendTargets = useMemo(() => {
    const primary = settings.primaryEmail.trim().toLowerCase();
    const extras = draftPrefs.extraEmails ?? [];
    return [...new Set([primary, ...extras].filter(Boolean))];
  }, [settings.primaryEmail, draftPrefs.extraEmails]);

  const bodySections = settings.availableBodySections ?? [];
  const selectedBodyIds = draftPrefs.bodyInEmail ?? [];
  const keyAccountBodyEnabled =
    selectedBodyIds.includes('key_account_performance') ||
    (draftPrefs.includeKeyAccount !== false && settings.allowed.includeKeyAccount);
  const selectedKeyAccounts = draftPrefs.keyAccountsInBody ?? [];

  const filteredKeyAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return availableKeyAccounts;
    return availableKeyAccounts.filter((account) => account.toLowerCase().includes(query));
  }, [accountSearch, availableKeyAccounts]);

  const loadAvailableKeyAccounts = useCallback(async (dateRange: MisEmailPreferences['dateRange']) => {
    if (!settings.allowed.includeKeyAccount) {
      setAvailableKeyAccounts([]);
      return;
    }
    setAccountsLoading(true);
    try {
      const params = dateRange ? `?dateRange=${dateRange}` : '';
      const res = await axios.get(`/api/profile/mis-email/accounts${params}`, {
        withCredentials: true,
      });
      setAvailableKeyAccounts(res.data.availableKeyAccounts ?? []);
    } catch {
      setAvailableKeyAccounts([]);
      feedback.actionFailed('Could not load account list — try again');
    } finally {
      setAccountsLoading(false);
    }
  }, [settings.allowed.includeKeyAccount]);

  useEffect(() => {
    if (!keyAccountBodyEnabled) return;
    void loadAvailableKeyAccounts(prefs.dateRange ?? 'month_to_date');
  }, [keyAccountBodyEnabled, prefs.dateRange, loadAvailableKeyAccounts]);

  const layoutPreview = useMemo(() => {
    const portalUrl =
      typeof window !== 'undefined' ? `${window.location.origin}/report` : '/report';
    return buildMisEmailSkeletonPreview({
      preferences: draftPrefs,
      permissions: settings.allowed,
      scopeLabel: settings.scopeLabel ?? 'All branches',
      recipientName: settings.recipientName?.trim() || settings.primaryEmail.split('@')[0] || 'Colleague',
      recipientEmail: settings.primaryEmail,
      portalUrl,
    });
  }, [draftPrefs, settings.allowed, settings.scopeLabel, settings.recipientName, settings.primaryEmail]);

  const previewWarning =
    layoutPreview === null ? 'Select at least one attachment to preview the layout.' : null;

  const displayPreview = livePreview ?? layoutPreview;
  const previewPrefsKey = useMemo(() => JSON.stringify(draftPrefs), [draftPrefs]);
  const sendInProgress = hasActiveSend;
  const sendStatus = activeJobs[0]?.message ?? null;
  const sendResult = lastFinished?.ok ? lastFinished.message : null;
  const sendError = lastFinished && !lastFinished.ok ? lastFinished.message : null;

  useEffect(() => {
    if (!lastFinished) return;
    const timer = window.setTimeout(() => clearLastFinished(), 60_000);
    return () => window.clearTimeout(timer);
  }, [lastFinished, clearLastFinished]);

  useEffect(() => {
    if (layoutPreview === null) {
      setLivePreview(null);
      setLivePreviewLoading(false);
      return;
    }

    setLivePreview(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLivePreviewLoading(true);
      void axios
        .post(
          '/api/profile/mis-email/preview',
          { preferences: draftPrefs },
          { withCredentials: true, signal: controller.signal, timeout: 300_000 }
        )
        .then((res) => {
          setLivePreview(res.data.preview as MisEmailComposePreview);
        })
        .catch((err: unknown) => {
          if (axios.isCancel(err)) return;
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLivePreviewLoading(false);
          }
        });
    }, LIVE_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [previewPrefsKey, layoutPreview, draftPrefs]);

  function handlePeriodChange(dateRange: MisEmailPreferences['dateRange']) {
    onPrefsChange({ ...prefs, dateRange });
    setAvailableKeyAccounts([]);
  }

  function toggleAttachment(key: 'includeSummary' | 'includeDetailed' | 'includeKeyAccount', checked: boolean) {
    onPrefsChange({ ...prefs, [key]: checked });
  }

  function toggleBodySection(id: MisEmailBodySectionId, enabled: boolean) {
    const current = prefs.bodyInEmail ?? [];
    const next = enabled ? [...current, id] : current.filter((item) => item !== id);
    onPrefsChange({ ...prefs, bodyInEmail: next });
  }

  function moveBodySection(id: MisEmailBodySectionId, direction: -1 | 1) {
    const current = [...(prefs.bodyInEmail ?? [])];
    const index = current.indexOf(id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    onPrefsChange({ ...prefs, bodyInEmail: current });
  }

  function isBodySectionDisabled(section: MisEmailBodySectionDef): boolean {
    if (section.requiresSummary && draftPrefs.includeSummary === false) return true;
    if (section.requiresKeyAccount && !settings.allowed.includeKeyAccount) return true;
    return false;
  }

  function toggleKeyAccountInBody(account: string, enabled: boolean) {
    const current = prefs.keyAccountsInBody ?? [];
    const next = enabled
      ? [...current, account]
      : current.filter((item) => item.toLowerCase() !== account.toLowerCase());
    onPrefsChange({ ...prefs, keyAccountsInBody: next });
  }

  function selectAllKeyAccounts() {
    onPrefsChange({ ...prefs, keyAccountsInBody: [...availableKeyAccounts] });
  }

  function clearKeyAccountsInBody() {
    onPrefsChange({ ...prefs, keyAccountsInBody: [] });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...draftPrefs };
      await axios.patch('/api/profile/mis-email', payload, { withCredentials: true });
      onPrefsChange(payload);
      feedback.actionSuccess('Default compose settings saved');
      onSaved?.();
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Save failed';
      feedback.actionFailed(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend(saveFirst: boolean) {
    clearLastFinished();
    try {
      const res = await axios.post(
        '/api/profile/mis-email/send',
        {
          preferences: draftPrefs,
          sendTo: sendTargets,
          savePreferences: saveFirst,
        },
        { withCredentials: true, timeout: 30_000, validateStatus: (status) => status === 202 || status === 200 }
      );

      const jobId = res.data.jobId as string | undefined;
      if (!jobId) {
        feedback.actionFailed('Send was not queued — try again');
        return;
      }

      trackMisEmailSendJob(
        jobId,
        (res.data.message as string | undefined) ?? 'Sending MIS email in the background…'
      );
      if (saveFirst) {
        onPrefsChange(draftPrefs);
        onSaved?.();
      }
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Send failed';
      feedback.actionFailed(message);
    }
  }

  const attachmentOptions = [
    settings.allowed.includeSummary
      ? { key: 'includeSummary' as const, label: 'Summary report (.xlsx)' }
      : null,
    settings.allowed.includeDetailed
      ? { key: 'includeDetailed' as const, label: 'Detailed register (.xlsx)' }
      : null,
    settings.allowed.includeKeyAccount
      ? { key: 'includeKeyAccount' as const, label: 'Key accounts (.xlsx)' }
      : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-bg-soft/70 px-4 py-3">
          <div className="flex items-center gap-2 text-slate-800">
            <Mail size={16} className="text-slate-500" />
            <span className="text-[13px] font-medium">Compose MIS report</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || sendInProgress}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save defaults
            </button>
            <button
              type="button"
              onClick={() => void handleSend(true)}
              disabled={sendInProgress || sendTargets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {sendInProgress ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send now
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="pt-2 text-[11px] font-medium text-slate-400">To</span>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {sendTargets.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700"
                  >
                    {email}
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={extraEmailsInput}
                onChange={(e) => setExtraEmailsInput(e.target.value)}
                placeholder="Additional recipients (comma-separated)"
                className={settingsInputClass()}
              />
              <p className="text-[10px] text-slate-400">
                Primary inbox is always included. Add work or personal copies above.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[72px_1fr] items-center gap-3 px-4 py-3">
            <span className="text-[11px] font-medium text-slate-400">Subject</span>
            <p className="text-[12px] text-slate-800">{displayPreview?.subject ?? 'WRL MIS Reports — …'}</p>
          </div>

          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="pt-1 text-[11px] font-medium text-slate-400">Period</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'month_to_date', label: 'Month to date' },
                { id: 'year_to_yesterday', label: 'Year to yesterday' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handlePeriodChange(opt.id as MisEmailPreferences['dateRange'])}
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                    (prefs.dateRange ?? 'month_to_date') === opt.id
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="pt-1 text-[11px] font-medium text-slate-400">
              <Paperclip size={12} className="inline" /> Attach
            </span>
            <div className="space-y-2">
              {attachmentOptions.map((opt) =>
                opt ? (
                  <label key={opt.key} className="flex items-center gap-2 text-[12px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={draftPrefs[opt.key] !== false}
                      onChange={(e) => toggleAttachment(opt.key, e.target.checked)}
                    />
                    {opt.label}
                  </label>
                ) : null
              )}
            </div>
          </div>

          {bodySections.length > 0 ? (
            <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
              <span className="pt-1 text-[11px] font-medium text-slate-400">Body</span>
              <div className="space-y-2">
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Choose tables to show inside the email. Key accounts appear in the body when the
                  key-account attachment is enabled (all accounts by default; narrow the list below).
                </p>
                {bodySections.map((section) => {
                  const selected = selectedBodyIds.includes(section.id);
                  const orderIndex = selectedBodyIds.indexOf(section.id);
                  return (
                    <div
                      key={section.id}
                      className={`rounded-lg border px-3 py-2.5 ${
                        selected ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected}
                          disabled={isBodySectionDisabled(section)}
                          onChange={(e) => toggleBodySection(section.id, e.target.checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-slate-800">{section.label}</p>
                          <p className="text-[10px] text-slate-500">{section.description}</p>
                        </div>
                        {selected ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              aria-label="Move up"
                              disabled={orderIndex <= 0}
                              onClick={() => moveBodySection(section.id, -1)}
                              className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-white disabled:opacity-30"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={orderIndex < 0 || orderIndex >= selectedBodyIds.length - 1}
                              onClick={() => moveBodySection(section.id, 1)}
                              className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-white disabled:opacity-30"
                            >
                              <ChevronDown size={12} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {keyAccountBodyEnabled ? (
            <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
              <span className="pt-1 text-[11px] font-medium text-slate-400">Accounts</span>
              <div className="space-y-2">
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Optional filter — leave empty to include all key accounts in the email body (like
                  the daily MIS report). Coke and Cadbury rows come from client import data.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    placeholder="Search accounts…"
                    disabled={accountsLoading}
                    className={settingsInputClass()}
                  />
                  <button
                    type="button"
                    onClick={() => selectAllKeyAccounts()}
                    disabled={accountsLoading || availableKeyAccounts.length === 0}
                    className="rounded-md border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => clearKeyAccountsInBody()}
                    disabled={selectedKeyAccounts.length === 0}
                    className="rounded-md border border-slate-200 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear
                  </button>
                  {accountsLoading ? (
                    <Loader2 size={12} className="animate-spin text-slate-400" />
                  ) : (
                    <span className="text-[10px] text-slate-400">
                      {selectedKeyAccounts.length} of {availableKeyAccounts.length} selected
                    </span>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {accountsLoading ? (
                    <p className="px-2 py-3 text-[11px] text-slate-400">Loading accounts…</p>
                  ) : filteredKeyAccounts.length === 0 ? (
                    <p className="px-2 py-3 text-[11px] text-slate-400">
                      No key accounts found for this period.
                    </p>
                  ) : (
                    filteredKeyAccounts.map((account) => {
                      const checked = selectedKeyAccounts.some(
                        (item) => item.toLowerCase() === account.toLowerCase()
                      );
                      return (
                        <label
                          key={account}
                          className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleKeyAccountInBody(account, e.target.checked)}
                          />
                          <span className="text-[11px] text-slate-700">{account}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="text-[11px] font-medium text-slate-400">Scope</span>
            <div className="text-[11px] text-slate-600">
              <p>{settings.roleName ?? 'Your role'} · {settings.scopeLabel ?? 'All branches'}</p>
              {layoutPreview ? (
                <p className="mt-1 text-slate-500">
                  Report period: {layoutPreview.dateRangeLabel} · {layoutPreview.scopeLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {sendStatus ? (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
            <div className="flex items-center gap-2">
              <Loader2 size={12} className="animate-spin shrink-0" />
              <span>{sendStatus}</span>
            </div>
          </div>
        ) : null}

        {sendError ? (
          <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-800">
            {sendError}
          </div>
        ) : null}

        {sendResult ? (
          <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] text-emerald-800">
            {sendResult}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-bg-soft/70 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-[12px] font-medium text-slate-800">
              <FileSpreadsheet size={14} className="text-slate-400" />
              Layout preview
            </div>
            <p className="text-[10px] text-slate-400">
              {livePreview
                ? 'Live figures from your reports'
                : livePreviewLoading
                  ? 'Loading real figures in the background…'
                  : 'Layout loads instantly — figures fill in shortly'}
            </p>
          </div>
          {displayPreview?.attachments?.length ? (
            <div className="flex flex-wrap items-center gap-1">
              {livePreviewLoading ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                  <Loader2 size={10} className="animate-spin" />
                  Loading
                </span>
              ) : livePreview ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                  Live
                </span>
              ) : null}
              {displayPreview.attachments.map((file) => (
                <span
                  key={file}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                >
                  {file}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1 bg-slate-100">
          {previewWarning ? (
            <div className="p-4 text-[12px] text-amber-700">{previewWarning}</div>
          ) : displayPreview?.html ? (
            <iframe
              title="MIS email layout preview"
              srcDoc={displayPreview.html}
              className="h-full min-h-[480px] w-full border-0 bg-white"
              sandbox=""
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
