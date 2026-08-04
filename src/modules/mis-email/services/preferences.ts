import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import type { DigestRecipient } from '@/modules/mis-email/services/recipients';
import {
  DEFAULT_MIS_EMAIL_CC_EMAILS,
  DEFAULT_MIS_EMAIL_TO_EMAILS,
} from '@/modules/mis-email/services/default-recipients';
import { assertAllowedEmailDomains } from '@/modules/mis-email/services/allowed-domains';
import { normalizeEmailList } from '@/modules/mis-email/services/parse-outlook-emails';
import {
  parseMisEmailBodySectionIds,
  resolveDigestBodySections,
  resolveEffectiveBodySections,
  type MisEmailBodySectionId,
} from '@/modules/mis-email/services/body-sections';
import {
  DEFAULT_MIS_EMAIL_BODY_LAYOUT,
  parseMisEmailBodyLayout,
  resolveMisEmailBodyLayout,
  type MisEmailBodyLayout,
} from '@/modules/mis-email/services/email-body-layout';
import { DEFAULT_ALLOWED_EMAIL_DOMAINS } from '@/modules/mis-email/services/org-settings-defaults';

export type { MisEmailBodyLayout } from '@/modules/mis-email/services/email-body-layout';

export type MisEmailDateRangeMode = 'yesterday' | 'month_to_date' | 'year_to_yesterday';
export type MisEmailZoneKey = 'NORTH' | 'EAST' | 'WEST' | 'SOUTH';
export type MisEmailKeyAccountsByZone = Partial<Record<MisEmailZoneKey, string[]>>;

export type MisEmailPreferences = {
  subscribed?: boolean;
  /** Daily digest send time in IST, HH:mm (24-hour). */
  sendTimeIst?: string;
  dateRange?: MisEmailDateRangeMode;
  includeSummary?: boolean;
  includeDetailed?: boolean;
  includeKeyAccount?: boolean;
  /** Summary dashboard traceable export (row detail + reconciliation). */
  includeTraceableExport?: boolean;
  /** Open calls export (open + assigned only) in trace row-detail format. */
  includeOpenCallsExport?: boolean;
  /** Additional inboxes that receive the same daily digest (e.g. work + personal). */
  extraEmails?: string[];
  /** Primary To recipients for profile / manual compose. */
  toEmails?: string[];
  /** Cc recipients for profile / manual compose. */
  ccEmails?: string[];
  /** Summary report sections rendered inline in the email body (full Excel still attached). */
  bodyInEmail?: MisEmailBodySectionId[];
  /** Key account names to show in the email body when key_account_performance is enabled. */
  keyAccountsInBody?: string[];
  /** Optional per-zone account picks for key_account_performance body section. */
  keyAccountsByZone?: MisEmailKeyAccountsByZone;
  /** How body tables are arranged (stacked default, or custom grid). */
  bodyLayout?: MisEmailBodyLayout;
};

export const DEFAULT_MIS_EMAIL_PREFERENCES: Required<MisEmailPreferences> = {
  subscribed: true,
  sendTimeIst: '09:30',
  dateRange: 'month_to_date',
  includeSummary: true,
  includeDetailed: true,
  includeKeyAccount: true,
  includeTraceableExport: false,
  includeOpenCallsExport: false,
  extraEmails: [],
  toEmails: [...DEFAULT_MIS_EMAIL_TO_EMAILS],
  ccEmails: [...DEFAULT_MIS_EMAIL_CC_EMAILS],
  bodyInEmail: [],
  keyAccountsInBody: [],
  keyAccountsByZone: {},
  bodyLayout: { mode: 'stacked' },
};

export type MisEmailBodyPermissions = {
  includeSummary: boolean;
  includeKeyAccount: boolean;
};

export type EffectiveDigestIncludes = {
  includeSummary: boolean;
  includeDetailed: boolean;
  includeKeyAccount: boolean;
  includeTraceableExport: boolean;
  includeOpenCallsExport: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TIME_HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeMisEmailSendTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return TIME_HH_MM_RE.test(value) ? value : null;
}

export function resolveMisEmailSendTimeIst(prefs: MisEmailPreferences): string {
  return normalizeMisEmailSendTime(prefs.sendTimeIst) ?? DEFAULT_MIS_EMAIL_PREFERENCES.sendTimeIst;
}

