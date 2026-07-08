import { describe, expect, it } from 'vitest';
import { formatLocalDate } from '@/lib/report/filters';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  hasAnyEffectiveDigestInclude,
  parseMisEmailKeyAccountsInBody,
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
        dateRange: 'year_to_yesterday',
        includeSummary: true,
      })
    ).toEqual({ subscribed: false, dateRange: 'year_to_yesterday', includeSummary: true });
  });

  it('parses valid fields with yesterday', () => {
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

  it('parses keyAccountsInBody', () => {
    expect(
      parseMisEmailPreferences({
        keyAccountsInBody: ['Nestle', 'nestle', ' COKE '],
      })
    ).toEqual({ keyAccountsInBody: ['Nestle', 'COKE'] });
  });
});

describe('parseMisEmailKeyAccountsInBody', () => {
  it('dedupes case-insensitively while preserving first casing', () => {
    expect(parseMisEmailKeyAccountsInBody(['Cadbury', 'cadbury', 'COKE'])).toEqual([
      'Cadbury',
      'COKE',
    ]);
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
      includeTraceableExport: false,
    });
  });

  it('enables traceable export when explicitly opted in', () => {
    expect(
      resolveEffectiveDigestIncludes(perms, {
        includeTraceableExport: true,
      })
    ).toEqual({
      includeSummary: true,
      includeDetailed: true,
      includeKeyAccount: false,
      includeTraceableExport: true,
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

  it('returns year to yesterday from Jan 1 through prior day', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedEnd = formatLocalDate(yesterday);
    const expectedStart = `${yesterday.getFullYear()}-01-01`;
    const range = resolveDigestDateRangeForPreferences({ dateRange: 'year_to_yesterday' });
    expect(range.startDate).toBe(expectedStart);
    expect(range.endDate).toBe(expectedEnd);
    expect(range.label).toContain('Year to yesterday');
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

  it('allows key account body section with key account permission', () => {
    const result = validateMisEmailPreferencesPatch({
      patch: {
        bodyInEmail: ['key_account_performance'],
        keyAccountsInBody: ['Nestle'],
      },
      permissions: { ...perms, includeKeyAccount: true },
      current: DEFAULT_MIS_EMAIL_PREFERENCES,
      misEmailEnabled: true,
      forPreview: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged.bodyInEmail).toEqual(['key_account_performance']);
      expect(result.merged.keyAccountsInBody).toEqual(['Nestle']);
    }
  });
});

describe('hasAnyEffectiveDigestInclude', () => {
  it('detects empty selection', () => {
    expect(
      hasAnyEffectiveDigestInclude({
        includeSummary: false,
        includeDetailed: false,
        includeKeyAccount: false,
        includeTraceableExport: false,
      })
    ).toBe(false);
  });
});
