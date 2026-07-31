import { prisma } from '@/lib/db/prisma';
import { normalizeAllowedEmailDomains } from '@/modules/mail-alerts/services/allowed-domains';
import { normalizeEmailList } from '@/modules/mail-alerts/services/parse-outlook-emails';
import { normalizeMisEmailSendTime } from '@/modules/mail-alerts/services/preferences';
import { resolveMisEmailBrandSubtitle } from '@/modules/mail-alerts/services/email-template';
import {
  MIS_EMAIL_ORG_SETTINGS_FALLBACKS,
  MIS_EMAIL_ORG_SETTINGS_KEY,
  type MisEmailOrgSettings,
} from '@/modules/mail-alerts/services/org-settings-defaults';

export {
  MIS_EMAIL_ORG_SETTINGS_FALLBACKS,
  MIS_EMAIL_ORG_SETTINGS_KEY,
  type MisEmailOrgSettings,
} from '@/modules/mail-alerts/services/org-settings-defaults';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDateRange(raw: unknown): MisEmailOrgSettings['defaultDateRange'] | null {
  if (raw === 'yesterday' || raw === 'month_to_date' || raw === 'year_to_yesterday') return raw;
  return null;
}

function parsePositiveInt(raw: unknown, min: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  return t >= min ? t : fallback;
}

/** Pure merge — empty/partial stored → code fallbacks. */
export function mergeMisEmailOrgSettings(raw: unknown): MisEmailOrgSettings {
  const base = MIS_EMAIL_ORG_SETTINGS_FALLBACKS;
  if (!isRecord(raw)) return { ...base, defaultToEmails: [...base.defaultToEmails], defaultCcEmails: [...base.defaultCcEmails], allowedEmailDomains: [...base.allowedEmailDomains] };

  const sendTime =
    normalizeMisEmailSendTime(raw.defaultSendTimeIst) ?? base.defaultSendTimeIst;
  const dateRange = parseDateRange(raw.defaultDateRange) ?? base.defaultDateRange;

  return {
    defaultToEmails: Array.isArray(raw.defaultToEmails)
      ? normalizeEmailList(raw.defaultToEmails)
      : [...base.defaultToEmails],
    defaultCcEmails: Array.isArray(raw.defaultCcEmails)
      ? normalizeEmailList(raw.defaultCcEmails)
      : [...base.defaultCcEmails],
    defaultSendTimeIst: sendTime,
    defaultDateRange: dateRange,
    subjectTemplate:
      typeof raw.subjectTemplate === 'string' && raw.subjectTemplate.trim()
        ? raw.subjectTemplate.trim()
        : base.subjectTemplate,
    subjectTemplateRevised:
      typeof raw.subjectTemplateRevised === 'string' && raw.subjectTemplateRevised.trim()
        ? raw.subjectTemplateRevised.trim()
        : base.subjectTemplateRevised,
    greeting:
      typeof raw.greeting === 'string' && raw.greeting.trim()
        ? raw.greeting.trim()
        : base.greeting,
    brandTitle:
      typeof raw.brandTitle === 'string' && raw.brandTitle.trim()
        ? raw.brandTitle.trim()
        : base.brandTitle,
    brandSubtitle: resolveMisEmailBrandSubtitle(
      typeof raw.brandSubtitle === 'string' && raw.brandSubtitle.trim()
        ? raw.brandSubtitle.trim()
        : base.brandSubtitle,
      'normal'
    ),
    portalBaseUrl:
      typeof raw.portalBaseUrl === 'string' && raw.portalBaseUrl.trim()
        ? raw.portalBaseUrl.trim().replace(/\/$/, '')
        : base.portalBaseUrl,
    digestCallType:
      typeof raw.digestCallType === 'string' && raw.digestCallType.trim()
        ? raw.digestCallType.trim().toUpperCase()
        : base.digestCallType,
    introTextNormal:
      typeof raw.introTextNormal === 'string' && raw.introTextNormal.trim()
        ? raw.introTextNormal.trim()
        : base.introTextNormal,
    introTextRevised:
      typeof raw.introTextRevised === 'string' && raw.introTextRevised.trim()
        ? raw.introTextRevised.trim()
        : base.introTextRevised,
    allowedEmailDomains: normalizeAllowedEmailDomains(
      raw.allowedEmailDomains ?? base.allowedEmailDomains
    ),
    outboundMailEnabled:
      typeof raw.outboundMailEnabled === 'boolean'
        ? raw.outboundMailEnabled
        : base.outboundMailEnabled,
    majorRepairMinCount: parsePositiveInt(raw.majorRepairMinCount, 2, base.majorRepairMinCount),
    majorRepairMonths: parsePositiveInt(raw.majorRepairMonths, 1, base.majorRepairMonths),
    majorRepairDefaultTo:
      typeof raw.majorRepairDefaultTo === 'string' && raw.majorRepairDefaultTo.trim()
        ? raw.majorRepairDefaultTo.trim().toLowerCase()
        : base.majorRepairDefaultTo,
    majorRepairDefaultCc:
      typeof raw.majorRepairDefaultCc === 'string' && raw.majorRepairDefaultCc.trim()
        ? raw.majorRepairDefaultCc.trim().toLowerCase()
        : base.majorRepairDefaultCc,
    watchdogToEmail:
      typeof raw.watchdogToEmail === 'string' && raw.watchdogToEmail.trim()
        ? raw.watchdogToEmail.trim().toLowerCase()
        : base.watchdogToEmail,
    watchdogSubjectTemplate:
      typeof raw.watchdogSubjectTemplate === 'string' && raw.watchdogSubjectTemplate.trim()
        ? raw.watchdogSubjectTemplate.trim()
        : base.watchdogSubjectTemplate,
    watchdogBodyTemplate:
      typeof raw.watchdogBodyTemplate === 'string' && raw.watchdogBodyTemplate.trim()
        ? raw.watchdogBodyTemplate.trim()
        : base.watchdogBodyTemplate,
  };
}

