import { describe, expect, it } from 'vitest';
import {
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

describe('forgot password generic response', () => {
  it('uses non-enumerating message', () => {
    expect(FORGOT_PASSWORD_GENERIC_MESSAGE).toMatch(/If an account exists/i);
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
