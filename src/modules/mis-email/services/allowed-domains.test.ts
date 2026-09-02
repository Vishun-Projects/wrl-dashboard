import { describe, expect, it } from 'vitest';
import {
  assertAllowedEmailDomains,
  isEmailAllowedForDomains,
  normalizeAllowedEmailDomains,
} from '@/lib/mail/allowed-domains';

describe('allowed-domains', () => {
  it('falls back to westernequipments.com when empty', () => {
    expect(normalizeAllowedEmailDomains([])).toEqual(['westernequipments.com']);
    expect(normalizeAllowedEmailDomains(null)).toEqual(['westernequipments.com']);
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
