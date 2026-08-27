'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { MisEmailComposePreview } from '@/modules/mis-email/services/compose-digest';
import type { MisEmailBodySectionDef, MisEmailBodySectionId } from '@/modules/mis-email/services/body-sections';
import type {
  MisEmailKeyAccountsByZone,
  MisEmailPreferences,
  MisEmailZoneKey,
} from '@/modules/mis-email/services/preferences';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  resolveMisEmailCcEmails,
  resolveMisEmailToEmails,
} from '@/modules/mis-email/services/preferences';
import { buildMisEmailSkeletonPreview } from '@/modules/mis-email/services/skeleton-preview';
import {
  formatDigestSubject,
  resolveMisEmailSubjectTemplate,
  type MisEmailIntroPreset,
} from '@/modules/mis-email/services/email-template';
import type { MisEmailLetterCopy } from '@/modules/mis-email/services/org-settings-defaults';
import { trackMisEmailSendJob, useMisEmailSendJobs } from '@/modules/mis-email/services/send-job-client';
import {
  accountsMatchDisplayOrKey,
  clientAccountDisplayName,
} from '@/modules/mis';
import { settingsInputClass } from '@/components/admin/AdminUi';
import { MisEmailBodyLayoutEditor } from '@/modules/mis-email/components/MisEmailBodyLayoutEditor';
import { Collapse } from '@/components/motion/Collapse';
import { EmailChipsInput } from '@/modules/mis-email/components/TagChipsInput';
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
  letterCopy?: MisEmailLetterCopy | null;
};

type Props = {
  settings: MisEmailComposeSettings;
  prefs: MisEmailPreferences;
  onPrefsChange: (next: MisEmailPreferences) => void;
  onSaved?: () => void;
};