let ensured = false;
let cache: { at: number; settings: MisEmailOrgSettings; stored: boolean } | null = null;
const CACHE_TTL_MS = 15_000;

export function clearMisEmailOrgSettingsCache(): void {
  cache = null;
}

async function ensureAppOrgSettingsTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.app_org_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NULL
    )
  `);
  ensured = true;
}

type OrgSettingsRow = { value: unknown };

export async function getMisEmailOrgSettings(options?: {
  fresh?: boolean;
}): Promise<MisEmailOrgSettings> {
  const now = Date.now();
  if (!options?.fresh && cache && now - cache.at < CACHE_TTL_MS) return cache.settings;

  try {
    await ensureAppOrgSettingsTable();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT value FROM public.app_org_settings WHERE key = $1 LIMIT 1`,
      MIS_EMAIL_ORG_SETTINGS_KEY
    )) as OrgSettingsRow[];
    const stored = Boolean(rows[0]);
    const settings = mergeMisEmailOrgSettings(rows[0]?.value);
    cache = { at: now, settings, stored };
    return settings;
  } catch {
    const settings = mergeMisEmailOrgSettings(null);
    cache = { at: now, settings, stored: false };
    return settings;
  }
}

export async function saveMisEmailOrgSettings(
  patch: Partial<MisEmailOrgSettings>,
  updatedBy?: string | null
): Promise<MisEmailOrgSettings> {
  await ensureAppOrgSettingsTable();
  const current = await getMisEmailOrgSettings();
  const next = mergeMisEmailOrgSettings({ ...current, ...patch });

  if (next.defaultToEmails.length === 0) {
    throw new Error('Default To list must include at least one email');
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.app_org_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    MIS_EMAIL_ORG_SETTINGS_KEY,
    JSON.stringify(next),
    updatedBy ?? null
  );

  clearMisEmailOrgSettingsCache();
  cache = { at: Date.now(), settings: next, stored: true };
  return next;
}

/** False only when admin explicitly disabled outbound in stored settings. */
export async function isOrgOutboundMailEnabled(): Promise<boolean> {
  const settings = await getMisEmailOrgSettings();
  return settings.outboundMailEnabled !== false;
}

export class OutboundMailDisabledError extends Error {
  constructor(message = 'Outbound mail is disabled by organization settings. Ask an admin/HOD to enable it.') {
    super(message);
    this.name = 'OutboundMailDisabledError';
  }
}

export async function assertOrgOutboundMailEnabled(): Promise<void> {
  if (!(await isOrgOutboundMailEnabled())) {
    throw new OutboundMailDisabledError();
  }
}
