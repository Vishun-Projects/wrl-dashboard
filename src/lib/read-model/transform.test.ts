import { describe, expect, it } from 'vitest';
import { isHotEligibleRow } from './transform';

describe('isHotEligibleRow', () => {
  const now = new Date('2026-06-24T12:00:00.000Z');

  it('rejects rows without TRN', () => {
    expect(isHotEligibleRow({}, now)).toBe(false);
  });

  it('accepts recent logged calls', () => {
    expect(
      isHotEligibleRow(
        {
          vtrnno: 'TRN-1',
          callsdtrndate: '2026-06-01',
          nsolved: 0,
          ntechsolved: 0,
          ncancelreason: 0,
        },
        now
      )
    ).toBe(true);
  });
});
