import { describe, expect, it } from 'vitest';
import { classifyRegisterRowStatus } from '@/lib/call-status/register-row';

describe('classifyRegisterRowStatus', () => {
  it('classifies tech solved stage without BM approval', () => {
    const bucket = classifyRegisterRowStatus({
      bfastclose: true,
      bapproval: false,
      ncancelreason: 0,
      nengineer: 10,
    });
    expect(bucket).toBe('techSolved');
  });

  it('classifies closed when tech solved and BM approved', () => {
    const bucket = classifyRegisterRowStatus({
      bfastclose: true,
      bapproval: true,
      ncancelreason: 0,
      nengineer: 10,
    });
    expect(bucket).toBe('closed');
  });
});
