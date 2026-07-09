import { describe, expect, it } from 'vitest';
import { forgotPasswordStatusMessage, validateForgotPasswordEmail } from '@/lib/auth/forgot-password-core';
import { hasCapability, LEGACY_HOD_ROLE_NAMES } from '@/lib/auth/rbac-catalog';

describe('validateForgotPasswordEmail', () => {
  it('accepts valid email', () => {
    expect(validateForgotPasswordEmail('User@Example.com')).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

  it('rejects invalid email', () => {
    expect(validateForgotPasswordEmail('not-an-email').ok).toBe(false);
  });
});

describe('forgotPasswordStatusMessage', () => {
  it('reports when email is not registered', () => {
    expect(
      forgotPasswordStatusMessage({
        email: 'nobody@example.com',
        inAuth: false,
        inAppUsers: false,
        appUserName: null,
      })
    ).toMatch(/No account found/i);
  });

  it('reports when auth login exists', () => {
    expect(
      forgotPasswordStatusMessage({
        email: 'user@example.com',
        inAuth: true,
        inAppUsers: true,
        appUserName: 'Test User',
      })
    ).toMatch(/Account found/i);
  });
});

describe('portal RBAC office scoping', () => {
  it('treats HOD and view_all_offices as national scope', () => {
    expect((LEGACY_HOD_ROLE_NAMES as readonly string[]).includes('hod')).toBe(true);
    expect(hasCapability(['view_all_offices'], 'view_all_offices')).toBe(true);
  });

  it('keeps branch managers without national capability branch-scoped', () => {
    expect(hasCapability(['tab_mis_summary'], 'view_all_offices')).toBe(false);
  });
});
