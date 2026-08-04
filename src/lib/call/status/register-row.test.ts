import { describe, expect, it } from 'vitest';
import {
  classifyRegisterRowStatus,
  type RegisterSummaryBucket,
} from '@/lib/call/status/register-row';
import { mapRegisterBucketToStatusBucket } from '@/lib/read-model/transform';

/** Regression: Tech.Solve vs Closed must not use bapproval — see classifyRegisterRowStatus. */
describe('classifyRegisterRowStatus — Tech. Solve vs Closed (no bapproval)', () => {
  const cases: Array<{
    name: string;
    row: Record<string, unknown>;
    expect: RegisterSummaryBucket;
  }> = [
    {
      name: 'bfastclose without bsolved is Tech. Solve even when bapproval=1 (CRM default)',
      row: {
        bfastclose: '1',
        bsolved: '0',
        bapproval: '1',
        ncancelreason: 0,
        nengineer: 10,
      },
      expect: 'techSolved',
    },
    {
      name: 'bfastclose without bsolved is Tech. Solve when bapproval=0 too',
      row: {
        bfastclose: true,
        bsolved: false,
        bapproval: false,
        ncancelreason: 0,
        nengineer: 10,
      },
      expect: 'techSolved',
    },
    {
      name: 'bsolved is Closed even if bapproval is false',
      row: {
        bfastclose: true,
        bsolved: true,
        bapproval: false,
        ncancelreason: 0,
        nengineer: 10,
      },
      expect: 'closed',
    },
    {
      name: 'bsolved wins over bfastclose (CallDetail order)',
      row: {
        bfastclose: '1',
        bsolved: '1',
        bapproval: '1',
        ncancelreason: 0,
        nengineer: 10,
      },
      expect: 'closed',
    },
    {
      name: 'open/assigned with bapproval=1 must NOT become Closed or Tech. Solve',
      row: {
        bfastclose: false,
        bsolved: false,
        bapproval: true,
        ncancelreason: 0,
        nengineer: 10,
      },
      expect: 'assigned',
    },
    {
      name: 'open unallocated ignores bapproval',
      row: {
        bfastclose: 0,
        bsolved: 0,
        bapproval: 1,
        ncancelreason: 0,
        nengineer: 0,
      },
      expect: 'openUnallocated',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(classifyRegisterRowStatus(c.row)).toBe(c.expect);
    });
  }

  it('hot status_bucket mapping: techSolved → tech_solved, closed → solved', () => {
    expect(mapRegisterBucketToStatusBucket('techSolved')).toBe('tech_solved');
    expect(mapRegisterBucketToStatusBucket('closed')).toBe('solved');
  });

  it('regression: flipping only bapproval must not change Tech. Solve → Closed', () => {
    const base = {
      bfastclose: true,
      bsolved: false,
      ncancelreason: 0,
      nengineer: 99,
    };
    expect(classifyRegisterRowStatus({ ...base, bapproval: false })).toBe('techSolved');
    expect(classifyRegisterRowStatus({ ...base, bapproval: true })).toBe('techSolved');
    expect(classifyRegisterRowStatus({ ...base, bapproval: '1' })).toBe('techSolved');
    expect(classifyRegisterRowStatus({ ...base, bm_approved_at: new Date() })).toBe('techSolved');
  });
});
