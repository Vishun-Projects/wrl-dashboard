import { describe, expect, it } from 'vitest';
import {
  assertMidnightCrmTallyParity,
  buildMidnightCrmDeltaEmailHtml,
  midnightCrmBuildNewIncreaseByStatus,
  midnightCrmBuildTotalsCompare,
  midnightCrmBuildYtdSummary,
  midnightCrmCallKey,
  midnightCrmDiffSnapshots,
  midnightCrmSnapshotFromRows,
  midnightCrmSubtractCounts,
} from '@/modules/mis-email/services/midnight-crm-delta';

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    vtrnno: '25A00001',
    vcclid: '100',
    PartyName: 'Test Co',
    officename: 'Delhi',
    region: 'NORTH ZONE',
    account: 'Samsung',
    callsdtrndate: '2026-08-25T10:00:00+05:30',
    ncode: 1,
    nofficeid: 10,
    nengineer: 0,
    bsolved: false,
    bfastclose: false,
    ncancelreason: 0,
    ...overrides,
  };
}

describe('midnight-crm-delta', () => {
  it('strict call key uses vtrnno', () => {
    expect(midnightCrmCallKey(row({ vtrnno: '25I03443' }))).toBe('25I03443');
  });

  it('overall YTD totals match excel row count', () => {
    const rows = [row({ bsolved: true }), row({ vtrnno: '25A00002', nengineer: 5 })];
    const ytd = midnightCrmBuildYtdSummary(rows);
    expect(ytd.all).toBe(2);
    assertMidnightCrmTallyParity({ rows, ytd, emailCounts: ytd });
  });

  it('previous→this report change matches new calls by status', () => {
    const rows = [
      row({ vtrnno: 'NEW1', callsdtrndate: '2026-08-25T09:00:00+05:30' }),
      row({ vtrnno: 'CLOSE1', bsolved: true }),
    ];
    const current = midnightCrmBuildYtdSummary(rows);
    const previousCounts = midnightCrmBuildYtdSummary([row({ vtrnno: 'CLOSE1', nengineer: 12 })]);
    const compare = midnightCrmBuildTotalsCompare(
      {
        asOfDate: '2026-08-24',
        generatedAt: '',
        callType: 'BREAKDOWN',
        counts: previousCounts,
        calls: { CLOSE1: 'assigned' },
      },
      current
    );
    expect(compare.change?.all).toBe(1);

    const diff = midnightCrmDiffSnapshots({
      previous: {
        asOfDate: '2026-08-24',
        generatedAt: '',
        callType: 'BREAKDOWN',
        counts: previousCounts,
        calls: { CLOSE1: 'assigned' },
      },
      currentCalls: midnightCrmSnapshotFromRows(rows),
      rowsByKey: new Map(rows.map((r) => [midnightCrmCallKey(r), r])),
      asOfDate: '2026-08-25',
    });
    const byStatus = midnightCrmBuildNewIncreaseByStatus(diff.newInSnapshot);
    expect(diff.newInSnapshot).toHaveLength(1);
    expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(1);
    expect(midnightCrmSubtractCounts(current, previousCounts).all).toBe(1);
  });

  it('regional email HTML matches morning MIS table columns', () => {
    const regional = [
      {
        region: 'NORTH ZONE',
        total_calls: 100,
        solved_calls: 80,
        cancelled_calls: 10,
        open_calls: 10,
        age_2: 5,
        age_3: 3,
        age_7: 1,
        age_15: 1,
        part_pending: 0,
        active_eng: 4,
      },
    ];
    const html = buildMidnightCrmDeltaEmailHtml({
      dateRange: { startDate: '2026-01-01', endDate: '2026-08-25', label: 'YTD' },
      callType: 'BREAKDOWN',
      regional,
      previousRegional: null,
      delta: {
        baseline: true,
        previousAsOfDate: null,
        asOfDate: '2026-08-25',
        compare: {
          previous: null,
          current: {
            all: 1,
            openUnallocated: 0,
            assigned: 0,
            open: 0,
            closed: 0,
            techSolved: 0,
            solved: 0,
            cancelled: 0,
            transferred: 0,
          },
          change: null,
        },
        newIncreaseByStatus: {},
        newlyClosed: [],
        newlyTechSolved: [],
        newlyCancelled: [],
        reopened: [],
        openToAssigned: [],
        newInSnapshot: [],
      },
      generatedAtIst: '26 Aug 2026, 12:00 am',
      exportRows: 1,
    });
    expect(html).toContain('Regional Performance — as of 2026-08-25');
    expect(html).toContain('Total calls');
    expect(html).toContain('Total solved');
    expect(html).toContain('Cancelled');
    expect(html).toContain('# open calls');
    expect(html).toContain('&lt;2 days');
    expect(html).toContain('# of active Eng.');
    expect(html).toContain('NORTH');
    expect(html).toContain('All');
  });
});
