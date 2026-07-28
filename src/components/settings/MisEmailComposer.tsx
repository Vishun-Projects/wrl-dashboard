'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Mail,
  Save,
  Send,
} from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';
import type { MisEmailComposePreview } from '@/features/mis-email/lib/compose-digest';
import type { MisEmailBodySectionDef, MisEmailBodySectionId } from '@/features/mis-email/lib/body-sections';
import type {
  MisEmailKeyAccountsByZone,
  MisEmailPreferences,
  MisEmailZoneKey,
} from '@/features/mis-email/lib/preferences';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  resolveMisEmailCcEmails,
  resolveMisEmailToEmails,
} from '@/features/mis-email/lib/preferences';
import { parseOutlookEmailList } from '@/features/mis-email/lib/parse-outlook-emails';
import { buildMisEmailSkeletonPreview } from '@/features/mis-email/lib/skeleton-preview';
import { trackMisEmailSendJob, useMisEmailSendJobs } from '@/features/mis-email/lib/send-job-client';
import {
  accountsMatchDisplayOrKey,
  clientAccountDisplayName,
} from '@/features/report/lib/client-account-display';
import { settingsInputClass } from '@/components/admin/AdminUi';
import { MisEmailBodyLayoutEditor } from '@/components/settings/MisEmailBodyLayoutEditor';
import { Collapse } from '@/components/motion/Collapse';
import { createClient } from '@/lib/supabase/client';
import { getBearerAuthHeaders } from '@/lib/supabase/session';

async function misEmailRequestAuth(): Promise<{
  headers: Record<string, string>;
  withCredentials: true;
}> {
  const supabase = createClient();
  try {
    const headers = await getBearerAuthHeaders(supabase);
    return { headers, withCredentials: true };
  } catch {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
      withCredentials: true,
    };
  }
}

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
  availableKeyAccountsByZone?: MisEmailKeyAccountsByZone;
};

type Props = {
  settings: MisEmailComposeSettings;
  prefs: MisEmailPreferences;
  onPrefsChange: (next: MisEmailPreferences) => void;
  onSaved?: () => void;
};

function formatDateRangeLabel(dateRange: MisEmailPreferences['dateRange'] | undefined): string {
  const value = dateRange ?? 'month_to_date';
  if (value === 'yesterday') return 'Yesterday';
  if (value === 'year_to_yesterday') return 'Year to yesterday';
  return 'Month to yesterday';
}

const LIVE_PREVIEW_DEBOUNCE_MS = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AttachmentPrefKey =
  | 'includeSummary'
  | 'includeDetailed'
  | 'includeKeyAccount'
  | 'includeTraceableExport'
  | 'includeOpenCallsExport';

const ZONES: MisEmailZoneKey[] = ['NORTH', 'EAST', 'WEST', 'SOUTH'];

function emptyZoneSelections(): MisEmailKeyAccountsByZone {
  return { NORTH: [], EAST: [], WEST: [], SOUTH: [] };
}

function isAttachmentEnabled(prefs: MisEmailPreferences, key: AttachmentPrefKey): boolean {
  const value = prefs[key];
  if (value !== undefined) return value;
  return DEFAULT_MIS_EMAIL_PREFERENCES[key];
}

