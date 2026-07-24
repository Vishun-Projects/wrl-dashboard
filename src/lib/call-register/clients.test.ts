import { describe, expect, it } from 'vitest';
import {
  CALL_REGISTER_CLIENTS,
  CALL_REGISTER_FULL_CLIENTS_EMAIL,
  CALL_REGISTER_FULL_CLIENTS_EMAILS,
  canSeeAllCallRegisterClients,
  normalizeVisibleClientNames,
  parseCallRegisterClientList,
  validateCallRegisterExportClients,
} from '@/lib/call-register/clients';

describe('call-register client visibility', () => {
  it('gates full dynamic list to allowlisted emails', () => {
    expect(CALL_REGISTER_FULL_CLIENTS_EMAILS).toContain(CALL_REGISTER_FULL_CLIENTS_EMAIL);
    expect(canSeeAllCallRegisterClients(CALL_REGISTER_FULL_CLIENTS_EMAIL)).toBe(true);
    expect(canSeeAllCallRegisterClients('VishunVishwakarma90211@gmail.com')).toBe(true);
    expect(canSeeAllCallRegisterClients('other@example.com')).toBe(false);
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
      'ops@example.com',
      allowed
    );
    expect(bad.ok).toBe(false);
    const ok = validateCallRegisterExportClients(['UB', 'Nestle'], 'ops@example.com', allowed);
    expect(ok).toEqual({ ok: true, clients: ['UB', 'Nestle'] });
  });

  it('defaults allowlist to curated constant when none passed', () => {
    const ok = validateCallRegisterExportClients(
      [CALL_REGISTER_CLIENTS[0]],
      'ops@example.com'
    );
    expect(ok).toEqual({ ok: true, clients: [CALL_REGISTER_CLIENTS[0]] });
  });

  it('allows any non-empty client for the full-access email', () => {
    const ok = validateCallRegisterExportClients(
      ['Custom Account'],
      CALL_REGISTER_FULL_CLIENTS_EMAIL,
      ['UB']
    );
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