const LIVE_PREVIEW_DEBOUNCE_MS = 800;

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeContentTab, setActiveContentTab] = useState<'attachments' | 'sections'>('attachments');
  const [optionsOpen, setOptionsOpen] = useState<'content' | 'schedule' | null>(null);
  const [introPreset, setIntroPreset] = useState<MisEmailIntroPreset>('normal');
  const [, setLastSavedAt] = useState<Date | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const [previewIframeHeight, setPreviewIframeHeight] = useState(600);

  const resizePreviewIframe = useCallback(() => {
    const iframe = previewIframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;

    // Shrink first so scrollHeight is content size, not the previous iframe size.
    iframe.style.height = '1px';
    const outer = doc.querySelector('.email-outer');
    const contentHeight =
      outer instanceof HTMLElement ? outer.scrollHeight : doc.body.scrollHeight;
    const height = Math.ceil(Math.max(contentHeight, 200));
    iframe.style.height = `${height}px`;
    setPreviewIframeHeight(height);
  }, []);

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
      settings.letterCopy?.portalBaseUrl?.replace(/\/$/, '') ||
      (typeof window !== 'undefined' ? `${window.location.origin}/report` : '/report');
    return buildMisEmailSkeletonPreview({
      preferences: draftPrefs,
      permissions: settings.allowed,
      scopeLabel: settings.scopeLabel ?? 'All branches',
      recipientName: settings.recipientName?.trim() || settings.primaryEmail.split('@')[0] || 'Colleague',
      recipientEmail: settings.primaryEmail,
      portalUrl,
      introPreset,
      letterCopy: settings.letterCopy,
    });
  }, [
    draftPrefs,
    introPreset,
    settings.allowed,
    settings.scopeLabel,
    settings.recipientName,
    settings.primaryEmail,
    settings.letterCopy,
  ]);

  const letterSubject = useMemo(() => {
    const endDate = layoutPreview?.dateRange.endDate;
    const template = resolveMisEmailSubjectTemplate(introPreset, {
      normal: settings.letterCopy?.subjectTemplate,
      revised: settings.letterCopy?.subjectTemplateRevised,
    });
    return formatDigestSubject(endDate, undefined, template);
  }, [introPreset, layoutPreview?.dateRange.endDate, settings.letterCopy]);

  const displaySubject = livePreview?.subject ?? letterSubject;

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
  const queuingSendRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => resizePreviewIframe(), 80);
    return () => window.clearTimeout(timer);
  }, [displayPreview?.html, resizePreviewIframe]);

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
          { preferences: draftPrefs, introPreset },
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
  }, [previewPrefsKey, layoutPreview, draftPrefs, introPreset]);

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
    if (sendInProgress || queuingSendRef.current || sendTargets.length === 0) return;
    queuingSendRef.current = true;
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
          introPreset,
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
    } finally {
      queuingSendRef.current = false;
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

  function toggleOptions(panel: 'content' | 'schedule') {
    setOptionsOpen((prev) => (prev === panel ? null : panel));
  }

  const addressLabelClass =
    'inline-flex h-7 w-12 shrink-0 items-center justify-center rounded border border-stone-300 bg-stone-50 text-[12px] font-semibold text-stone-700';

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      {/* Outlook-style address header — To/Cc left as-is */}
      <div className="flex flex-col gap-2 border-b border-stone-200 p-2 sm:flex-row sm:gap-0">
        <div className="flex shrink-0 items-center sm:w-[56px] sm:items-start sm:justify-center sm:border-r sm:border-stone-200 sm:pr-2 sm:pt-0.5">
          <button
            type="button"
            onClick={() => void handleSend(true)}
            disabled={sendInProgress || sendTargets.length === 0}
            className="flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-md bg-[#0f6cbd] text-white hover:bg-[#115ea3] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendInProgress ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            <span className="text-[11px] font-semibold leading-none">Send</span>
          </button>
        </div>

        <div className="min-w-0 flex-1 sm:pl-2">
          <div className="flex items-start gap-2 border-b border-stone-200 py-1">
            <span className={`${addressLabelClass} mt-0.5`}>To</span>
            <EmailChipsInput
              label="To"
              variant="outlook"
              compact
              values={sendTargets}
              onChange={(toEmails) => onPrefsChange({ ...prefs, toEmails })}
            />
          </div>
          <div className="flex items-start gap-2 border-b border-stone-200 py-1">
            <span className={`${addressLabelClass} mt-0.5`}>Cc</span>
            <EmailChipsInput
              label="Cc"
              variant="outlook"
              compact
              values={sendCcTargets}
              onChange={(ccEmails) => onPrefsChange({ ...prefs, ccEmails })}
            />
          </div>
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-12 shrink-0 text-[11px] font-semibold text-stone-600">Subject</span>
            <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-stone-800">
              {displaySubject || 'Daily MIS Report as on ...'}
            </div>
          </div>
        </div>
      </div>

      {/* Options strip */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 bg-stone-50 px-2 py-1.5">
        <div
          className="inline-flex rounded border border-stone-300 bg-white p-0.5"
          role="group"
          aria-label="Body intro preset"
        >
          {(
            [
              { id: 'normal' as const, label: 'Normal' },
              { id: 'revised' as const, label: 'Revised' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setIntroPreset(opt.id)}
              title={
                opt.id === 'revised'
                  ? 'Resend after late import — subject and body say Revised'
                  : 'Same intro as the scheduled digest'
              }
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                introPreset === opt.id
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded border border-stone-300 bg-white p-0.5">
          {[
            { id: 'yesterday' as const, label: 'Yday' },
            { id: 'month_to_date' as const, label: 'Month' },
            { id: 'year_to_yesterday' as const, label: 'Year' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handlePeriodChange(opt.id)}
              title={
                opt.id === 'month_to_date'
                  ? 'Month to yesterday'
                  : opt.id === 'year_to_yesterday'
                    ? 'Year to yesterday'
                    : 'Yesterday'
              }
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                (prefs.dateRange ?? 'month_to_date') === opt.id
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            if (optionsOpen === 'content' && activeContentTab === 'attachments') {
              setOptionsOpen(null);
            } else {
              setActiveContentTab('attachments');
              setOptionsOpen('content');
            }
          }}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
            optionsOpen === 'content' && activeContentTab === 'attachments'
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
          }`}
        >
          <FileSpreadsheet size={11} />
          Attach
          <span className="text-[10px] opacity-80">{enabledAttachmentCount}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (optionsOpen === 'content' && activeContentTab === 'sections') {
              setOptionsOpen(null);
            } else {
              setActiveContentTab('sections');
              setOptionsOpen('content');
            }
          }}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
            optionsOpen === 'content' && activeContentTab === 'sections'
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
          }`}
        >
          Body
          <span className="text-[10px] opacity-80">{selectedBodyIds.length}</span>
        </button>

        <button
          type="button"
          onClick={() => toggleOptions('schedule')}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
            optionsOpen === 'schedule'
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
          }`}
        >
          <Mail size={11} />
          Schedule
        </button>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || sendInProgress}
          className="inline-flex items-center gap-1 rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          Save
        </button>

        <span
          className={`ml-auto inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            hasUnsavedChanges
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {hasUnsavedChanges ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      {/* Expandable options */}
      <Collapse open={optionsOpen === 'content'}>
        <div className="border-b border-stone-200 bg-white px-2 py-2">
          <div className="mb-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => setActiveContentTab('attachments')}
              className={`border-b-2 px-2 py-1 text-[11px] font-semibold ${
                activeContentTab === 'attachments'
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500'
              }`}
            >
              Attachments
            </button>
            <button
              type="button"
              onClick={() => setActiveContentTab('sections')}
              className={`border-b-2 px-2 py-1 text-[11px] font-semibold ${
                activeContentTab === 'sections'
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500'
              }`}
            >
              Body sections
            </button>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {activeContentTab === 'attachments'
              ? attachmentOptions.map((opt) =>
                  opt ? (
                    <label
                      key={opt.key}
                      className={`flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 ${
                        isAttachmentEnabled(draftPrefs, opt.key)
                          ? 'border-stone-400 bg-stone-50'
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
                        <p className="text-[11px] font-semibold text-stone-800">{opt.label}</p>
                        {'hint' in opt && opt.hint ? (
                          <p className="text-[10px] leading-snug text-stone-500">{opt.hint}</p>
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
                      className={`rounded border px-2 py-1.5 ${
                        selected ? 'border-stone-400 bg-stone-50' : 'border-stone-200 bg-white'
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
                          <p className="text-[11px] font-semibold text-stone-800">{section.label}</p>
                          <p className="text-[10px] leading-snug text-stone-600">{section.description}</p>
                        </div>
                        {selected ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              aria-label="Move up"
                              disabled={orderIndex <= 0}
                              onClick={() => moveBodySection(section.id, -1)}
                              className="rounded border border-stone-300 bg-white p-0.5 text-stone-500 disabled:opacity-30"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              type="button"
                              aria-label="Move down"
                              disabled={orderIndex < 0 || orderIndex >= selectedBodyIds.length - 1}
                              onClick={() => moveBodySection(section.id, 1)}
                              className="rounded border border-stone-300 bg-white p-0.5 text-stone-500 disabled:opacity-30"
                            >
                              <ChevronDown size={11} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      </Collapse>

      <Collapse open={optionsOpen === 'schedule'}>
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-2 py-2">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-emerald-600"
              checked={subscribed}
              onChange={(e) => onPrefsChange({ ...prefs, subscribed: e.target.checked })}
            />
            <span className="text-[11px] font-semibold text-stone-800">Scheduled digest</span>
          </label>
          <input
            type="time"
            step={300}
            value={sendTimeIst}
            disabled={!subscribed}
            onChange={(e) => onPrefsChange({ ...prefs, sendTimeIst: e.target.value })}
            className="h-7 rounded border border-stone-300 bg-white px-1.5 text-[11px] text-stone-700 disabled:opacity-50"
          />
          <span className="text-[10px] text-stone-500">IST · your account only</span>
          <span className="text-[10px] text-stone-500">
            {settings.roleName ?? 'Your role'} · {settings.scopeLabel ?? 'All branches'}
          </span>
        </div>
      </Collapse>

      {(selectedBodyIds.length > 0 || keyAccountBodyEnabled) ? (
        <div className="border-b border-stone-200">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex w-full items-center justify-between px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-stone-500 hover:bg-stone-50"
          >
            <span>Advanced</span>
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <Collapse open={showAdvanced}>
            <div className="space-y-2 px-2 pb-2">
              {selectedBodyIds.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    Body layout
                  </p>
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
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    Account filters
                  </p>
                  <p className="text-[11px] text-stone-500">
                    Each zone only shows the accounts you pick for that zone. The same account can be
                    selected in multiple zones.
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
                          <p className="text-[12px] font-semibold text-stone-700">{zone}</p>
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
                            className="rounded-md border border-stone-300 px-2 py-1 text-[11px] text-stone-700 disabled:opacity-50"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => clearZoneKeyAccounts(zone)}
                            disabled={selected.length === 0}
                            className="rounded-md border border-stone-300 px-2 py-1 text-[11px] text-stone-700 disabled:opacity-50"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="max-h-36 overflow-y-auto rounded border border-stone-200 p-1.5">
                          {accountsLoading ? (
                            <p className="px-2 py-2 text-[11px]">Loading...</p>
                          ) : filtered.length === 0 ? (
                            <p className="px-2 py-2 text-[11px]">No clients</p>
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
                                    onChange={(e) =>
                                      toggleZoneKeyAccount(zone, account, e.target.checked)
                                    }
                                  />
                                  <span className="text-[11px] text-stone-700">
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
        </div>
      ) : null}

      {sendStatus ? (
        <div className="border-b border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <div className="flex items-center gap-1.5">
            <Loader2 size={11} className="shrink-0 animate-spin" />
            <span>{sendStatus}</span>
          </div>
        </div>
      ) : null}
      {sendError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
          {sendError}
        </div>
      ) : null}
      {sendResult ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
          {sendResult}
        </div>
      ) : null}

      {/* Message body = email preview (grows with content; page scrolls) */}
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-50/80 px-2 py-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-600">
            <FileSpreadsheet size={12} className="shrink-0 text-stone-400" />
            <span className="font-medium text-stone-800">Preview</span>
            <span className="truncate text-stone-400">
              ·{' '}
              {livePreview
                ? 'Live figures'
                : livePreviewLoading
                  ? 'Loading figures…'
                  : livePreviewError
                    ? 'Layout only'
                    : 'Layout first, figures next'}
            </span>
          </div>
          {displayPreview?.attachments?.length ? (
            <div className="flex flex-wrap items-center gap-1">
              {livePreviewLoading ? (
                <span className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] text-stone-500">
                  <Loader2 size={9} className="animate-spin" />
                  Loading
                </span>
              ) : livePreview ? (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                  Live
                </span>
              ) : livePreviewError ? (
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                  Layout
                </span>
              ) : null}
              {displayPreview.attachments.map((file) => (
                <span
                  key={file}
                  className="max-w-[9rem] truncate rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] text-stone-500"
                  title={file}
                >
                  {file}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {livePreview?.gmailClipWarning ? (
          <div className="border-b border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-900">
            <p>{livePreview.gmailClipWarning}</p>
            {livePreview.keyAccountRowsTotal != null &&
            livePreview.keyAccountRowsInBody != null &&
            livePreview.keyAccountRowsInBody < livePreview.keyAccountRowsTotal ? (
              <p className="mt-0.5 text-amber-700">
                Key accounts in body: {livePreview.keyAccountRowsInBody} of{' '}
                {livePreview.keyAccountRowsTotal} — full list in Excel.
              </p>
            ) : null}
          </div>
        ) : null}
        {livePreviewError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
            Could not load live figures: {livePreviewError}
          </div>
        ) : null}

        <div className="bg-stone-100">
          {previewWarning ? (
            <div className="p-3 text-[12px] text-amber-700">{previewWarning}</div>
          ) : displayPreview?.html ? (
            <iframe
              ref={previewIframeRef}
              title="MIS email layout preview"
              srcDoc={displayPreview.html}
              onLoad={resizePreviewIframe}
              scrolling="no"
              style={{ height: previewIframeHeight, minHeight: 200 }}
              className="block w-full border-0 bg-white"
              sandbox="allow-same-origin"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
