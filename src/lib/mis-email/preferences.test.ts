import { describe, expect, it } from 'vitest';
import { formatLocalDate } from '@/lib/report/filters';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  hasAnyEffectiveDigestInclude,
  parseMisEmailPreferences,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  validateMisEmailPreferencesPatch,
} from '@/lib/mis-email/preferences';

const perms = {
  includeSummary: true,
  includeDetailed: true,
  includeKeyAccount: false,
};

describe('parseMisEmailPreferences', () => {
  it('parses valid fields', () => {
    expect(
      parseMisEmailPreferences({
        subscribed: false,
        dateRange: 'yesterday',
        includeSummary: true,
      })
    ).toEqual({ subscribed: false, dateRange: 'yesterday', includeSummary: true });
  });

  it('parses extraEmails', () => {
    expect(
      parseMisEmailPreferences({
        extraEmails: ['Vishnu.Vishwakarma@westernequipments.com', 'bad'],
      })
    ).toEqual({ extraEmails: ['vishnu.vishwakarma@westernequipments.com'] });
  });

  it('parses bodyInEmail', () => {
    expect(
      parseMisEmailPreferences({
        bodyInEmail: ['regional_performance', 'invalid'],
      })
    ).toEqual({ bodyInEmail: ['regional_performance'] });
  });
});

describe('resolveExtraDigestEmails', () => {
  it('dedupes primary and normalizes case', () => {
    expect(
      resolveExtraDigestEmails(
        { extraEmails: ['Vishnu.Vishwakarma@westernequipments.com', 'vishunvishwakarma90211@gmail.com'] },
        'vishunvishwakarma90211@gmail.com'
      )
    ).toEqual(['vishnu.vishwakarma@westernequipments.com']);
  });
});

describe('resolveEffectiveDigestIncludes', () => {
  it('intersects role permissions with user prefs', () => {
    expect(
      resolveEffectiveDigestIncludes(perms, {
        includeSummary: true,
        includeDetailed: false,
        includeKeyAccount: true,
      })
    ).toEqual({
      includeSummary: true,
      includeDetailed: false,
      includeKeyAccount: false,
    });
  });
});

describe('resolveDigestDateRangeForPreferences', () => {
  it('returns month to date by default', () => {
    const range = resolveDigestDateRangeForPreferences({});
    expect(range.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns yesterday only', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const expected = formatLocalDate(d);
    const range = resolveDigestDateRangeForPreferences({ dateRange: 'yesterday' });
    expect(range.startDate).toBe(expected);
    expect(range.endDate).toBe(expected);
    expect(range.label).toContain('Yesterday');
  });
});

describe('validateMisEmailPreferencesPatch', () => {
  it('rejects when admin has not enabled email', () => {
    const result = validateMisEmailPreferencesPatch({
      patch: { subscribed: true },
      permissions: perms,
      current: DEFAULT_MIS_EMAIL_PREFERENCES,
      misEmailEnabled: false,
    });
    expect(result.ok).toBe(false);
  });

  it('requires at least one report when subscribed', () => {
    const result = validateMisEmailPreferencesPatch({
      patch: { includeSummary: false, includeDetailed: false },
      permissions: perms,
      current: DEFAULT_MIS_EMAIL_PREFERENCES,
      misEmailEnabled: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe('hasAnyEffectiveDigestInclude', () => {
  it('detects empty selection', () => {
    expect(
      hasAnyEffectiveDigestInclude({
        includeSummary: false,
        includeDetailed: false,
        includeKeyAccount: false,
      })
    ).toBe(false);
  });
});
