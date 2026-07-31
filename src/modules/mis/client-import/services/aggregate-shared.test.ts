import { describe, expect, it } from 'vitest';
import { clientAggregatesFromRows } from '@/modules/mis/client-import/services/aggregate';
import type { StatusBucket } from '@/modules/mis/client-import/services/types';

function row(partial: {
  region?: string;
  account?: string;
  branch_label?: string | null;
  status_bucket?: StatusBucket;
  logged_at?: Date | null;
  is_part_pending?: boolean;
  engineer_name?: string | null;
}) {
  return {
    region: partial.region ?? 'NORTH',
    account: partial.account ?? 'COKE',
    branch_label: partial.branch_label ?? 'Branch A',
    logged_at: partial.logged_at === undefined ? new Date('2026-07-01') : partial.logged_at,
    status_bucket: partial.status_bucket ?? 'solved',
    is_part_pending: partial.is_part_pending ?? false,
    engineer_name: partial.engineer_name ?? 'Eng',
  };
}

describe('clientAggregatesFromRows', () => {
  it('builds branch + account from the same row set with matching totals', () => {
    const rows = [
      row({ status_bucket: 'solved', account: 'COKE', region: 'NORTH' }),
      row({ status_bucket: 'assigned', account: 'COKE', region: 'NORTH', engineer_name: 'A' }),
      row({
        status_bucket: 'solved',
        account: 'CADBURY',
        region: 'WEST',
        branch_label: 'Branch B',
      }),
    ];
    const { branchSummary, accountSummary, rowsInDateRange } = clientAggregatesFromRows(
      rows,
      '2026-07-22'
    );

    expect(rowsInDateRange).toBe(3);
    expect(branchSummary.reduce((s, b) => s + b.total_calls, 0)).toBe(3);
    expect(accountSummary.reduce((s, a) => s + a.total_calls, 0)).toBe(3);
    expect(accountSummary.map((a) => a.account).sort()).toEqual(['CADBURY', 'COKE']);
  });
});
