import { describe, expect, it } from 'vitest';
import { isHotEligibleRow, processCrmRowsForYtdLoad } from './transform';

describe('isHotEligibleRow', () => {
  it('rejects rows without TRN', () => {
    expect(isHotEligibleRow({})).toBe(false);
  });

  it('accepts recent logged calls', () => {
    expect(
      isHotEligibleRow({
        vtrnno: 'TRN-1',
        callsdtrndate: '2026-06-01',
        bsolved: 0,
        bfastclose: 0,
        ncancelreason: 0,
      })
    ).toBe(true);
  });

  it('accepts solved calls from Jan (YTD — not dropped by old 90d rule)', () => {
    expect(
      isHotEligibleRow({
        vtrnno: 'TRN-OLD-SOLVED',
        callsdtrndate: '2026-01-15',
        bsolved: 1,
        bfastclose: 0,
        ncancelreason: 0,
      })
    ).toBe(true);
  });

  it('rejects pre-YTD solved calls', () => {
    expect(
      isHotEligibleRow({
        vtrnno: 'TRN-2025',
        callsdtrndate: '2025-12-01',
        bsolved: 1,
        bfastclose: 0,
        ncancelreason: 0,
      })
    ).toBe(false);
  });
});

describe('processCrmRowsForYtdLoad', () => {
  it('includes solved YTD rows without eligibility filter', () => {
    const rows = processCrmRowsForYtdLoad([
      {
        ncode: 1,
        vtrnno: 'T1',
        nofficeid: 100,
        callsdtrndate: '2026-02-01',
        bsolved: 1,
        bfastclose: 0,
        ncancelreason: 0,
        officename: 'Branch',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vtrnno).toBe('T1');
  });
});
