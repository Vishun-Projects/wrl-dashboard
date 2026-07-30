import { describe, expect, it } from 'vitest';
import {
  SESSION_EXPIRED_CODE,
  SESSION_MAX_AGE_SEC,
  isSessionExpired,
  parseSessionStartedAt,
  sessionExpiredJsonBody,
  sessionExpiresAtSec,
} from '@/lib/auth/session-policy';

describe('session-policy', () => {
  it('parses started_at and rejects junk', () => {
    expect(parseSessionStartedAt('1710000000')).toBe(1710000000);
    expect(parseSessionStartedAt('')).toBeNull();
    expect(parseSessionStartedAt('nope')).toBeNull();
  });

  it('expires missing or aged sessions', () => {
    const now = 1_800_000_000;
    expect(isSessionExpired(null, now)).toBe(true);
    expect(isSessionExpired(now - SESSION_MAX_AGE_SEC, now)).toBe(true);
    expect(isSessionExpired(now - SESSION_MAX_AGE_SEC + 1, now)).toBe(false);
  });

  it('computes expiry and API body', () => {
    expect(sessionExpiresAtSec(100)).toBe(100 + SESSION_MAX_AGE_SEC);
    expect(sessionExpiredJsonBody().code).toBe(SESSION_EXPIRED_CODE);
  });
});
