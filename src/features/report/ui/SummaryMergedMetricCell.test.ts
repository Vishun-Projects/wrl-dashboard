import { describe, expect, it } from 'vitest';
import {
  displayLoggedCallCount,
  sumBranchLoggedCalls,
  sumMergedGrandMetric,
} from '@/features/report/ui/SummaryMergedMetricCell';

describe('displayLoggedCallCount', () => {
  it('returns total_calls as-is when cancelled is already included (CRM branch)', () => {
    expect(displayLoggedCallCount(2657, 94, true)).toBe(2657);
  });

  it('adds cancelled when total_calls excludes it (client import)', () => {
    expect(displayLoggedCallCount(100, 12, false)).toBe(112);
  });
});

describe('sumMergedGrandMetric', () => {
  it('includes client-only account rows not present in CRM accounts', () => {
    const crm = [
      { region: 'NORTH ZONE', account: 'Nestle', total_calls: 10, total_solved: 5 },
    ];
    const client = [
      { region: 'NORTH ZONE', account: 'Nestle', total_calls: 3, total_solved: 1 },
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 7, total_solved: 2 },
    ];
    const flags = { crm: true, client: true };
    const prefs = { cadbury: false, coke: false };

    expect(
      sumMergedGrandMetric(crm, client, 'total_solved', flags, prefs)
    ).toBe(8);
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
