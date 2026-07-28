import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  formatIstDate,
  getCurrentIstMinutes,
  hasAnyEffectiveDigestInclude,
  istYesterdayDateString,
  normalizeMisEmailSendTime,
  parseMisEmailKeyAccountsInBody,
  parseMisEmailPreferences,
  resolveMisEmailSendTimeIst,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  defaultPreferencesForRecipient,
  shouldSendMisEmailNow,
  validateMisEmailPreferencesPatch,
} from '@/features/mis-email/lib/preferences';

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

  it('parses extraEmails and migrates to toEmails when missing', () => {
    expect(
      parseMisEmailPreferences({
        extraEmails: ['Vishnu.Vishwakarma@westernequipments.com', 'bad'],
      })
    ).toEqual({
      extraEmails: ['vishnu.vishwakarma@westernequipments.com'],
      toEmails: ['vishnu.vishwakarma@westernequipments.com'],
    });
  });

  it('parses toEmails and ccEmails', () => {
    expect(
      parseMisEmailPreferences({
        toEmails: ['Samiran.M@westernequipments.com'],
        ccEmails: ['Parmeet@westernequipments.com', 'bad'],
      })
    ).toEqual({
      toEmails: ['samiran.m@westernequipments.com'],
      ccEmails: ['parmeet@westernequipments.com'],
    });
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

  it('parses keyAccountsByZone', () => {
    expect(
      parseMisEmailPreferences({
        keyAccountsByZone: {
          NORTH: ['Nestle', 'nestle'],
          EAST: ['COKE'],
        },
      })
    ).toEqual({ keyAccountsByZone: { NORTH: ['Nestle'], EAST: ['COKE'], WEST: [], SOUTH: [] } });
  });

  it('parses valid IST send time', () => {
    expect(
      parseMisEmailPreferences({
        sendTimeIst: '09:30',
      })
    ).toEqual({ sendTimeIst: '09:30' });
  });
});

describe('send time helpers', () => {
  it('normalizes valid HH:mm values', () => {
    expect(normalizeMisEmailSendTime('07:00')).toBe('07:00');
    expect(normalizeMisEmailSendTime('24:00')).toBeNull();
  });

  it('falls back to default IST send time', () => {
    expect(resolveMisEmailSendTimeIst({})).toBe('09:30');
  });

  it('matches configured send window', () => {
    const now = new Date('2026-01-01T01:30:00.000Z'); // 07:00 IST
    expect(getCurrentIstMinutes(now)).toBe(420);
    expect(
      shouldSendMisEmailNow(
        { sendTimeIst: '07:00' },
        { now, windowMinutes: 15 }
      )
    ).toBe(true);
    expect(
      shouldSendMisEmailNow(
        { sendTimeIst: '07:20' },
        { now, windowMinutes: 15 }
      )
    ).toBe(false);
  });

  it('does not re-fire on the next */15 cron tick after the anchor', () => {
    const now = new Date('2026-01-01T04:15:00.000Z'); // 09:45 IST
    expect(getCurrentIstMinutes(now)).toBe(9 * 60 + 45);
    expect(
      shouldSendMisEmailNow({ sendTimeIst: '09:30' }, { now, windowMinutes: 15 })
    ).toBe(false);
  });

  it('still matches a delayed run within the same */15 slot', () => {
    const now = new Date('2026-01-01T04:10:00.000Z'); // 09:40 IST
    expect(
      shouldSendMisEmailNow({ sendTimeIst: '09:30' }, { now, windowMinutes: 15 })
    ).toBe(true);
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
      includeOpenCallsExport: false,
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
      includeOpenCallsExport: false,
    });
  });

  it('empty prefs merge defaults so allowed report types stay on', () => {
    expect(resolveEffectiveDigestIncludes(perms, {})).toEqual({
      includeSummary: true,
      includeDetailed: true,
      includeKeyAccount: false,
      includeTraceableExport: false,
      includeOpenCallsExport: false,
    });
  });
});

describe('resolveDigestDateRangeForPreferences', () => {
  it('returns month through yesterday by default (never includes today)', () => {
    const expectedEnd = istYesterdayDateString();
    const [y, m] = expectedEnd.split('-').map(Number);
    const expectedStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const range = resolveDigestDateRangeForPreferences({});
    expect(range.startDate).toBe(expectedStart);
    expect(range.endDate).toBe(expectedEnd);
    expect(range.endDate).not.toBe(formatIstDate());
    expect(range.label).toContain('Month to yesterday');
  });

  it('returns yesterday only', () => {
    const expected = istYesterdayDateString();
    const range = resolveDigestDateRangeForPreferences({ dateRange: 'yesterday' });
    expect(range.startDate).toBe(expected);
    expect(range.endDate).toBe(expected);
    expect(range.label).toContain('Yesterday');
  });

  it('returns year to yesterday from Jan 1 through prior day', () => {
    const expectedEnd = istYesterdayDateString();
    const expectedStart = `${expectedEnd.slice(0, 4)}-01-01`;
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

  it('forPreview allows all-false includes; non-preview still rejects', () => {
    const allOff = {
      includeSummary: false,
      includeDetailed: false,
      includeKeyAccount: false,
      includeTraceableExport: false,
      includeOpenCallsExport: false,
    };
    const preview = validateMisEmailPreferencesPatch({
      patch: allOff,
      permissions: perms,
      current: DEFAULT_MIS_EMAIL_PREFERENCES,
      misEmailEnabled: true,
      forPreview: true,
    });
    expect(preview.ok).toBe(true);

    const save = validateMisEmailPreferencesPatch({
      patch: allOff,
      permissions: perms,
      current: DEFAULT_MIS_EMAIL_PREFERENCES,
      misEmailEnabled: true,
    });
    expect(save.ok).toBe(false);
    if (!save.ok) {
      expect(save.error).toMatch(/Select at least one report type/i);
    }
  });

  it('rejects non-allowed email domains', () => {
    const result = validateMisEmailPreferencesPatch({
      patch: {
        includeSummary: true,
        includeDetailed: false,
        includeKeyAccount: false,
        toEmails: ['someone@gmail.com'],
        ccEmails: [],
      },
      permissions: { includeSummary: true, includeDetailed: true, includeKeyAccount: false },
      current: { ...DEFAULT_MIS_EMAIL_PREFERENCES, includeKeyAccount: false },
      misEmailEnabled: true,
      allowedEmailDomains: ['westernequipments.com'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Only @westernequipments.com/);
    }
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

  it('rejects invalid digest send time', () => {
    const result = validateMisEmailPreferencesPatch({
      patch: { sendTimeIst: '25:99' },
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
        includeTraceableExport: false,
        includeOpenCallsExport: false,
      })
    ).toBe(false);
  });
});

describe('defaultPreferencesForRecipient', () => {
  it('seeds regional + branch body when summary allowed', () => {
    const prefs = defaultPreferencesForRecipient({
      includeSummary: true,
      includeDetailed: false,
      includeKeyAccount: false,
    });
    expect(prefs.includeSummary).toBe(true);
    expect(prefs.bodyInEmail).toEqual(['regional_performance', 'branch_performance']);
    expect(prefs.bodyInEmail).not.toContain('key_account_performance');
  });

  it('adds key-account body section when key account allowed', () => {
    const prefs = defaultPreferencesForRecipient({
      includeSummary: true,
      includeDetailed: false,
      includeKeyAccount: true,
    });
    expect(prefs.bodyInEmail).toContain('key_account_performance');
  });
});
