import { describe, expect, it } from 'vitest';
import {
  assertAllowedEmailDomains,
  isEmailAllowedForDomains,
  normalizeAllowedEmailDomains,
} from '@/modules/mail-alerts/services/allowed-domains';
import { DEFAULT_ALLOWED_EMAIL_DOMAINS } from '@/modules/mail-alerts/services/org-settings-defaults';

describe('allowed-domains', () => {
  it('falls back to westernequipments.com when empty', () => {
    expect(normalizeAllowedEmailDomains([])).toEqual([...DEFAULT_ALLOWED_EMAIL_DOMAINS]);
    expect(normalizeAllowedEmailDomains(null)).toEqual([...DEFAULT_ALLOWED_EMAIL_DOMAINS]);
  });

  it('allows corporate domain and rejects gmail', () => {
    expect(isEmailAllowedForDomains('mis.service@westernequipments.com', ['westernequipments.com'])).toBe(
      true
    );
    expect(isEmailAllowedForDomains('person@gmail.com', ['westernequipments.com'])).toBe(false);
  });

  it('assert throws with clear message', () => {
    expect(() =>
      assertAllowedEmailDomains(['ok@westernequipments.com', 'bad@gmail.com'], ['westernequipments.com'])
    ).toThrow(/Only @westernequipments.com/);
  });
});
