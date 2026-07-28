'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Mail, Save } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { feedback } from '@/lib/ui/feedback';
import { SettingsField, settingsInputClass } from '@/components/admin/AdminUi';
import type { MisEmailOrgSettings } from '@/features/mis-email/lib/org-settings-defaults';
import { formatDigestSubject } from '@/features/mis-email/lib/email-template';
import {
  DomainChipsInput,
  EmailChipsInput,
} from '@/features/mis-email/ui/TagChipsInput';
import {
  MAIL_ALERTS_CONTENT,
  MAIL_ALERTS_PANEL,
  MAIL_ALERTS_PRIMARY_BTN,
} from '@/features/mis-email/ui/mail-alerts-ui';

const API_URL = '/api/admin/mis-email-org-settings';
const inputClass = settingsInputClass();

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-bg-canvas">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="ui-section-title">{title}</h2>
        {description ? <p className="mt-0.5 ui-help">{description}</p> : null}
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export default function MisEmailOrgSettingsPageClient({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [settings, setSettings] = useState<MisEmailOrgSettings | null>(null);
  const [baseline, setBaseline] = useState<MisEmailOrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (!settings || !baseline) return false;
    return (
      settings.outboundMailEnabled !== baseline.outboundMailEnabled ||
      settings.defaultSendTimeIst !== baseline.defaultSendTimeIst ||
      settings.defaultDateRange !== baseline.defaultDateRange ||
      settings.subjectTemplate !== baseline.subjectTemplate ||
      settings.greeting !== baseline.greeting ||
      settings.brandTitle !== baseline.brandTitle ||
      settings.brandSubtitle !== baseline.brandSubtitle ||
      settings.portalBaseUrl !== baseline.portalBaseUrl ||
      settings.digestCallType !== baseline.digestCallType ||
      settings.majorRepairMinCount !== baseline.majorRepairMinCount ||
      settings.majorRepairMonths !== baseline.majorRepairMonths ||
      settings.majorRepairDefaultTo !== baseline.majorRepairDefaultTo ||
      settings.majorRepairDefaultCc !== baseline.majorRepairDefaultCc ||
      !listsEqual(settings.defaultToEmails, baseline.defaultToEmails) ||
      !listsEqual(settings.defaultCcEmails, baseline.defaultCcEmails) ||
      !listsEqual(settings.allowedEmailDomains, baseline.allowedEmailDomains)
    );
  }, [settings, baseline]);

  const subjectPreview = useMemo(() => {
    if (!settings) return '';
    const sampleEnd = new Date();
    sampleEnd.setDate(sampleEnd.getDate() - 1);
    const iso = sampleEnd.toISOString().slice(0, 10);
    return formatDigestSubject(iso, sampleEnd, settings.subjectTemplate);
  }, [settings]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_URL, { withCredentials: true });
      const next = res.data.settings as MisEmailOrgSettings;
      setSettings(next);
      setBaseline(next);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load org settings';
      feedback.actionFailed(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await axios.put(API_URL, { settings }, { withCredentials: true });
      const next = res.data.settings as MisEmailOrgSettings;
      setSettings(next);
      setBaseline(next);
      feedback.actionSuccess('Org mail settings saved (no mail sent)');
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to save';
      feedback.actionFailed(message);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof MisEmailOrgSettings>(key: K, value: MisEmailOrgSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toolbar = (
    <div className="register-filter-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="ui-help">
          Org-wide defaults and domain policy. Saving never sends mail.
          {dirty ? (
            <span className="ui-chip ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              Unsaved changes
            </span>
          ) : null}
        </p>
        <button
          type="button"
          disabled={saving || loading || !settings || !dirty}
          onClick={() => void save()}
          className={MAIL_ALERTS_PRIMARY_BTN}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );

  const body = (
    <div className={embedded ? MAIL_ALERTS_PANEL : undefined}>
      {embedded ? toolbar : null}
      <div className={embedded ? MAIL_ALERTS_CONTENT : 'mx-auto w-full max-w-5xl space-y-4 p-4'}>
        {!embedded ? (
          <div className="flex items-center justify-end gap-2">
            {dirty ? (
              <span className="ui-chip rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                Unsaved changes
              </span>
            ) : null}
            <button
              type="button"
              disabled={saving || loading || !settings || !dirty}
              onClick={() => void save()}
              className={MAIL_ALERTS_PRIMARY_BTN}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : null}
        {loading || !settings ? (
          <section className="ui-body rounded-lg border border-slate-200 bg-bg-canvas p-6 text-slate-500">
            Loading settings…
          </section>
        ) : (
          <div className="space-y-3">
            <section
              className={`flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                settings.outboundMailEnabled
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : 'border-amber-200 bg-amber-50/70'
              }`}
            >
              <div className="min-w-0">
                <p className="ui-section-title">Outbound mail</p>
                <p className="mt-0.5 ui-help text-slate-600">
                  {settings.outboundMailEnabled
                    ? 'Enabled — digests, Send now, and major-repair alerts may send when other gates pass.'
                    : 'Disabled — all outbound mail is blocked. Preview still works.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.outboundMailEnabled}
                onClick={() => update('outboundMailEnabled', !settings.outboundMailEnabled)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  settings.outboundMailEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.outboundMailEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </section>

            <Section
              title="Domain allowlist"
              description="Only these domains can be used in Profile To/Cc, routing rules, and major-repair recipients."
            >
              <div className="md:col-span-2">
                <DomainChipsInput
                  label="Allowed domains"
                  values={settings.allowedEmailDomains}
                  onChange={(allowedEmailDomains) => update('allowedEmailDomains', allowedEmailDomains)}
                />
              </div>
            </Section>

            <Section
              title="Default recipients"
              description="Applied when admin first enables MIS email for a user. Add addresses as badges — paste a list if you have many."
            >
              <EmailChipsInput
                label="Default To"
                values={settings.defaultToEmails}
                onChange={(defaultToEmails) => update('defaultToEmails', defaultToEmails)}
              />
              <EmailChipsInput
                label="Default Cc"
                values={settings.defaultCcEmails}
                onChange={(defaultCcEmails) => update('defaultCcEmails', defaultCcEmails)}
              />
              <SettingsField label="Default send time (IST)">
                <input
                  type="time"
                  className={inputClass}
                  value={settings.defaultSendTimeIst}
                  onChange={(e) => update('defaultSendTimeIst', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Default date range">
                <select
                  className={inputClass}
                  value={settings.defaultDateRange}
                  onChange={(e) =>
                    update(
                      'defaultDateRange',
                      e.target.value as MisEmailOrgSettings['defaultDateRange']
                    )
                  }
                >
                  <option value="yesterday">Yesterday</option>
                  <option value="month_to_date">Month to yesterday</option>
                  <option value="year_to_yesterday">Year to yesterday</option>
                </select>
              </SettingsField>
            </Section>

            <Section
              title="Email copy & branding"
              description="Digest subject, greeting, and HTML header. Use {asOn} for DD-MM-YYYY."
            >
              <div className="md:col-span-2 space-y-2">
                <SettingsField label="Subject template">
                  <input
                    className={inputClass}
                    value={settings.subjectTemplate}
                    onChange={(e) => update('subjectTemplate', e.target.value)}
                  />
                </SettingsField>
                <p className="ui-help rounded-md border border-slate-100 bg-bg-soft px-3 py-2 text-slate-600">
                  <span className="ui-field-label text-slate-500">Subject preview:</span>{' '}
                  <span className="ui-strong text-slate-900">{subjectPreview}</span>
                </p>
              </div>
              <SettingsField label="Greeting">
                <input
                  className={inputClass}
                  value={settings.greeting}
                  onChange={(e) => update('greeting', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Digest call type">
                <input
                  className={inputClass}
                  value={settings.digestCallType}
                  onChange={(e) => update('digestCallType', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Brand title">
                <input
                  className={inputClass}
                  value={settings.brandTitle}
                  onChange={(e) => update('brandTitle', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Brand subtitle">
                <input
                  className={inputClass}
                  value={settings.brandSubtitle}
                  onChange={(e) => update('brandSubtitle', e.target.value)}
                />
              </SettingsField>
              <div className="md:col-span-2">
                <SettingsField label="Portal base URL">
                  <input
                    className={inputClass}
                    value={settings.portalBaseUrl}
                    onChange={(e) => update('portalBaseUrl', e.target.value)}
                    placeholder="https://wrl-dashboard.vercel.app"
                  />
                </SettingsField>
              </div>
            </Section>

            <Section
              title="Major repair alerts"
              description="HQ fallback recipients and thresholds when branch overlays are empty. Env vars still override if set."
            >
              <SettingsField label="Min repeat count">
                <input
                  type="number"
                  min={2}
                  className={inputClass}
                  value={settings.majorRepairMinCount}
                  onChange={(e) => update('majorRepairMinCount', Number(e.target.value))}
                />
              </SettingsField>
              <SettingsField label="Lookback months">
                <input
                  type="number"
                  min={1}
                  className={inputClass}
                  value={settings.majorRepairMonths}
                  onChange={(e) => update('majorRepairMonths', Number(e.target.value))}
                />
              </SettingsField>
              <SettingsField label="Default To">
                <input
                  type="email"
                  className={inputClass}
                  value={settings.majorRepairDefaultTo}
                  onChange={(e) => update('majorRepairDefaultTo', e.target.value.trim().toLowerCase())}
                  placeholder="name@westernequipments.com"
                />
              </SettingsField>
              <SettingsField label="Default Cc">
                <input
                  type="email"
                  className={inputClass}
                  value={settings.majorRepairDefaultCc}
                  onChange={(e) => update('majorRepairDefaultCc', e.target.value.trim().toLowerCase())}
                  placeholder="name@westernequipments.com"
                />
              </SettingsField>
            </Section>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <PageShell
      title="Mail & Alerts settings"
      subtitle="Org-wide defaults and domain policy. Saving never sends mail."
      icon={<Mail size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-auto bg-bg-soft"
    >
      {body}
    </PageShell>
  );
}
