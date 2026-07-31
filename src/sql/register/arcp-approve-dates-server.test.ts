import { describe, expect, it } from 'vitest';
import {
  normalizeRegisterArcpCallKey,
  registerRowCallId,
} from '@/sql/register/arcp-approve-dates-server';

describe('register ARCP call-id matching', () => {
  it('normalizes Service Order / vtrnno as the call key', () => {
    expect(normalizeRegisterArcpCallKey(' 26G14845 ')).toBe('26G14845');
    expect(registerRowCallId({ vtrnno: '26G14845' })).toBe('26G14845');
    expect(registerRowCallId({ UniqueCallNo: '26g14845' })).toBe('26G14845');
  });

  it('prefers UniqueCallNo / vtrnno over ncode for identity', () => {
    expect(
      registerRowCallId({
        UniqueCallNo: '26G14845',
        ncode: 999001,
        id: 999001,
      })
    ).toBe('26G14845');
  });
});
