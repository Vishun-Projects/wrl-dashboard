import { describe, expect, it } from 'vitest';
import {
  displayLoggedCallCount,
  sumBranchLoggedCalls,
} from '@/components/report/SummaryMergedMetricCell';

describe('displayLoggedCallCount', () => {
  it('returns total_calls as-is when cancelled is already included (CRM branch)', () => {
    expect(displayLoggedCallCount(2657, 94, true)).toBe(2657);
  });

  it('adds cancelled when total_calls excludes it (client import)', () => {
    expect(displayLoggedCallCount(100, 12, false)).toBe(112);
  });
});

describe('sumBranchLoggedCalls', () => {
  it('sums branch total_calls without adding cancelled again', () => {
    expect(
      sumBranchLoggedCalls([
        { total_calls: 100, cancelled_calls: 5 },
        { total_calls: 200, cancelled_calls: 10 },
      ])
    ).toBe(300);
  });
});