function RecipientChipsInput({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  function addFromRaw(raw: string) {
    const parsed = parseOutlookEmailList(raw);
    if (parsed.length === 0) {
      const single = raw.trim().toLowerCase();
      if (!single) return;
      if (!EMAIL_RE.test(single)) {
        setError(`Invalid email: ${single}`);
        return;
      }
      if (values.includes(single)) {
        setDraft('');
        setError('');
        return;
      }
      onChange([...values, single]);
      setDraft('');
      setError('');
      return;
    }
    const next = [...values];
    for (const email of parsed) {
      if (!next.includes(email)) next.push(email);
    }
    onChange(next);
    setDraft('');
    setError('');
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-stone-500">{label}</label>
      <div className="rounded-md border border-stone-200 bg-stone-50 p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {values.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] text-stone-700"
            >
              {email}
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== email))}
                className="text-stone-400 hover:text-stone-800"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            </span>
          ))}
          {values.length === 0 ? (
            <span className="text-[11px] text-stone-400">No recipients</span>
          ) : null}
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ';' || e.key === ',') {
              e.preventDefault();
              addFromRaw(draft);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text && /[;,]|<[^>]+@/.test(text)) {
              e.preventDefault();
              addFromRaw(text);
            }
          }}
          onBlur={() => {
            if (draft.trim()) addFromRaw(draft);
          }}
          placeholder="Paste Outlook list or type email + Enter"
          className={settingsInputClass()}
        />
      </div>
      {error ? <p className="text-[10.5px] text-rose-600">{error}</p> : null}
      <p className="text-[10.5px] text-stone-500">{hint}</p>
    </div>
  );
}

