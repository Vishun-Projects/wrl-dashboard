import { describe, expect, it } from 'vitest';
import { addDays } from './crm-fetch';

describe('addDays', () => {
  it('returns the next local calendar day, not UTC-shifted', () => {
    expect(addDays('2026-08-22', 1)).toBe('2026-08-23');
  });
});
