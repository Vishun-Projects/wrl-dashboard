import { describe, expect, it } from 'vitest';
import { rateLimitClassForPath } from '@/lib/security/rate-limit-class';

describe('rateLimitClassForPath', () => {
  it('throttles forgot-password tightly', () => {
    expect(rateLimitClassForPath('/api/auth/forgot-password')).toEqual({
      limit: 5,
      windowMs: 15 * 60_000,
      keySuffix: 'auth-forgot',
    });
  });

  it('throttles sign-in tightly', () => {
    expect(rateLimitClassForPath('/api/auth/sign-in')).toEqual({
      limit: 10,
      windowMs: 15 * 60_000,
      keySuffix: 'auth-signin',
    });
  });

  it('uses default auth class for other auth routes', () => {
    expect(rateLimitClassForPath('/api/auth/complete-password-reset')).toEqual({
      limit: 20,
      windowMs: 60_000,
      keySuffix: 'auth',
    });
  });

  it('keeps heavy and default classes', () => {
    expect(rateLimitClassForPath('/api/report/corpus').keySuffix).toBe('heavy');
    expect(rateLimitClassForPath('/api/report/summary').keySuffix).toBe('default');
  });
});
