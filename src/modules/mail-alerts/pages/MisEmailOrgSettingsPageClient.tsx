'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { Mail, Save } from 'lucide-react';
import { PageShell } from '@/components/layout/PageShell';
import { feedback } from '@/lib/ui/feedback';
import { SettingsField, settingsInputClass } from '@/components/admin/AdminUi';
import type { MisEmailOrgSettings } from '@/modules/mail-alerts/services/org-settings-defaults';
import type { MisEmailDateRangeMode } from '@/modules/mail-alerts/services/preferences';
import type { MisEmailUserScheduleRow } from '@/modules/mail-alerts/services/list-user-schedules';
import {
  DomainChipsInput,
  EmailChipsInput,
} from '@/modules/mail-alerts/components/TagChipsInput';
import {
  MAIL_ALERTS_CONTENT,
  MAIL_ALERTS_PANEL,
  MAIL_ALERTS_PRIMARY_BTN,
} from '@/modules/mail-alerts/components/mail-alerts-ui';

const API_URL = '/api/admin/mis-email-org-settings';
const PERSONAL_API_URL = '/api/admin/mis-email-user-prefs';
const inputClass = settingsInputClass();
const textareaClass = `${inputClass} h-auto min-h-[4.5rem] py-2 leading-relaxed`;

type SectionId =
  | 'outbound'
  | 'domains'
  | 'defaults'
  | 'digest'
  | 'watchdog'
  | 'majorRepair'
  | 'personal';

type MailTone = 'digest' | 'watchdog';

const MAIL_TONE: Record<
  MailTone,
  {
    chip: string;
    chipLabel: string;
    card: string;
    header: string;
    title: string;
    bodyBox: string;
    navActive: string;
    navDot: string;
  }
> = {
  digest: {
    chipLabel: 'Digest',
    chip: 'bg-sky-700 text-white',
    card: 'border-sky-200',
    header: 'border-sky-100 bg-sky-50/80',
    title: 'text-sky-950',
    bodyBox: 'border-sky-100 bg-sky-50/40',
    navActive: 'border-sky-300 bg-sky-50 text-sky-950',
    navDot: 'bg-sky-600',
  },
  watchdog: {
    chipLabel: 'Ops alert',
    chip: 'bg-amber-700 text-white',
    card: 'border-amber-200',
    header: 'border-amber-100 bg-amber-50/90',
    title: 'text-amber-950',
    bodyBox: 'border-amber-100 bg-amber-50/40',
    navActive: 'border-amber-300 bg-amber-50 text-amber-950',
    navDot: 'bg-amber-600',
  },
};

const SECTIONS: {
  id: SectionId;
  label: string;
  hint: string;
  tone?: MailTone;
}[] = [
  { id: 'outbound', label: 'Outbound mail', hint: 'Kill switch' },
  { id: 'domains', label: 'Domain allowlist', hint: 'Allowed domains' },
  { id: 'defaults', label: 'Default recipients', hint: 'Seed for new users' },
  { id: 'digest', label: 'Daily MIS digest', hint: 'Org letter copy', tone: 'digest' },
  { id: 'watchdog', label: 'Morning watchdog', hint: 'Ops alert copy', tone: 'watchdog' },
  { id: 'personal', label: 'Personal digests', hint: 'Emergency user edit' },
  { id: 'majorRepair', label: 'Major repair alerts', hint: 'HQ defaults' },
];