export function misEmailTimeToMinutes(sendTimeIst: string): number {
  const normalized = normalizeMisEmailSendTime(sendTimeIst);
  const value = normalized ?? DEFAULT_MIS_EMAIL_PREFERENCES.sendTimeIst;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function getCurrentIstMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Calendar YYYY-MM-DD in Asia/Kolkata. */
export function formatIstDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

/** Yesterday's calendar date in IST (digest data never includes "today"). */
export function istYesterdayDateString(date = new Date()): string {
  return addCalendarDaysIso(formatIstDate(date), -1);
}

function formatIstDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  return utc.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function shouldSendMisEmailNow(
  prefs: MisEmailPreferences,
  options?: { now?: Date; windowMinutes?: number }
): boolean {
  const nowMinutes = getCurrentIstMinutes(options?.now);
  const targetMinutes = misEmailTimeToMinutes(resolveMisEmailSendTimeIst(prefs));
  const windowMinutes = Math.max(1, Math.floor(options?.windowMinutes ?? 15));
  // Half-open window [anchor, anchor+window): with */15 cron, 09:30 matches and 09:45 does not.
  return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + windowMinutes;
}

export function parseMisEmailPreferences(raw: unknown): MisEmailPreferences {
  if (!isRecord(raw)) return {};
  const prefs: MisEmailPreferences = {};

  if (typeof raw.subscribed === 'boolean') prefs.subscribed = raw.subscribed;
  const sendTimeIst = normalizeMisEmailSendTime(raw.sendTimeIst);
  if (sendTimeIst) prefs.sendTimeIst = sendTimeIst;
  if (
    raw.dateRange === 'yesterday' ||
    raw.dateRange === 'month_to_date' ||
    raw.dateRange === 'year_to_yesterday'
  ) {
    prefs.dateRange = raw.dateRange;
  }
  if (typeof raw.includeSummary === 'boolean') prefs.includeSummary = raw.includeSummary;
  if (typeof raw.includeDetailed === 'boolean') prefs.includeDetailed = raw.includeDetailed;
  if (typeof raw.includeKeyAccount === 'boolean') prefs.includeKeyAccount = raw.includeKeyAccount;
  if (typeof raw.includeTraceableExport === 'boolean') {
    prefs.includeTraceableExport = raw.includeTraceableExport;
  }
  if (typeof raw.includeOpenCallsExport === 'boolean') {
    prefs.includeOpenCallsExport = raw.includeOpenCallsExport;
  }
  if (Array.isArray(raw.extraEmails)) {
    prefs.extraEmails = normalizeEmailList(raw.extraEmails);
  }
  if (Array.isArray(raw.toEmails)) {
    prefs.toEmails = normalizeEmailList(raw.toEmails);
  }
  if (Array.isArray(raw.ccEmails)) {
    prefs.ccEmails = normalizeEmailList(raw.ccEmails);
  }
  // Migrate legacy extraEmails → toEmails when toEmails was never saved.
  if (!Array.isArray(raw.toEmails) && (prefs.extraEmails?.length ?? 0) > 0) {
    prefs.toEmails = [...(prefs.extraEmails ?? [])];
  }
  if (Array.isArray(raw.bodyInEmail)) {
    prefs.bodyInEmail = parseMisEmailBodySectionIds(raw.bodyInEmail);
  }
  if (Array.isArray(raw.keyAccountsInBody)) {
    prefs.keyAccountsInBody = parseMisEmailKeyAccountsInBody(raw.keyAccountsInBody);
  }
  if (isRecord(raw.keyAccountsByZone)) {
    prefs.keyAccountsByZone = parseMisEmailKeyAccountsByZone(raw.keyAccountsByZone);
  }
  const bodyLayout = parseMisEmailBodyLayout(raw.bodyLayout);
  if (bodyLayout) prefs.bodyLayout = bodyLayout;

  return prefs;
}

export function resolveMisEmailBodyLayoutFromPrefs(
  prefs: MisEmailPreferences
): MisEmailBodyLayout {
  return resolveMisEmailBodyLayout(prefs.bodyLayout ?? DEFAULT_MIS_EMAIL_BODY_LAYOUT);
}

export function parseMisEmailKeyAccountsInBody(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

const MIS_EMAIL_ZONE_KEYS: MisEmailZoneKey[] = ['NORTH', 'EAST', 'WEST', 'SOUTH'];

export function parseMisEmailKeyAccountsByZone(raw: unknown): MisEmailKeyAccountsByZone {
  if (!isRecord(raw)) return {};
  const result: MisEmailKeyAccountsByZone = {};
  for (const zone of MIS_EMAIL_ZONE_KEYS) {
    result[zone] = parseMisEmailKeyAccountsInBody(raw[zone]);
  }
  return result;
}

export function resolveExtraDigestEmails(
  prefs: MisEmailPreferences,
  primaryEmail: string
): string[] {
  const primary = primaryEmail.trim().toLowerCase();
  const seen = new Set<string>(primary ? [primary] : []);
  const extras: string[] = [];
  for (const raw of prefs.extraEmails ?? []) {
    const email = raw.trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    extras.push(email);
  }
  return extras;
}

/** To list for profile compose: explicit toEmails, else defaults (not primary+extras). */
export function resolveMisEmailToEmails(prefs: MisEmailPreferences): string[] {
  if (prefs.toEmails !== undefined) {
    return normalizeEmailList(prefs.toEmails);
  }
  if ((prefs.extraEmails?.length ?? 0) > 0) {
    return normalizeEmailList(prefs.extraEmails);
  }
  return [...DEFAULT_MIS_EMAIL_TO_EMAILS];
}

export function resolveMisEmailCcEmails(prefs: MisEmailPreferences): string[] {
  if (prefs.ccEmails !== undefined) {
    return normalizeEmailList(prefs.ccEmails);
  }
  return [...DEFAULT_MIS_EMAIL_CC_EMAILS];
}

/**
 * Automated personal digest recipients — only Profile To/Cc the user chose.
 * Never falls back to org default To/Cc (those are for compose seeding / HOD routing).
 */
export function resolvePersonalDigestTargets(
  prefs: MisEmailPreferences,
  accountEmail: string
): { to: string[]; cc: string[] } {
  const self = accountEmail.trim().toLowerCase();
  let to: string[];
  if (prefs.toEmails !== undefined) {
    to = normalizeEmailList(prefs.toEmails);
  } else if ((prefs.extraEmails?.length ?? 0) > 0) {
    to = normalizeEmailList(prefs.extraEmails ?? []);
  } else {
    to = self ? [self] : [];
  }
  const toSet = new Set(to);
  const cc =
    prefs.ccEmails !== undefined
      ? normalizeEmailList(prefs.ccEmails).filter((email) => !toSet.has(email))
      : [];
  return { to, cc };
}

export function mergeMisEmailPreferences(
  stored: unknown,
  patch?: MisEmailPreferences
): MisEmailPreferences {
  return { ...parseMisEmailPreferences(stored), ...patch };
}

/** Defaults when admin first enables MIS email for a user. */
export function defaultPreferencesForRecipient(
  recipient: Pick<DigestRecipient, 'includeSummary' | 'includeDetailed' | 'includeKeyAccount'>,
  orgDefaults?: {
    toEmails?: string[];
    ccEmails?: string[];
    sendTimeIst?: string;
    dateRange?: MisEmailDateRangeMode;
  }
): MisEmailPreferences {
  const bodyInEmail: MisEmailBodySectionId[] = [];
  if (recipient.includeSummary) {
    bodyInEmail.push('regional_performance', 'branch_performance');
  }
  if (recipient.includeKeyAccount) {
    bodyInEmail.push('key_account_performance');
  }

  return {
    subscribed: true,
    sendTimeIst: orgDefaults?.sendTimeIst ?? DEFAULT_MIS_EMAIL_PREFERENCES.sendTimeIst,
    dateRange: orgDefaults?.dateRange ?? 'month_to_date',
    includeSummary: recipient.includeSummary,
    includeDetailed: recipient.includeDetailed,
    includeKeyAccount: recipient.includeKeyAccount,
    includeOpenCallsExport: false,
    toEmails: [...(orgDefaults?.toEmails ?? DEFAULT_MIS_EMAIL_TO_EMAILS)],
    ccEmails: [...(orgDefaults?.ccEmails ?? DEFAULT_MIS_EMAIL_CC_EMAILS)],
    bodyInEmail,
    keyAccountsInBody: [],
    keyAccountsByZone: {},
  };
}

export function isMisEmailSubscribed(prefs: MisEmailPreferences): boolean {
  return prefs.subscribed !== false;
}

export function resolveEffectiveDigestIncludes(
  recipient: Pick<
    DigestRecipient,
    'includeSummary' | 'includeDetailed' | 'includeKeyAccount'
  >,
  prefs: MisEmailPreferences
): EffectiveDigestIncludes {
  const merged = { ...DEFAULT_MIS_EMAIL_PREFERENCES, ...prefs };

  return {
    includeSummary: recipient.includeSummary && merged.includeSummary,
    includeDetailed: recipient.includeDetailed && merged.includeDetailed,
    includeKeyAccount: recipient.includeKeyAccount && merged.includeKeyAccount,
    includeTraceableExport:
      recipient.includeSummary && merged.includeTraceableExport,
    includeOpenCallsExport:
      recipient.includeSummary && merged.includeOpenCallsExport,
  };
}

export function hasAnyEffectiveDigestInclude(includes: EffectiveDigestIncludes): boolean {
  return (
    includes.includeSummary ||
    includes.includeDetailed ||
    includes.includeKeyAccount ||
    includes.includeTraceableExport ||
    includes.includeOpenCallsExport
  );
}

export function resolveDigestDateRangeForPreferences(
  prefs: MisEmailPreferences
): DigestDateRange {
  const mode = prefs.dateRange ?? DEFAULT_MIS_EMAIL_PREFERENCES.dateRange;
  const endDate = istYesterdayDateString();
  const endLabel = formatIstDayLabel(endDate);

  if (mode === 'yesterday') {
    return {
      startDate: endDate,
      endDate,
      label: `Yesterday (${endLabel})`,
    };
  }

  if (mode === 'year_to_yesterday') {
    const startDate = `${endDate.slice(0, 4)}-01-01`;
    return {
      startDate,
      endDate,
      label: `Year to yesterday (${endLabel})`,
    };
  }

  // month_to_date — through yesterday only (never include today's partial CRM/import rows)
  const [y, m] = endDate.split('-').map(Number);
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
  return {
    startDate,
    endDate,
    label: `Month to yesterday (${endLabel})`,
  };
}

export function validateMisEmailPreferencesPatch(params: {
  patch: MisEmailPreferences;
  permissions: Pick<
    DigestRecipient,
    'includeSummary' | 'includeDetailed' | 'includeKeyAccount'
  >;
  current: MisEmailPreferences;
  misEmailEnabled: boolean;
  forPreview?: boolean;
  allowedEmailDomains?: string[];
}): { ok: true; merged: MisEmailPreferences } | { ok: false; error: string } {
  if (!params.misEmailEnabled) {
    return { ok: false, error: 'MIS email is not enabled for your account' };
  }

  const merged = mergeMisEmailPreferences(params.current, params.patch);
  if (
    merged.sendTimeIst !== undefined &&
    normalizeMisEmailSendTime(merged.sendTimeIst) === null
  ) {
    return { ok: false, error: 'Digest time must be in HH:mm format (IST)' };
  }

  if (!params.forPreview && merged.subscribed !== false) {
    const effective = resolveEffectiveDigestIncludes(params.permissions, merged);
    if (!hasAnyEffectiveDigestInclude(effective)) {
      return { ok: false, error: 'Select at least one report type to receive' };
    }
  }

  if (merged.includeSummary && !params.permissions.includeSummary) {
    return { ok: false, error: 'Summary report is not permitted for your role' };
  }
  if (merged.includeDetailed && !params.permissions.includeDetailed) {
    return { ok: false, error: 'Detailed register is not permitted for your role' };
  }
  if (merged.includeKeyAccount && !params.permissions.includeKeyAccount) {
    return { ok: false, error: 'Key account report is not permitted for your role' };
  }
  if (merged.includeTraceableExport && !params.permissions.includeSummary) {
    return { ok: false, error: 'Traceable export requires summary report access' };
  }
  if (merged.includeOpenCallsExport && !params.permissions.includeSummary) {
    return { ok: false, error: 'Open calls export requires summary report access' };
  }

  const bodyPermissions: MisEmailBodyPermissions = {
    includeSummary: params.permissions.includeSummary,
    includeKeyAccount: params.permissions.includeKeyAccount,
  };

  const effectiveBody = resolveEffectiveBodySections(bodyPermissions, merged);
  const summaryBodySections = effectiveBody.filter(
    (id) => id === 'regional_performance' || id === 'branch_performance'
  );
  if (summaryBodySections.length > 0 && !params.permissions.includeSummary) {
    return { ok: false, error: 'Email body preview requires summary report access' };
  }
  if (
    effectiveBody.includes('key_account_performance') &&
    !params.permissions.includeKeyAccount
  ) {
    return { ok: false, error: 'Key account body section requires Key Account MIS access' };
  }

  try {
    const domains = params.allowedEmailDomains ?? [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
    assertAllowedEmailDomains(
      [
        ...resolveMisEmailToEmails(merged),
        ...resolveMisEmailCcEmails(merged),
        ...(merged.extraEmails ?? []),
      ],
      domains
    );
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid recipient email domain',
    };
  }

  merged.bodyInEmail = resolveDigestBodySections(bodyPermissions, merged, {
    includeKeyAccountAttachment: false,
  });
  merged.keyAccountsInBody = parseMisEmailKeyAccountsInBody(merged.keyAccountsInBody);
  merged.keyAccountsByZone = parseMisEmailKeyAccountsByZone(merged.keyAccountsByZone);

  return { ok: true, merged };
}

export function userHasMisReportPermissions(
  permissions: Pick<
    DigestRecipient,
    'includeSummary' | 'includeDetailed' | 'includeKeyAccount'
  >
): boolean {
  return (
    permissions.includeSummary ||
    permissions.includeDetailed ||
    permissions.includeKeyAccount
  );
}
