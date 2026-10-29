import { describe, expect, it } from 'vitest';
import {
  selectTopCallTypes,
  toTrendCallTypePoint,
  toTrendDay,
} from '@/sql/read-model/ops-status-trend';
import {
  activityFlagsForDay,
  resolveOpsSnapshotAsOf,
} from '@/lib/read-model/ops-status-snapshot';

describe('ops-status-trend helpers', () => {
  it('maps logged (open_unallocated) as open; assigned unused', () => {
    expect(
      toTrendDay({
        as_of_date: '2026-10-27',
        open_unallocated: 10,
        assigned: 0,
        tech_solved: 2,
        solved: 40,
        cancelled: 3,
        total: 55,
      })
    ).toEqual({
      date: '2026-10-27',
      open: 10,
      unallocated: 10,
      assigned: 0,
      solved: 40,
      cancelled: 3,
      tech_solved: 2,
      total: 55,
    });
  });

  it('keeps activity counts per call type', () => {
    expect(
      toTrendCallTypePoint({
        as_of_date: '2026-10-27',
        call_type: 'BREAKDOWN',
        open_unallocated: 8,
        assigned: 0,
        tech_solved: 1,
        solved: 100,
        cancelled: 5,
        total: 114,
      })
    ).toEqual({
      date: '2026-10-27',
      call_type: 'BREAKDOWN',
      open: 8,
      unallocated: 8,
      assigned: 0,
      solved: 100,
      cancelled: 5,
      tech_solved: 1,
      total: 114,
    });
  });

  it('picks top call types by volume with stable tie-break', () => {
    expect(
      selectTopCallTypes(
        [
          { call_type: 'BREAKDOWN', total: 100 },
          { call_type: 'INSTALLATION CALL', total: 50 },
          { call_type: 'AAA', total: 50 },
          { call_type: 'Z', total: 1 },
        ],
        3
      )
    ).toEqual(['BREAKDOWN', 'AAA', 'INSTALLATION CALL']);
  });

  it('rejects invalid snapshot as-of dates', () => {
    expect(() => resolveOpsSnapshotAsOf('not-a-date')).toThrow(/Invalid/);
    expect(resolveOpsSnapshotAsOf('2026-10-27')).toBe('2026-10-27');
  });

  it('counts solved on solved_at day (Register Solved Date), not later editedon', () => {
    const row = {
      logged_at: '2026-10-01T10:00:00+05:30',
      solved_at: '2026-10-20T18:00:00+05:30',
      edited_at: '2026-10-27T18:00:00+05:30',
      source_editedon: '2026-10-27T18:00:00+05:30',
      status_bucket: 'solved',
    };
    expect(activityFlagsForDay(row, '2026-10-20')).toEqual({
      logged: false,
      solved: true,
      tech_solved: false,
      cancelled: false,
    });
    expect(activityFlagsForDay(row, '2026-10-27').solved).toBe(false);
    expect(activityFlagsForDay(row, '2026-10-01')).toEqual({
      logged: true,
      solved: false,
      tech_solved: false,
      cancelled: false,
    });
  });
});
