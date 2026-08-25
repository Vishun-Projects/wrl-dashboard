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

  it('keeps pre-YTD real cancels (Cancelled At is by cancel day, not call day)', () => {
    expect(
      isHotEligibleRow({
        vtrnno: '25I03443',
        callsdtrndate: '2025-09-03',
        bsolved: 0,
        bfastclose: 0,
        ncancelreason: 9,
      })
    ).toBe(true);
  });

  it('still rejects pre-YTD transfer cancel reason 2', () => {
    expect(
      isHotEligibleRow({
        vtrnno: '25XFER',
        callsdtrndate: '2025-09-03',
        bsolved: 0,
        bfastclose: 0,
        ncancelreason: 2,
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
    expect(rows[0].status_bucket).toBe('solved');
    expect(rows[0].cancelled_at).toBeNull();
  });

  it('sets cancelled_at from editedon for cancelled rows', () => {
    const edited = '2026-08-22T10:00:00';
    const rows = processCrmRowsForYtdLoad([
      {
        ncode: 2,
        vtrnno: 'T-CAN',
        nofficeid: 100,
        callsdtrndate: '2026-02-01',
        editedon: edited,
        bsolved: 0,
        bfastclose: 0,
        ncancelreason: 10,
        Status: 'Cancelled',
        callstatus: 'Cancelled',
        cancel_reason: 'Customer refused',
        officename: 'Branch',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status_bucket).toBe('cancelled');
    expect(rows[0].cancel_reason).toBe('Customer refused');
    expect(rows[0].cancelled_at?.toISOString()).toBe(new Date(edited).toISOString());
  });
});
