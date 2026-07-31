import { describe, expect, it } from 'vitest';
import { buildSummaryQueryKeyFromSnapshot } from './summary-query-key';

describe('buildSummaryQueryKeyFromSnapshot', () => {
  it('builds a stable key with normalized aging and call types', () => {
    const key = buildSummaryQueryKeyFromSnapshot({
      offices: [{ ncode: '101', parent_ncode: null }],
      selectedBranch: ['101'],
      selectedFranchisee: [],
      selectedCallTypes: ['Breakdown', 'Install'],
      startDateStr: '2026-07-01',
      endDateStr: '2026-07-31',
      agingAsOf: '',
    });

    expect(key).toContain('2026-07-01');
    expect(key).toContain('2026-07-31');
    expect(key).toContain('Breakdown');
  });
});