export function MisEmailComposer({ settings, prefs, onPrefsChange, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const { activeJobs, lastFinished, hasActiveSend, clearLastFinished } = useMisEmailSendJobs();
  const [livePreview, setLivePreview] = useState<MisEmailComposePreview | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const [livePreviewError, setLivePreviewError] = useState<string | null>(null);
  const [availableKeyAccountsByZone, setAvailableKeyAccountsByZone] = useState<MisEmailKeyAccountsByZone>(
    settings.availableKeyAccountsByZone ?? emptyZoneSelections()
  );
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [zoneAccountSearch, setZoneAccountSearch] = useState<Record<MisEmailZoneKey, string>>({
    NORTH: '',
    EAST: '',
    WEST: '',
    SOUTH: '',
  });
  const [allowAutoSendOverride, setAllowAutoSendOverride] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeContentTab, setActiveContentTab] = useState<'attachments' | 'sections'>('attachments');
  const [, setLastSavedAt] = useState<Date | null>(null);

  const draftPrefs = useMemo(
    (): MisEmailPreferences => ({
      ...prefs,
      toEmails: resolveMisEmailToEmails(prefs),
      ccEmails: resolveMisEmailCcEmails(prefs),
    }),
    [prefs]
  );

  const sendTargets = draftPrefs.toEmails ?? [];
  const sendCcTargets = draftPrefs.ccEmails ?? [];

  const bodySections = settings.availableBodySections ?? [];
  const selectedBodyIds = draftPrefs.bodyInEmail ?? [];
  const subscribed = draftPrefs.subscribed !== false;
  const sendTimeIst = draftPrefs.sendTimeIst ?? DEFAULT_MIS_EMAIL_PREFERENCES.sendTimeIst;
  const keyAccountBodyEnabled =
    selectedBodyIds.includes('key_account_performance') ||
    (draftPrefs.includeKeyAccount !== false && settings.allowed.includeKeyAccount);
  const selectedKeyAccountsByZone = useMemo(
    () => ({ ...emptyZoneSelections(), ...(draftPrefs.keyAccountsByZone ?? {}) }),
    [draftPrefs.keyAccountsByZone]
  );

  const filteredKeyAccountsByZone = useMemo(() => {
    const result: MisEmailKeyAccountsByZone = emptyZoneSelections();
    for (const zone of ZONES) {
      const query = zoneAccountSearch[zone].trim().toLowerCase();
      const all = availableKeyAccountsByZone[zone] ?? [];
      result[zone] = query
        ? all.filter((account) => {
            const raw = account.toLowerCase();
            const display = clientAccountDisplayName(account).toLowerCase();
            return raw.includes(query) || display.includes(query);
          })
        : all;
    }
    return result;
  }, [zoneAccountSearch, availableKeyAccountsByZone]);

  const loadAvailableKeyAccounts = useCallback(async (dateRange: MisEmailPreferences['dateRange']) => {
    if (!settings.allowed.includeKeyAccount) {
      return;
    }
    setAccountsLoading(true);
    try {
      const params = dateRange ? `?dateRange=${dateRange}` : '';
      const res = await axios.get(`/api/profile/mis-email/accounts${params}`, {
        withCredentials: true,
      });
      setAvailableKeyAccountsByZone(res.data.accountsByZone ?? emptyZoneSelections());
    } catch {
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
    layoutPreview === null ? 'Select at least one attachment or body section to preview the layout.' : null;

  const displayPreview = livePreview ?? layoutPreview;
  const previewPrefsKey = useMemo(() => JSON.stringify(draftPrefs), [draftPrefs]);
  const [savedPrefsKey, setSavedPrefsKey] = useState(previewPrefsKey);
  const hasUnsavedChanges = savedPrefsKey !== previewPrefsKey;
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
      setLivePreviewError(null);
      return;
    }

    setLivePreview(null);
    setLivePreviewError(null);

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
          setLivePreviewError(null);
        })
        .catch((err: unknown) => {
          if (axios.isCancel(err)) return;
          const message = axios.isAxiosError<{ error?: string }>(err)
            ? err.response?.data?.error || err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load live figures';
          setLivePreviewError(message || 'Failed to load live figures');
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
    setAvailableKeyAccountsByZone(emptyZoneSelections());
  }

  function toggleAttachment(key: AttachmentPrefKey, checked: boolean) {
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
    if (section.requiresSummary && !settings.allowed.includeSummary) return true;
    if (section.requiresKeyAccount && !settings.allowed.includeKeyAccount) return true;
    return false;
  }

  function toggleZoneKeyAccount(zone: MisEmailZoneKey, account: string, enabled: boolean) {
    const current = { ...emptyZoneSelections(), ...(prefs.keyAccountsByZone ?? {}) };
    const existing = current[zone] ?? [];
    const next = enabled
      ? [...existing.filter((item) => !accountsMatchDisplayOrKey(item, account)), account]
      : existing.filter((item) => !accountsMatchDisplayOrKey(item, account));
    current[zone] = next;
    onPrefsChange({ ...prefs, keyAccountsByZone: current });
  }

  function selectAllZoneKeyAccounts(zone: MisEmailZoneKey) {
    const current = { ...emptyZoneSelections(), ...(prefs.keyAccountsByZone ?? {}) };
    current[zone] = [...(availableKeyAccountsByZone[zone] ?? [])];
    onPrefsChange({ ...prefs, keyAccountsByZone: current });
  }

  function clearZoneKeyAccounts(zone: MisEmailZoneKey) {
    const current = { ...emptyZoneSelections(), ...(prefs.keyAccountsByZone ?? {}) };
    current[zone] = [];
    onPrefsChange({ ...prefs, keyAccountsByZone: current });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...draftPrefs };
      const auth = await misEmailRequestAuth();
      await axios.patch('/api/profile/mis-email', payload, auth);
      onPrefsChange(payload);
      setSavedPrefsKey(JSON.stringify(payload));
      setLastSavedAt(new Date());
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
      const auth = await misEmailRequestAuth();
      const res = await axios.post(
        '/api/profile/mis-email/send',
        {
          preferences: draftPrefs,
          sendTo: sendTargets,
          sendCc: sendCcTargets,
          savePreferences: saveFirst,
            allowAutoSendDisabledOverride: allowAutoSendOverride,
        },
        {
          ...auth,
          timeout: 30_000,
          validateStatus: (status) => status === 202 || status === 200,
        }
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
        setSavedPrefsKey(previewPrefsKey);
        setLastSavedAt(new Date());
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
    settings.allowed.includeSummary
      ? {
          key: 'includeTraceableExport' as const,
          label: 'Traceable export (.xlsx)',
          hint: 'Summary dashboard with row-level call detail — same as Export Trace on the report page',
        }
      : null,
    settings.allowed.includeSummary
      ? {
          key: 'includeOpenCallsExport' as const,
          label: 'Open calls export (.xlsx)',
          hint: 'Row detail only for open + assigned calls (status shown as Unsolved)',
        }
      : null,
    settings.allowed.includeDetailed
      ? { key: 'includeDetailed' as const, label: 'Detailed register (.xlsx)' }
      : null,
    settings.allowed.includeKeyAccount
      ? { key: 'includeKeyAccount' as const, label: 'Key accounts (.xlsx)' }
      : null,
  ].filter(Boolean);

  const enabledAttachmentCount = attachmentOptions.filter(
    (opt) => opt && isAttachmentEnabled(draftPrefs, opt.key)
  ).length;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-bg-canvas shadow-sm">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
                <Mail size={15} />
              </div>
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight text-stone-900">Email reports</h2>
                <p className="text-[11px] text-stone-500">
                  <span className="font-semibold text-stone-700">{settings.roleName ?? 'Your role'}</span>
                  {' · '}
                  {settings.scopeLabel ?? 'All branches'}
                  {' · '}
                  Report period: {formatDateRangeLabel(draftPrefs.dateRange)}
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                hasUnsavedChanges
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}
            >
              {hasUnsavedChanges ? 'Unsaved changes' : 'Matches saved defaults'}
            </span>
          </div>

          <div className="my-3 h-px bg-stone-200" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={subscribed}
                  onChange={(e) => onPrefsChange({ ...prefs, subscribed: e.target.checked })}
                />
                <span className="text-[12px] font-semibold text-stone-800">Scheduled digest</span>
              </label>
              <input
                type="time"
                step={300}
                value={sendTimeIst}
                disabled={!subscribed}
                onChange={(e) => onPrefsChange({ ...prefs, sendTimeIst: e.target.value })}
                className="h-8 rounded-md border border-stone-300 bg-white px-2 text-[12px] text-stone-700 disabled:opacity-50"
              />
              <span className="text-[11px] text-stone-500">IST</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-stone-500">
                <input
                  type="checkbox"
                  checked={allowAutoSendOverride}
                  onChange={(e) => setAllowAutoSendOverride(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Override HOD auto-send block
              </label>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || sendInProgress}
                className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-2 text-[12px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save defaults
              </button>
              <button
                type="button"
                onClick={() => void handleSend(true)}
                disabled={sendInProgress || sendTargets.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-50"
              >
                {sendInProgress ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send now
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="space-y-3">
          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-stone-900">Recipients</p>
              <p className="text-[10.5px] text-stone-500">To and Cc for this Daily MIS Report</p>
            </div>
            <div className="space-y-3 px-3.5 py-3">
              <RecipientChipsInput
                label="To"
                hint="Paste an Outlook To line, or add emails one by one."
                values={sendTargets}
                onChange={(toEmails) => onPrefsChange({ ...prefs, toEmails })}
              />
              <RecipientChipsInput
                label="Cc"
                hint="Paste an Outlook Cc line, or add emails one by one."
                values={sendCcTargets}
                onChange={(ccEmails) => onPrefsChange({ ...prefs, ccEmails })}
              />
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-stone-900">Report period</p>
              <p className="text-[10.5px] text-stone-500">Date range this send covers</p>
            </div>
            <div className="space-y-2.5 px-3.5 py-3">
              <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-2 font-mono text-[11px] text-stone-700">
                {displayPreview?.subject ?? 'Daily MIS Report as on ...'}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'month_to_date', label: 'Month to yesterday' },
                  { id: 'year_to_yesterday', label: 'Year to yesterday' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handlePeriodChange(opt.id as MisEmailPreferences['dateRange'])}
                    className={`rounded-md border px-2 py-2 text-[11.5px] font-semibold ${
                      (prefs.dateRange ?? 'month_to_date') === opt.id
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-200 px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-stone-900">Report content</p>
              <p className="text-[10.5px] text-stone-500">Attachments and what shows inside email body</p>
            </div>
            <div className="px-2 pt-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setActiveContentTab('attachments')}
                  className={`flex-1 border-b-2 px-2 py-2 text-[11.5px] font-semibold ${
                    activeContentTab === 'attachments'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-stone-500'
                  }`}
                >
                  Attachments{' '}
                  <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px]">
                    {enabledAttachmentCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveContentTab('sections')}
                  className={`flex-1 border-b-2 px-2 py-2 text-[11.5px] font-semibold ${
                    activeContentTab === 'sections'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-stone-500'
                  }`}
                >
                  Body sections{' '}
                  <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px]">
                    {selectedBodyIds.length}
                  </span>
                </button>
              </div>
            </div>
            <div className="space-y-2 p-3">
              {activeContentTab === 'attachments'
                ? attachmentOptions.map((opt) =>
                    opt ? (
                      <label
                        key={opt.key}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 ${
                          isAttachmentEnabled(draftPrefs, opt.key)
                            ? 'border-indigo-200 bg-indigo-50'
                            : 'border-stone-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={isAttachmentEnabled(draftPrefs, opt.key)}
                          onChange={(e) => toggleAttachment(opt.key, e.target.checked)}
                        />
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-stone-800">{opt.label}</p>
                          {'hint' in opt && opt.hint ? (
                            <p className="text-[10.5px] leading-relaxed text-stone-500">{opt.hint}</p>
                          ) : null}
                        </div>
                      </label>
                    ) : null
                  )
                : bodySections.map((section) => {
                    const selected = selectedBodyIds.includes(section.id);
                    const orderIndex = selectedBodyIds.indexOf(section.id);
                    return (
                      <div
                        key={section.id}
                        className={`rounded-lg border p-2.5 ${
                          selected ? 'border-indigo-200 bg-indigo-50/70' : 'border-stone-200 bg-white'
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
                            <p className="text-[12px] font-semibold text-stone-800">{section.label}</p>
                            <p className="text-[10.5px] text-stone-600">{section.description}</p>
                          </div>
                          {selected ? (
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                aria-label="Move up"
                                disabled={orderIndex <= 0}
                                onClick={() => moveBodySection(section.id, -1)}
                                className="rounded border border-stone-300 bg-white p-0.5 text-stone-500 disabled:opacity-30"
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label="Move down"
                                disabled={orderIndex < 0 || orderIndex >= selectedBodyIds.length - 1}
                                onClick={() => moveBodySection(section.id, 1)}
                                className="rounded border border-stone-300 bg-white p-0.5 text-stone-500 disabled:opacity-30"
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
          </section>

          {(selectedBodyIds.length > 0 || keyAccountBodyEnabled) ? (
            <section className="rounded-xl border border-stone-200 bg-white">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="flex w-full items-center justify-between px-3.5 py-3 text-left text-[12px] font-semibold text-stone-700"
              >
                <span>Advanced options — layout and account filters</span>
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <Collapse open={showAdvanced}>
                <div className="space-y-3 px-3.5 pb-3">
                  {selectedBodyIds.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-wide text-stone-500">Body layout</p>
                      <MisEmailBodyLayoutEditor
                        selectedSectionIds={selectedBodyIds}
                        bodySections={bodySections}
                        layout={draftPrefs.bodyLayout}
                        onLayoutChange={(bodyLayout) => onPrefsChange({ ...prefs, bodyLayout })}
                      />
                    </div>
                  ) : null}
                  {keyAccountBodyEnabled ? (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-wide text-stone-500">Account filters</p>
                      <p className="text-[10px] text-stone-500">
                        Each zone only shows the accounts you pick for that zone. The same account can be selected in multiple zones.
                      </p>
                      {ZONES.map((zone) => {
                        const all = availableKeyAccountsByZone[zone] ?? [];
                        const filtered = filteredKeyAccountsByZone[zone] ?? [];
                        const selected = selectedKeyAccountsByZone[zone] ?? [];
                        const anyZonePicked = ZONES.some(
                          (z) => (selectedKeyAccountsByZone[z] ?? []).length > 0
                        );
                        return (
                          <div key={zone} className="rounded-lg border border-stone-200 p-2.5">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold text-stone-700">{zone}</p>
                              <span className="text-[10px] text-stone-400">
                                {selected.length
                                  ? `${selected.length} selected`
                                  : anyZonePicked
                                    ? 'None'
                                    : 'All clients'}
                              </span>
                            </div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={zoneAccountSearch[zone]}
                                onChange={(e) =>
                                  setZoneAccountSearch((prev) => ({ ...prev, [zone]: e.target.value }))
                                }
                                placeholder={`Search ${zone} clients...`}
                                disabled={accountsLoading}
                                className={settingsInputClass()}
                              />
                              <button
                                type="button"
                                onClick={() => selectAllZoneKeyAccounts(zone)}
                                disabled={accountsLoading || all.length === 0}
                                className="rounded-md border border-stone-300 px-2 py-1 text-[10px] text-stone-600 disabled:opacity-50"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => clearZoneKeyAccounts(zone)}
                                disabled={selected.length === 0}
                                className="rounded-md border border-stone-300 px-2 py-1 text-[10px] text-stone-600 disabled:opacity-50"
                              >
                                Clear
                              </button>
                            </div>
                            <div className="max-h-36 overflow-y-auto rounded border border-stone-200 p-1.5">
                              {accountsLoading ? (
                                <p className="px-2 py-2 text-[10px] text-stone-400">Loading...</p>
                              ) : filtered.length === 0 ? (
                                <p className="px-2 py-2 text-[10px] text-stone-400">No clients</p>
                              ) : (
                                filtered.map((account) => {
                                  const checked = selected.some((item) =>
                                    accountsMatchDisplayOrKey(item, account)
                                  );
                                  return (
                                    <label
                                      key={`${zone}-${account}`}
                                      className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-stone-50"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => toggleZoneKeyAccount(zone, account, e.target.checked)}
                                      />
                                      <span className="text-[10px] text-stone-700">
                                        {clientAccountDisplayName(account)}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </Collapse>
            </section>
          ) : null}

          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <p className="mb-1 text-[11px] font-semibold text-stone-700">Scope summary</p>
            <p className="text-[11px] text-stone-600">
              {settings.roleName ?? 'Your role'} · {settings.scopeLabel ?? 'All branches'}
            </p>
          </section>

          {sendStatus ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="shrink-0 animate-spin" />
                <span>{sendStatus}</span>
              </div>
            </div>
          ) : null}
          {sendError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
              {sendError}
            </div>
          ) : null}
          {sendResult ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              {sendResult}
            </div>
          ) : null}

          <p className="px-1 text-[10.5px] leading-relaxed text-stone-500">
            Send now queues this draft immediately. Save defaults keeps these settings for future scheduled digests.
          </p>
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
                  : livePreviewError
                    ? 'Layout only — live figures failed'
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
              ) : livePreviewError ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                  Layout only
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

        {livePreview?.gmailClipWarning ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
            <p>{livePreview.gmailClipWarning}</p>
            {livePreview.keyAccountRowsTotal != null &&
            livePreview.keyAccountRowsInBody != null &&
            livePreview.keyAccountRowsInBody < livePreview.keyAccountRowsTotal ? (
              <p className="mt-0.5 text-amber-700">
                Key accounts in email body: {livePreview.keyAccountRowsInBody} of{' '}
                {livePreview.keyAccountRowsTotal} — full list is in the attached Excel.
              </p>
            ) : null}
          </div>
        ) : null}
        {livePreviewError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
            Could not load live figures: {livePreviewError}
          </div>
        ) : null}

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
  </div>
  );
}
