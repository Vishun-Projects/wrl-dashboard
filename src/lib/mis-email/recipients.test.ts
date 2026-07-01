import { describe, expect, it } from 'vitest';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import { passesDigestRecipientFilters } from '@/lib/mis-email/recipients';

function baseRecipient(overrides: Partial<DigestRecipient> = {}): DigestRecipient {
  return {
    id: 'u1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'branch_manager',
    office_ids: ['1'],
    visible_statuses: [],
    permissions: ['tab_mis_summary'],
    includeSummary: true,
    includeDetailed: false,
    includeKeyAccount: false,
    mis_email_enabled: true,
    mis_email_preferences: { subscribed: true, includeSummary: true },
    ...overrides,
  };
}

describe('passesDigestRecipientFilters', () => {
  it('rejects when admin has not enabled email', () => {
    expect(
      passesDigestRecipientFilters(baseRecipient({ mis_email_enabled: false }))
    ).toBe(false);
  });

  it('rejects unsubscribed users', () => {
    expect(
      passesDigestRecipientFilters(
        baseRecipient({ mis_email_preferences: { subscribed: false } })
      )
    ).toBe(false);
  });

  it('rejects when no effective report types selected', () => {
    expect(
      passesDigestRecipientFilters(
        baseRecipient({
          mis_email_preferences: { subscribed: true, includeSummary: false },
        })
      )
    ).toBe(false);
  });

  it('accepts enabled subscribed users with a report type', () => {
    expect(passesDigestRecipientFilters(baseRecipient())).toBe(true);
  });

  it('rejects null recipient', () => {
    expect(passesDigestRecipientFilters(null)).toBe(false);
  });
});
