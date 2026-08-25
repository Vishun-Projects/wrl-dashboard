import { describe, expect, it } from 'vitest';
import { processCrmRowsForYtdLoad, transformCrmRowToHot } from '@/lib/read-model/transform';

/** Mirror stores every non-transfer row processCrmRowsForYtdLoad accepts. */
describe('calls-mirror transform eligibility', () => {
  const base = {
    ncode: 1,
    nofficeid: 100,
    officename: 'Branch',
    bsolved: 0,
    bfastclose: 0,
  };

  it('transforms pre-YTD solved call for mirror load', () => {
    const rows = processCrmRowsForYtdLoad([
      {
        ...base,
        vtrnno: '24A1',
        callsdtrndate: '2024-06-01',
        bsolved: 1,
        ncancelreason: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status_bucket).toBe('solved');
  });

  it('transforms pre-YTD cancelled call', () => {
    const rows = processCrmRowsForYtdLoad([
      {
        ...base,
        vtrnno: '25C1',
        callsdtrndate: '2025-03-01',
        editedon: '2026-08-24T10:00:00',
        ncancelreason: 9,
        cancel_reason: 'Wrong Call',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status_bucket).toBe('cancelled');
    expect(rows[0].cancel_reason).toBe('Wrong Call');
  });

  it('drops transfers', () => {
    const hot = transformCrmRowToHot({
      ...base,
      vtrnno: '25T1',
      callsdtrndate: '2025-03-01',
      ncancelreason: 2,
      vtransfercallno: '26X',
    });
    expect(hot).toBeNull();
  });
});
