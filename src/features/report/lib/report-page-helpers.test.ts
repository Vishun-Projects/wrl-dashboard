import { describe, expect, it } from 'vitest';
import {
  adjustRegisterSummaryBucket,
  corpusSpanDays,
  formatRelativeTime,
  registerPageCacheGet,
  registerPageCachePut,
  resolveAccountMisTableRows,
  type RegisterPageCacheEntry,
} from '@/features/report/lib/report-page-helpers';
import type { RegisterSummary } from '@/features/report/lib/search';

describe('report-page-helpers', () => {
  it('corpusSpanDays inclusive', () => {
    expect(corpusSpanDays('2026-07-01', '2026-07-01')).toBe(1);
    expect(corpusSpanDays('2026-07-01', '2026-07-03')).toBe(3);
  });

  it('register page cache put/get', () => {
    const root = new Map<string, Map<number, RegisterPageCacheEntry>>();
    const entry: RegisterPageCacheEntry = { data: [{ a: 1 }], total: 1 };
    registerPageCachePut(root, 'k', 2, entry);
    expect(registerPageCacheGet(root, 'k', 2)).toEqual(entry);
    expect(registerPageCacheGet(root, 'k', 1)).toBeUndefined();
  });

  it('adjustRegisterSummaryBucket bumps closed + solved', () => {
    const summary: RegisterSummary = {
      total: 0,
      open: 0,
      openUnallocated: 0,
      assigned: 0,
      solved: 0,
      closed: 0,
      techSolved: 0,
      cancelled: 0,
    };
    adjustRegisterSummaryBucket(summary, 'closed', 1);
    expect(summary.closed).toBe(1);
    expect(summary.solved).toBe(1);
  });

  it('resolveAccountMisTableRows overview rolls up', () => {
    const rows = resolveAccountMisTableRows(
      [
        { account: 'A', region: 'NORTH', total_calls: 1 },
        { account: 'A', region: 'SOUTH', total_calls: 2 },
      ],
      'overview',
      5,
      undefined,
      { crm: true, client: false },
      { cadbury: true, coke: false }
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('formatRelativeTime empty for null', () => {
    expect(formatRelativeTime(null)).toBe('');
  });
});
