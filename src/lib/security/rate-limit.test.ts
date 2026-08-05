import { describe, expect, it } from 'vitest';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from './rate-limit';

describe('checkRateLimit', () => {
  it('allows requests up to the configured limit', () => {
    const key = 'test-ip-1';
    const limit = 5;

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, limit, 60_000).allowed).toBe(true);
    }

    const blocked = checkRateLimit(key, limit, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('tracks failed attempts and resets on success', () => {
    const key = 'test-ip-fail';
    expect(recordFailedAttempt(key)).toBe(1);
    expect(recordFailedAttempt(key)).toBe(2);
    expect(recordFailedAttempt(key)).toBe(3);
    expect(recordFailedAttempt(key)).toBe(4);
    expect(recordFailedAttempt(key)).toBe(5);

    resetFailedAttempts(key);
    expect(recordFailedAttempt(key)).toBe(1);
  });
});
