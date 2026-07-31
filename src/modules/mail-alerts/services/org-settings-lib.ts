import { prisma } from '@/lib/db/prisma';
import { normalizeAllowedEmailDomains } from '@/lib/mail/allowed-domains';

const DEFAULT_MIS_EMAIL_TO_EMAILS = [
  'samiran.m@westernequipments.com',
  'vijesh.mittal@westernequipments.com',
  'lalitkumar.k@westernequipments.com',
  'rajendra.pednekar@westernequipments.com',
  'bswaminathan@westernequipments.com',
  'pulla.janardhana@westernequipments.com',
  'ganesh.rao@westernequipments.com',
  'subramanaya.hm@westernequipments.com',
  'rama.k@westernequipments.com',
  'sanjay.rawat@westernequipments.com',
  'rckaushik@westernequipments.com',
  'kaushik.das@westernequipments.com',
];

const DEFAULT_MIS_EMAIL_CC_EMAILS = [
  'laxmikant.bhutada@westernequipments.com',
  'parmeet@westernequipments.com',
  'harmeet@westernequipments.com',
  'mvrushali@westernequipments.com',
  'dipti.p@westernequipments.com',
  'mis.service@westernequipments.com',
  'vishnu.vishwakarma@westernequipments.com',
  'uday.kavishwar@westernequipments.com',
];

const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['westernequipments.com'] as const;
const MIS_EMAIL_ORG_SETTINGS_KEY = 'mis_email';
const CACHE_TTL_MS = 15_000;
const TIME_HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type MisEmailDateRangeMode = 'yesterday' | 'month_to_date' | 'year_to_yesterday';

export type MisEmailOrgSettings = {
  defaultToEmails: string[];
  defaultCcEmails: string[];
  defaultSendTimeIst: string;
  defaultDateRange: MisEmailDateRangeMode;
  subjectTemplate: string;
  greeting: string;
  brandTitle: string;
  brandSubtitle: string;
  portalBaseUrl: string;
  digestCallType: string;
  allowedEmailDomains: string[];
  outboundMailEnabled: boolean;
  majorRepairMinCount: number;
  majorRepairMonths: number;
  majorRepairDefaultTo: string;
  majorRepairDefaultCc: string;
};

export const MIS_EMAIL_ORG_SETTINGS_FALLBACKS: MisEmailOrgSettings = {
  defaultToEmails: [...DEFAULT_MIS_EMAIL_TO_EMAILS],
  defaultCcEmails: [...DEFAULT_MIS_EMAIL_CC_EMAILS],
  defaultSendTimeIst: '09:30',
  defaultDateRange: 'month_to_date',
  subjectTemplate: 'Daily MIS Report as on {asOn}',
  greeting: 'Dear Zonal Heads,',
  brandTitle: 'WESTERN REFRIGERATION',
  brandSubtitle: 'WRL Dashboard (Revised)',
  portalBaseUrl: 'https://wrl-dashboard.vercel.app',
  digestCallType: 'BREAKDOWN',
  allowedEmailDomains: [...DEFAULT_ALLOWED_EMAIL_DOMAINS],
  outboundMailEnabled: true,
  majorRepairMinCount: 3,
  majorRepairMonths: 3,
  majorRepairDefaultTo: 'sunil.sawant@westernequipments.com',
  majorRepairDefaultCc: 'vishnu.vishwakarma@westernequipments.com',
};

type OrgSettingsRow = { value: unknown };

let ensured = false;
let cache: { at: number; settings: MisEmailOrgSettings } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

function normalizeMisEmailSendTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return TIME_HH_MM_RE.test(value) ? value : null;
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

export function clearMisEmailOrgSettingsCache(): void {
  cache = null;
}

export function mergeMisEmailOrgSettings(raw: unknown): MisEmailOrgSettings {
  const base = MIS_EMAIL_ORG_SETTINGS_FALLBACKS;
  if (!isRecord(raw)) {
    return {
      ...base,
      defaultToEmails: [...base.defaultToEmails],
      defaultCcEmails: [...base.defaultCcEmails],
      allowedEmailDomains: [...base.allowedEmailDomains],
    };
  }

  return {
    defaultToEmails: Array.isArray(raw.defaultToEmails)
      ? normalizeEmailList(raw.defaultToEmails)
      : [...base.defaultToEmails],
    defaultCcEmails: Array.isArray(raw.defaultCcEmails)
      ? normalizeEmailList(raw.defaultCcEmails)
      : [...base.defaultCcEmails],
    defaultSendTimeIst:
      normalizeMisEmailSendTime(raw.defaultSendTimeIst) ?? base.defaultSendTimeIst,
    defaultDateRange: parseDateRange(raw.defaultDateRange) ?? base.defaultDateRange,
    subjectTemplate:
      typeof raw.subjectTemplate === 'string' && raw.subjectTemplate.trim()
        ? raw.subjectTemplate.trim()
        : base.subjectTemplate,
    greeting:
      typeof raw.greeting === 'string' && raw.greeting.trim() ? raw.greeting.trim() : base.greeting,
    brandTitle:
      typeof raw.brandTitle === 'string' && raw.brandTitle.trim()
        ? raw.brandTitle.trim()
        : base.brandTitle,
    brandSubtitle:
      typeof raw.brandSubtitle === 'string' && raw.brandSubtitle.trim()
        ? raw.brandSubtitle.trim()
        : base.brandSubtitle,
    portalBaseUrl:
      typeof raw.portalBaseUrl === 'string' && raw.portalBaseUrl.trim()
        ? raw.portalBaseUrl.trim().replace(/\/$/, '')
        : base.portalBaseUrl,
    digestCallType:
      typeof raw.digestCallType === 'string' && raw.digestCallType.trim()
        ? raw.digestCallType.trim().toUpperCase()
        : base.digestCallType,
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
  };
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

export async function getMisEmailOrgSettings(): Promise<MisEmailOrgSettings> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.settings;

  try {
    await ensureAppOrgSettingsTable();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT value FROM public.app_org_settings WHERE key = $1 LIMIT 1`,
      MIS_EMAIL_ORG_SETTINGS_KEY
    )) as OrgSettingsRow[];
    const settings = mergeMisEmailOrgSettings(rows[0]?.value);
    cache = { at: now, settings };
    return settings;
  } catch {
    const settings = mergeMisEmailOrgSettings(null);
    cache = { at: now, settings };
    return settings;
  }
}

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
