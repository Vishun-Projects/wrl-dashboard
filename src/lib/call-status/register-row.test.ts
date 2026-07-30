import { describe, expect, it } from 'vitest';
import { classifyRegisterRowStatus } from '@/lib/call-status/register-row';

describe('classifyRegisterRowStatus', () => {
  it('classifies tech solved as bfastclose without bsolved', () => {
    const bucket = classifyRegisterRowStatus({
      bfastclose: true,
      bsolved: false,
      bapproval: true, // CRM often sets this even on open/tech-solve — ignore for status
      ncancelreason: 0,
      nengineer: 10,
    });
    expect(bucket).toBe('techSolved');
  });

  it('classifies closed when bsolved', () => {
    const bucket = classifyRegisterRowStatus({
      bfastclose: true,
      bsolved: true,
      bapproval: false,
      ncancelreason: 0,
      nengineer: 10,
    });
    expect(bucket).toBe('closed');
  });

  it('classifies assigned when neither fast-close nor solved', () => {
    const bucket = classifyRegisterRowStatus({
      bfastclose: false,
      bsolved: false,
      bapproval: true,
      ncancelreason: 0,
      nengineer: 10,
    });
    expect(bucket).toBe('assigned');
  });
});
