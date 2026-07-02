import { defaultDateRange, formatLocalDate, toDateString } from '@/lib/report/filters';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import {
  parseMisEmailBodySectionIds,
  resolveEffectiveBodySections,
  type MisEmailBodySectionId,
} from '@/lib/mis-email/body-sections';

export type MisEmailDateRangeMode = 'yesterday' | 'month_to_date';

export type MisEmailPreferences = {
  subscribed?: boolean;
  dateRange?: MisEmailDateRangeMode;
  includeSummary?: boolean;
  includeDetailed?: boolean;
  includeKeyAccount?: boolean;
  /** Additional inboxes that receive the same daily digest (e.g. work + personal). */
  extraEmails?: string[];
  /** Summary report sections rendered inline in the email body (full Excel still attached). */
  bodyInEmail?: MisEmailBodySectionId[];
};

export const DEFAULT_MIS_EMAIL_PREFERENCES: Required<MisEmailPreferences> = {
  subscribed: true,
  dateRange: 'month_to_date',
  includeSummary: true,
  includeDetailed: true,
  includeKeyAccount: true,
  extraEmails: [],
  bodyInEmail: [],
};

export type EffectiveDigestIncludes = {
  includeSummary: boolean;
  includeDetailed: boolean;
  includeKeyAccount: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMisEmailPreferences(raw: unknown): MisEmailPreferences {
  if (!isRecord(raw)) return {};
  const prefs: MisEmailPreferences = {};

  if (typeof raw.subscribed === 'boolean') prefs.subscribed = raw.subscribed;
  if (raw.dateRange === 'yesterday' || raw.dateRange === 'month_to_date') {
    prefs.dateRange = raw.dateRange;
  }
  if (typeof raw.includeSummary === 'boolean') prefs.includeSummary = raw.includeSummary;
  if (typeof raw.includeDetailed === 'boolean') prefs.includeDetailed = raw.includeDetailed;
  if (typeof raw.includeKeyAccount === 'boolean') prefs.includeKeyAccount = raw.includeKeyAccount;
  if (Array.isArray(raw.extraEmails)) {
    prefs.extraEmails = raw.extraEmails
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'));
  }
  if (Array.isArray(raw.bodyInEmail)) {
    prefs.bodyInEmail = parseMisEmailBodySectionIds(raw.bodyInEmail);
  }

  return prefs;
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

export function mergeMisEmailPreferences(
  stored: unknown,
  patch?: MisEmailPreferences
): MisEmailPreferences {
  return { ...parseMisEmailPreferences(stored), ...patch };
}

/** Defaults when admin first enables MIS email for a user. */
export function defaultPreferencesForRecipient(recipient: Pick<
  DigestRecipient,
  'includeSummary' | 'includeDetailed' | 'includeKeyAccount'
>): MisEmailPreferences {
  return {
    subscribed: true,
    dateRange: 'month_to_date',
    includeSummary: recipient.includeSummary,
    includeDetailed: recipient.includeDetailed,
    includeKeyAccount: recipient.includeKeyAccount,
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
  };
}

export function hasAnyEffectiveDigestInclude(includes: EffectiveDigestIncludes): boolean {
  return includes.includeSummary || includes.includeDetailed || includes.includeKeyAccount;
}

export function resolveDigestDateRangeForPreferences(
  prefs: MisEmailPreferences
): DigestDateRange {
  const mode = prefs.dateRange ?? DEFAULT_MIS_EMAIL_PREFERENCES.dateRange;

  if (mode === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const day = toDateString(d);
    const label = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return {
      startDate: day,
      endDate: day,
      label: `Yesterday (${label})`,
    };
  }

  const range = defaultDateRange();
  return {
    startDate: toDateString(range.start),
    endDate: toDateString(range.end),
    label: range.label || 'Month to date',
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
}): { ok: true; merged: MisEmailPreferences } | { ok: false; error: string } {
  if (!params.misEmailEnabled) {
    return { ok: false, error: 'MIS email is not enabled for your account' };
  }

  const merged = mergeMisEmailPreferences(params.current, params.patch);

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

  if ((merged.bodyInEmail?.length ?? 0) > 0 && !params.permissions.includeSummary) {
    return { ok: false, error: 'Email body preview requires summary report access' };
  }

  merged.bodyInEmail = resolveEffectiveBodySections(params.permissions.includeSummary, merged);

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