function PanelShell({
  title,
  description,
  tone,
  children,
  columns = false,
}: {
  title: string;
  description: string;
  tone?: MailTone;
  children: ReactNode;
  columns?: boolean;
}) {
  const t = tone ? MAIL_TONE[tone] : null;
  return (
    <section
      className={`overflow-hidden rounded-lg border bg-bg-canvas ${
        t ? t.card : 'border-slate-200'
      }`}
    >
      <div className={`border-b px-4 py-3 ${t ? t.header : 'border-slate-100 bg-bg-soft/50'}`}>
        <div className="flex items-start gap-3">
          {t ? (
            <span
              className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.chip}`}
            >
              {t.chipLabel}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className={`ui-section-title ${t ? t.title : ''}`}>{title}</h2>
            <p className="mt-0.5 ui-help text-slate-600">{description}</p>
          </div>
        </div>
      </div>
      <div className={columns ? 'grid gap-4 p-4 md:grid-cols-2' : 'space-y-4 p-4'}>
        {children}
      </div>
    </section>
  );
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

type PersonalDraft = {
  misEmailEnabled: boolean;
  subscribed: boolean;
  sendTimeIst: string;
  dateRange: MisEmailDateRangeMode;
  toEmails: string[];
  ccEmails: string[];
};

function draftFromUser(u: MisEmailUserScheduleRow): PersonalDraft {
  return {
    misEmailEnabled: u.misEmailEnabled,
    subscribed: u.subscribed,
    sendTimeIst: u.sendTimeIst,
    dateRange: u.dateRange,
    toEmails: [...u.toEmails],
    ccEmails: [...u.ccEmails],
  };
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
  const [activeSection, setActiveSection] = useState<SectionId>('digest');

  const [personalUsers, setPersonalUsers] = useState<MisEmailUserScheduleRow[]>([]);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [personalDraft, setPersonalDraft] = useState<PersonalDraft | null>(null);
  const [personalBaseline, setPersonalBaseline] = useState<PersonalDraft | null>(null);
  const [personalSaving, setPersonalSaving] = useState(false);

  const dirty = useMemo(() => {
    if (!settings || !baseline) return false;
    return (
      settings.outboundMailEnabled !== baseline.outboundMailEnabled ||
      settings.defaultSendTimeIst !== baseline.defaultSendTimeIst ||
      settings.defaultDateRange !== baseline.defaultDateRange ||
      settings.subjectTemplate !== baseline.subjectTemplate ||
      settings.subjectTemplateRevised !== baseline.subjectTemplateRevised ||
      settings.greeting !== baseline.greeting ||
      settings.brandTitle !== baseline.brandTitle ||
      settings.brandSubtitle !== baseline.brandSubtitle ||
      settings.portalBaseUrl !== baseline.portalBaseUrl ||
      settings.digestCallType !== baseline.digestCallType ||
      settings.introTextNormal !== baseline.introTextNormal ||
      settings.introTextRevised !== baseline.introTextRevised ||
      settings.watchdogToEmail !== baseline.watchdogToEmail ||
      settings.watchdogSubjectTemplate !== baseline.watchdogSubjectTemplate ||
      settings.watchdogBodyTemplate !== baseline.watchdogBodyTemplate ||
      settings.majorRepairMinCount !== baseline.majorRepairMinCount ||
      settings.majorRepairMonths !== baseline.majorRepairMonths ||
      settings.majorRepairDefaultTo !== baseline.majorRepairDefaultTo ||
      settings.majorRepairDefaultCc !== baseline.majorRepairDefaultCc ||
      !listsEqual(settings.defaultToEmails, baseline.defaultToEmails) ||
      !listsEqual(settings.defaultCcEmails, baseline.defaultCcEmails) ||
      !listsEqual(settings.allowedEmailDomains, baseline.allowedEmailDomains)
    );
  }, [settings, baseline]);

  const personalDirty = useMemo(() => {
    if (!personalDraft || !personalBaseline) return false;
    return (
      personalDraft.misEmailEnabled !== personalBaseline.misEmailEnabled ||
      personalDraft.subscribed !== personalBaseline.subscribed ||
      personalDraft.sendTimeIst !== personalBaseline.sendTimeIst ||
      personalDraft.dateRange !== personalBaseline.dateRange ||
      !listsEqual(personalDraft.toEmails, personalBaseline.toEmails) ||
      !listsEqual(personalDraft.ccEmails, personalBaseline.ccEmails)
    );
  }, [personalDraft, personalBaseline]);

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

  const loadPersonalUsers = useCallback(async () => {
    setPersonalLoading(true);
    try {
      const res = await axios.get(PERSONAL_API_URL, { withCredentials: true });
      const users = (res.data.users as MisEmailUserScheduleRow[]) ?? [];
      setPersonalUsers(users);
      setSelectedUserId((prev) => {
        if (prev && users.some((u) => u.id === prev)) return prev;
        return users[0]?.id ?? '';
      });
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to load personal digests';
      feedback.actionFailed(message);
    } finally {
      setPersonalLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeSection === 'personal') void loadPersonalUsers();
  }, [activeSection, loadPersonalUsers]);

  useEffect(() => {
    const user = personalUsers.find((u) => u.id === selectedUserId);
    if (!user) {
      setPersonalDraft(null);
      setPersonalBaseline(null);
      return;
    }
    const draft = draftFromUser(user);
    setPersonalDraft(draft);
    setPersonalBaseline(draft);
  }, [selectedUserId, personalUsers]);

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

  const savePersonal = async () => {
    if (!selectedUserId || !personalDraft) return;
    setPersonalSaving(true);
    try {
      const res = await axios.patch(
        PERSONAL_API_URL,
        {
          userId: selectedUserId,
          patch: {
            misEmailEnabled: personalDraft.misEmailEnabled,
            subscribed: personalDraft.subscribed,
            sendTimeIst: personalDraft.sendTimeIst,
            dateRange: personalDraft.dateRange,
            toEmails: personalDraft.toEmails,
            ccEmails: personalDraft.ccEmails,
          },
        },
        { withCredentials: true }
      );
      const user = res.data.user as MisEmailUserScheduleRow;
      setPersonalUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      const draft = draftFromUser(user);
      setPersonalDraft(draft);
      setPersonalBaseline(draft);
      feedback.actionSuccess(`Updated personal digest for ${user.email}`);
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : 'Failed to update personal digest';
      feedback.actionFailed(message);
    } finally {
      setPersonalSaving(false);
    }
  };

  const update = <K extends keyof MisEmailOrgSettings>(key: K, value: MisEmailOrgSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updatePersonal = <K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => {
    setPersonalDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
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

  const nav = (
    <nav
      aria-label="Org settings sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-bg-canvas p-2 lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-l lg:p-3"
    >
      {SECTIONS.map((section) => {
        const active = activeSection === section.id;
        const tone = section.tone ? MAIL_TONE[section.tone] : null;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            className={`flex min-w-[9.5rem] shrink-0 items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors lg:min-w-0 lg:w-full ${
              active
                ? tone
                  ? tone.navActive
                  : 'border-slate-300 bg-slate-100 text-slate-900'
                : 'border-transparent text-slate-600 hover:bg-bg-soft hover:text-slate-900'
            }`}
          >
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                active ? (tone ? tone.navDot : 'bg-slate-700') : 'bg-slate-300'
              }`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold leading-snug">{section.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                {section.hint}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );

  let panel: ReactNode = null;
  if (loading || !settings) {
    panel = (
      <section className="ui-body rounded-lg border border-slate-200 bg-bg-canvas p-6 text-slate-500">
        Loading settings…
      </section>
    );
  } else if (activeSection === 'outbound') {
    panel = (
      <section
        className={`flex flex-col gap-3 rounded-lg border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
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
    );
  } else if (activeSection === 'domains') {
    panel = (
      <PanelShell
        title="Domain allowlist"
        description="Only these domains can be used in Profile To/Cc, routing rules, and major-repair recipients."
      >
        <DomainChipsInput
          label="Allowed domains"
          values={settings.allowedEmailDomains}
          onChange={(allowedEmailDomains) => update('allowedEmailDomains', allowedEmailDomains)}
        />
      </PanelShell>
    );
  } else if (activeSection === 'defaults') {
    panel = (
      <PanelShell
        title="Default recipients & schedule seed"
        description="Templates applied only when an admin first enables MIS email for a user. Changing these does not update existing user prefs. VPS runner polls every 15 minutes; each user sends at their own Profile send time (IST)."
        columns
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
              update('defaultDateRange', e.target.value as MisEmailOrgSettings['defaultDateRange'])
            }
          >
            <option value="yesterday">Yesterday</option>
            <option value="month_to_date">Month to yesterday</option>
            <option value="year_to_yesterday">Year to yesterday</option>
          </select>
        </SettingsField>
      </PanelShell>
    );
  } else if (activeSection === 'digest') {
    panel = (
      <PanelShell
        tone="digest"
        title="Daily MIS digest"
        description="Org letter around the auto-generated tables. Subject, greeting, and opening paragraph apply to all digests."
      >
        <div className={`space-y-3 rounded-md border p-3 ${MAIL_TONE.digest.bodyBox}`}>
          <p className="ui-field-label text-sky-900">Email subject</p>
          <p className="ui-help text-slate-500">
            Use <code className="text-[11px]">{'{asOn}'}</code> for the report date (DD-MM-YYYY).
            Normal and revised each have their own full subject — nothing is auto-appended.
          </p>
          <SettingsField label="Normal send">
            <input
              className={inputClass}
              value={settings.subjectTemplate}
              onChange={(e) => update('subjectTemplate', e.target.value)}
              placeholder="Daily MIS Report as on {asOn}"
            />
          </SettingsField>
          <SettingsField label="Revised send">
            <input
              className={inputClass}
              value={settings.subjectTemplateRevised}
              onChange={(e) => update('subjectTemplateRevised', e.target.value)}
              placeholder="Daily MIS Report as on {asOn} (Revised)"
            />
          </SettingsField>
        </div>

        <SettingsField label="Greeting">
          <input
            className={inputClass}
            value={settings.greeting}
            onChange={(e) => update('greeting', e.target.value)}
            placeholder="Dear Zonal Heads,"
          />
        </SettingsField>

        <div className={`space-y-3 rounded-md border p-3 ${MAIL_TONE.digest.bodyBox}`}>
          <p className="ui-field-label text-sky-900">Email body (opening paragraph)</p>
          <p className="ui-help text-slate-500">
            Shown under the greeting, before the MIS tables.
          </p>
          <SettingsField label="Normal send">
            <textarea
              className={textareaClass}
              rows={3}
              value={settings.introTextNormal}
              onChange={(e) => update('introTextNormal', e.target.value)}
            />
          </SettingsField>
          <SettingsField label="Revised send">
            <textarea
              className={textareaClass}
              rows={3}
              value={settings.introTextRevised}
              onChange={(e) => update('introTextRevised', e.target.value)}
            />
          </SettingsField>
        </div>

        <div className="grid gap-4 border-t border-sky-100 pt-4 md:grid-cols-2">
          <SettingsField label="Brand title (header)">
            <input
              className={inputClass}
              value={settings.brandTitle}
              onChange={(e) => update('brandTitle', e.target.value)}
            />
          </SettingsField>
          <SettingsField label="Brand subtitle (header)">
            <input
              className={inputClass}
              value={settings.brandSubtitle}
              onChange={(e) => update('brandSubtitle', e.target.value)}
            />
          </SettingsField>
          <SettingsField label="Digest call type filter">
            <input
              className={inputClass}
              value={settings.digestCallType}
              onChange={(e) => update('digestCallType', e.target.value)}
            />
          </SettingsField>
          <SettingsField label="Portal base URL (links in email)">
            <input
              className={inputClass}
              value={settings.portalBaseUrl}
              onChange={(e) => update('portalBaseUrl', e.target.value)}
              placeholder="https://wrl-dashboard.vercel.app"
            />
          </SettingsField>
        </div>
      </PanelShell>
    );
  } else if (activeSection === 'watchdog') {
    panel = (
      <PanelShell
        tone="watchdog"
        title="Morning watchdog alert"
        description="Internal ops notice only — not the customer digest. Sent around 09:50 IST if the morning digest did not finish. Pause under VPS Cron when you do not want these."
      >
        <SettingsField label="To">
          <input
            className={inputClass}
            type="email"
            value={settings.watchdogToEmail}
            onChange={(e) => update('watchdogToEmail', e.target.value)}
          />
        </SettingsField>
        <p className="ui-help text-slate-500">
          VPS env <code className="text-[11px]">MIS_EMAIL_WATCHDOG_TO</code> overrides this if set.
        </p>

        <SettingsField label="Email subject">
          <input
            className={inputClass}
            value={settings.watchdogSubjectTemplate}
            onChange={(e) => update('watchdogSubjectTemplate', e.target.value)}
          />
        </SettingsField>

        <div className={`rounded-md border p-3 ${MAIL_TONE.watchdog.bodyBox}`}>
          <SettingsField label="Email body">
            <textarea
              className={`${textareaClass} min-h-[14rem] font-mono text-[12px]`}
              rows={12}
              value={settings.watchdogBodyTemplate}
              onChange={(e) => update('watchdogBodyTemplate', e.target.value)}
            />
          </SettingsField>
          <p className="mt-2 ui-help text-slate-500">
            Placeholders: <code className="text-[11px]">{'{date}'}</code> (run date) and{' '}
            <code className="text-[11px]">{'{reason}'}</code> (why the check failed). Filled in when
            the alert is sent.
          </p>
        </div>
      </PanelShell>
    );
  } else if (activeSection === 'personal') {
    panel = (
      <PanelShell
        title="Personal digests (emergency)"
        description="Only this user’s schedule and recipients. Subject, greeting, and body opening are the same for everyone — edit those under Daily MIS digest."
      >
        <div className="rounded-md border border-sky-200 bg-sky-50/50 px-3 py-2 text-[13px] text-sky-950">
          <p className="ui-field-label text-sky-800">Org letter this user gets (not personal)</p>
          <p className="mt-1">
            <span className="text-slate-500">Subject (normal):</span> {settings.subjectTemplate}
          </p>
          <p className="mt-0.5">
            <span className="text-slate-500">Subject (revised):</span>{' '}
            {settings.subjectTemplateRevised}
          </p>
          <p className="mt-0.5">
            <span className="text-slate-500">Greeting:</span> {settings.greeting}
          </p>
          <p className="mt-0.5">
            <span className="text-slate-500">Body:</span> {settings.introTextNormal}
          </p>
          <button
            type="button"
            className="mt-2 text-[12px] font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950"
            onClick={() => setActiveSection('digest')}
          >
            Edit org letter in Daily MIS digest →
          </button>
        </div>

        {personalLoading ? (
          <p className="ui-help text-slate-500">Loading users…</p>
        ) : personalUsers.length === 0 ? (
          <p className="ui-help text-slate-500">No personal digest users found.</p>
        ) : (
          <>
            <SettingsField label="User">
              <select
                className={inputClass}
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                {personalUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email}
                    {!u.misEmailEnabled ? ' (disabled)' : !u.subscribed ? ' (Digest No)' : ''}
                  </option>
                ))}
              </select>
            </SettingsField>

            {personalDraft ? (
              <div className="space-y-4 rounded-md border border-rose-100 bg-rose-50/40 p-3">
                <p className="ui-help text-rose-800">
                  Emergency edit — saves only this user&apos;s personal prefs (separate from Save
                  changes for org settings).
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-[13px] text-slate-800">
                    <input
                      type="checkbox"
                      checked={personalDraft.misEmailEnabled}
                      onChange={(e) => updatePersonal('misEmailEnabled', e.target.checked)}
                    />
                    MIS email enabled (cron eligible)
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-slate-800">
                    <input
                      type="checkbox"
                      checked={personalDraft.subscribed}
                      onChange={(e) => updatePersonal('subscribed', e.target.checked)}
                    />
                    Digest Yes (subscribed)
                  </label>
                  <SettingsField label="Send time (IST)">
                    <input
                      type="time"
                      className={inputClass}
                      value={personalDraft.sendTimeIst}
                      onChange={(e) => updatePersonal('sendTimeIst', e.target.value)}
                    />
                  </SettingsField>
                  <SettingsField label="Date range">
                    <select
                      className={inputClass}
                      value={personalDraft.dateRange}
                      onChange={(e) =>
                        updatePersonal('dateRange', e.target.value as MisEmailDateRangeMode)
                      }
                    >
                      <option value="yesterday">Yesterday</option>
                      <option value="month_to_date">Month to yesterday</option>
                      <option value="year_to_yesterday">Year to yesterday</option>
                    </select>
                  </SettingsField>
                </div>
                <EmailChipsInput
                  label="To"
                  values={personalDraft.toEmails}
                  onChange={(toEmails) => updatePersonal('toEmails', toEmails)}
                />
                <EmailChipsInput
                  label="Cc"
                  values={personalDraft.ccEmails}
                  onChange={(ccEmails) => updatePersonal('ccEmails', ccEmails)}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={personalSaving || !personalDirty}
                    onClick={() => void savePersonal()}
                    className={MAIL_ALERTS_PRIMARY_BTN}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {personalSaving ? 'Saving…' : 'Save this user'}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PanelShell>
    );
  } else {
    panel = (
      <PanelShell
        title="Major repair alerts"
        description="HQ fallback recipients and thresholds when branch overlays are empty. Env vars still override if set. Alert wording is fixed in code for now."
        columns
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
      </PanelShell>
    );
  }

  const workspace = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">{panel}</div>
      {nav}
    </div>
  );

  const body = (
    <div className={embedded ? MAIL_ALERTS_PANEL : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
      {embedded ? toolbar : null}
      {!embedded ? (
        <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-bg-canvas px-4 py-2">
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
      <div className={embedded ? `${MAIL_ALERTS_CONTENT} !p-0` : 'flex min-h-0 flex-1 flex-col'}>
        {workspace}
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <PageShell
      title="Mail & Alerts settings"
      subtitle="Org-wide defaults and domain policy. Saving never sends mail."
      icon={<Mail size={16} />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
    >
      {body}
    </PageShell>
  );
}
