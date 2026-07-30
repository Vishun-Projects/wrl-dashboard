import { describe, expect, it } from 'vitest';
import {
  forgotPasswordAuditReason,
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  validateForgotPasswordEmail,
} from '@/lib/auth/forgot-password-core';
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

describe('forgotPasswordAuditReason', () => {
  it('classifies unknown email for audit only', () => {
    expect(
      forgotPasswordAuditReason({
        email: 'nobody@example.com',
        inAuth: false,
        inAppUsers: false,
        appUserName: null,
      })
    ).toBe('account_not_found');
  });

  it('classifies ready account for audit only', () => {
    expect(
      forgotPasswordAuditReason({
        email: 'user@example.com',
        inAuth: true,
        inAppUsers: true,
        appUserName: 'Test User',
      })
    ).toBe('account_ready');
  });
});

describe('FORGOT_PASSWORD_GENERIC_MESSAGE', () => {
  it('stays vague (no account enumeration)', () => {
    expect(FORGOT_PASSWORD_GENERIC_MESSAGE).toMatch(/if an account exists/i);
    expect(FORGOT_PASSWORD_GENERIC_MESSAGE).not.toMatch(/no account found/i);
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
