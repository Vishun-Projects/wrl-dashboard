import { describe, expect, it } from 'vitest';
import {
  adjustRegisterSummaryBucket,
  corpusSpanDays,
  formatRelativeTime,
  isApiShapedSummary,
  mergeBranchSummaryRowsByName,
  registerPageCacheGet,
  registerPageCachePut,
  resolveAccountMisTableRows,
  type RegisterPageCacheEntry,
} from '@/modules/mis/services/report-page-helpers';
import type { RegisterSummary } from '@/modules/mis/services/search';
import type { BranchSummaryRow } from '@/lib/summary/derive';

describe('report-page-helpers', () => {
  it('corpusSpanDays inclusive', () => {
    expect(corpusSpanDays('2026-07-01', '2026-07-01')).toBe(1);
    expect(corpusSpanDays('2026-07-01', '2026-07-03')).toBe(3);
  });

  it('isApiShapedSummary requires headcount and region', () => {
    expect(isApiShapedSummary([])).toBe(false);
    expect(isApiShapedSummary([{ total: 1 }])).toBe(false);
    expect(isApiShapedSummary([{ headcount: 3, region: 'EAST' }])).toBe(true);
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

  it('mergeBranchSummaryRowsByName sums duplicate branch labels', () => {
    const base = {
      parentId: 0,
      branch: '1150 - RANCHI BRANCH',
      region: 'EAST ZONE',
      solved_calls: 0,
      cancelled_calls: 0,
      open_calls: 0,
      age_2: 0,
      age_3: 0,
      age_7: 0,
      age_15: 0,
      part_pending: 0,
      all_total: 0,
      all_solved: 0,
      all_cancelled: 0,
      all_open: 0,
      all_age_2: 0,
      all_age_3: 0,
      all_age_7: 0,
      all_age_15: 0,
      all_part_pending: 0,
      all_tech_solved: 0,
      tech_solved_calls: 0,
      deployment_total: 0,
      deployment_done: 0,
      installation_total: 0,
      installation_done: 0,
      population: 0,
    } satisfies Omit<BranchSummaryRow, 'officeId' | 'total_calls' | 'active_eng' | 'headcount'>;

    const rows: BranchSummaryRow[] = [
      { ...base, officeId: 1, total_calls: 520, open_calls: 100, active_eng: 44, headcount: 26 },
      { ...base, officeId: 2, total_calls: 47, open_calls: 5, active_eng: 3, headcount: 4 },
    ];
    const merged = mergeBranchSummaryRowsByName(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].officeId).toBe(1);
    expect(merged[0].total_calls).toBe(567);
    expect(merged[0].open_calls).toBe(105);
    expect(merged[0].active_eng).toBe(47);
    expect(merged[0].headcount).toBe(26);
  });
});
