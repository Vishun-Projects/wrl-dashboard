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
  RefreshCw,
  Save,
  Send,
} from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';
import type { MisEmailBodySectionDef, MisEmailBodySectionId } from '@/lib/mis-email/body-sections';
import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import { settingsInputClass } from '@/components/admin/AdminUi';

type MisEmailComposeSettings = {
  primaryEmail: string;
  roleName: string | null;
  scopeLabel: string | null;
  allowed: {
    includeSummary: boolean;
    includeDetailed: boolean;
    includeKeyAccount: boolean;
  };
  availableBodySections: MisEmailBodySectionDef[];
};

type PreviewState = {
  subject: string;
  html: string;
  attachments: string[];
  scopeLabel: string;
  dateRangeLabel: string;
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

export function MisEmailComposer({ settings, prefs, onPrefsChange, onSaved }: Props) {
  const [extraEmailsInput, setExtraEmailsInput] = useState(formatExtraEmailsInput(prefs.extraEmails));
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

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

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await axios.post(
        '/api/profile/mis-email/preview',
        { preferences: draftPrefs },
        { withCredentials: true }
      );
      setPreview(res.data.preview ?? null);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Preview failed';
      setPreview(null);
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, [draftPrefs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPreview();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

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
    setSending(true);
    setSendResult(null);
    try {
      const res = await axios.post(
        '/api/profile/mis-email/send',
        {
          preferences: draftPrefs,
          sendTo: sendTargets,
          savePreferences: saveFirst,
        },
        { withCredentials: true }
      );
      const sent = (res.data.sent as Array<{ sentTo: string; attachments: string[] }> | undefined) ?? [];
      const summary = sent.map((item) => item.sentTo).join(', ');
      setSendResult(`Sent to ${summary}`);
      if (saveFirst) {
        onPrefsChange(draftPrefs);
        onSaved?.();
      }
      feedback.actionSuccess('MIS email sent');
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Send failed';
      feedback.actionFailed(message);
    } finally {
      setSending(false);
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
              onClick={() => void loadPreview()}
              disabled={previewLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || sending}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save defaults
            </button>
            <button
              type="button"
              onClick={() => void handleSend(true)}
              disabled={sending || sendTargets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
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
            <p className="text-[12px] text-slate-800">{preview?.subject ?? 'WRL MIS Reports — …'}</p>
          </div>

          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="pt-1 text-[11px] font-medium text-slate-400">Period</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'month_to_date', label: 'Month to date' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    onPrefsChange({
                      ...prefs,
                      dateRange: opt.id as MisEmailPreferences['dateRange'],
                    })
                  }
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
                  Choose tables to show inside the email. Excel attachments stay full reports.
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
                          disabled={draftPrefs.includeSummary === false}
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

          <div className="grid grid-cols-[72px_1fr] items-start gap-3 px-4 py-3">
            <span className="text-[11px] font-medium text-slate-400">Scope</span>
            <div className="text-[11px] text-slate-600">
              <p>{settings.roleName ?? 'Your role'} · {settings.scopeLabel ?? 'All branches'}</p>
              {preview ? (
                <p className="mt-1 text-slate-500">
                  Report period: {preview.dateRangeLabel} · {preview.scopeLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {sendResult ? (
          <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] text-emerald-800">
            {sendResult}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-bg-soft/70 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-800">
            <FileSpreadsheet size={14} className="text-slate-400" />
            Live preview
          </div>
          {preview?.attachments?.length ? (
            <div className="flex flex-wrap gap-1">
              {preview.attachments.map((file) => (
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
          {previewLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-canvas/60">
              <Loader2 className="animate-spin text-slate-400" size={24} />
            </div>
          ) : null}
          {previewError ? (
            <div className="p-4 text-[12px] text-red-600">{previewError}</div>
          ) : preview?.html ? (
            <iframe
              title="MIS email preview"
              srcDoc={preview.html}
              className="h-full min-h-[480px] w-full border-0 bg-white"
              sandbox=""
            />
          ) : (
            <div className="flex h-full min-h-[480px] items-center justify-center p-6 text-center text-[12px] text-slate-400">
              Adjust compose settings to preview your email.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
