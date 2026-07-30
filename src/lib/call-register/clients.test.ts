import { describe, expect, it } from 'vitest';
import {
  canSeeAllCallRegisterClients,
  normalizeVisibleClientNames,
  parseCallRegisterClientList,
  validateCallRegisterExportClients,
} from '@/lib/call-register/clients';

describe('call-register client visibility', () => {
  it('gates full dynamic list to super_admin', () => {
    expect(canSeeAllCallRegisterClients(['super_admin'])).toBe(true);
    expect(canSeeAllCallRegisterClients(['view_all_offices', 'manage_users'])).toBe(false);
    expect(canSeeAllCallRegisterClients([])).toBe(false);
    expect(canSeeAllCallRegisterClients(null)).toBe(false);
  });

  it('parses clients query lists', () => {
    expect(parseCallRegisterClientList('UB, Nestle, UB')).toEqual(['UB', 'Nestle']);
    expect(parseCallRegisterClientList('')).toEqual([]);
  });

  it('rejects clients outside the shared allowlist for normal users', () => {
    const allowed = ['UB', 'Nestle'];
    const bad = validateCallRegisterExportClients(
      ['UB', 'UnknownCo'],
      ['tab_mis_deployment_completion'],
      allowed
    );
    expect(bad.ok).toBe(false);
    const ok = validateCallRegisterExportClients(
      ['UB', 'Nestle'],
      ['tab_mis_deployment_completion'],
      allowed
    );
    expect(ok).toEqual({ ok: true, clients: ['UB', 'Nestle'] });
  });

  it('rejects normal users when no allowlist is passed', () => {
    const bad = validateCallRegisterExportClients(['UB'], ['tab_mis_deployment_completion']);
    expect(bad.ok).toBe(false);
  });

  it('allows any non-empty client for super_admin', () => {
    const ok = validateCallRegisterExportClients(['Custom Account'], ['super_admin'], ['UB']);
    expect(ok).toEqual({ ok: true, clients: ['Custom Account'] });
  });
});

describe('normalizeVisibleClientNames', () => {
  it('trims, collapses spaces, and dedupes case-insensitively', () => {
    expect(normalizeVisibleClientNames(['  UB ', 'ub', 'Nestle', '', '  Nestle  Soft  '])).toEqual([
      'UB',
      'Nestle',
      'Nestle Soft',
    ]);
  });
});
